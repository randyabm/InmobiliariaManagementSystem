import { BadRequestException, Injectable } from '@nestjs/common';
import type { MapeoColumnas, PaymentRecord } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { parsearRegistro } from './parser-canónico';
import { InferidorEstructuraDeterminista, type InferidorEstructura } from './inferidor-estructura';

/**
 * Importaciones de pagos (feature #30, R1–R6, §15).
 *
 * Capas §15.2: 1) inferencia (PA-30-1) → 2) parseo determinista (PA-30-2)
 * → 3) conciliación con estrategias de §15.4. Ningún registro se concilia
 * sin confirmación humana (salvaguarda §15.3).
 */
@Injectable()
export class ImportacionesService {
  private readonly inferidor: InferidorEstructura = new InferidorEstructuraDeterminista();

  /** R1 — carga: guarda el archivo (hash) y propone el mapeo (R2). */
  async cargar(
    ctx: ContextoPeticion,
    datos: { nombreArchivo: string; binario: Buffer; nombreOrigen: string },
  ): Promise<{ id: string; mapeo_propuesto: MapeoColumnas; perfil_reutilizado: boolean }> {
    const { createHash } = await import('node:crypto');
    const hashArchivo = createHash('sha256').update(datos.binario).digest('hex');

    // Perfil reutilizable por (tenant, nombre_origen) (RF-PA6).
    const { rows: perfil } = await ctx.cliente.query<{ mapeo_columnas_json: unknown }>(
      `SELECT mapeo_columnas_json FROM payment_mapping_profile
        WHERE tenant_id = $1 AND nombre_origen = $2 AND activo = true`,
      [ctx.tenantId, datos.nombreOrigen],
    );
    const { encabezados, filaEjemplo: filaEjemploBase, filas } = desglosar(datos.binario);
    if (perfil[0]) {
      const mapeo = perfil[0].mapeo_columnas_json as MapeoColumnas;
      void filaEjemploBase;
      const { rows: importacion } = await ctx.cliente.query<{ id: string }>(
        `INSERT INTO payment_import
           (tenant_id, nombre_archivo, nombre_origen, hash_archivo, formato_detectado,
            encabezados_json, mapeo_aplicado_json, cargado_por, estado)
         VALUES ($1, $2, $3, $4, 'perfil', $5, $6, $7, 'mapeada')
         RETURNING id`,
        [ctx.tenantId, datos.nombreArchivo, datos.nombreOrigen, hashArchivo, JSON.stringify(encabezados), JSON.stringify(mapeo), ctx.actorId ?? null],
      );
      await this.guardarFilas(ctx, importacion[0]!.id, filas);
      return { id: importacion[0]!.id, mapeo_propuesto: mapeo, perfil_reutilizado: true };
    }

    // Sin perfil: inferencia determinista (PA-30-1).
    const inferida = this.inferidor.inferir(encabezados, filaEjemploBase);
    const { rows: importacion } = await ctx.cliente.query<{ id: string }>(
      `INSERT INTO payment_import
         (tenant_id, nombre_archivo, nombre_origen, hash_archivo, formato_detectado,
          encabezados_json, mapeo_aplicado_json, cargado_por, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cargada')
       RETURNING id`,
      [
        ctx.tenantId,
        datos.nombreArchivo,
        datos.nombreOrigen,
        hashArchivo,
        inferida.formato_detectado,
        JSON.stringify(encabezados),
        JSON.stringify(inferida.mapeo),
        ctx.actorId ?? null,
      ],
    );
    const importId = importacion[0]!.id;
    await this.guardarFilas(ctx, importId, filas);
    return { id: importId, mapeo_propuesto: inferida.mapeo, perfil_reutilizado: false };
  }

  private async guardarFilas(ctx: ContextoPeticion, importId: string, filas: string[][]): Promise<void> {
    for (let n = 0; n < filas.length; n++) {
      await ctx.cliente.query(
        `INSERT INTO payment_import_fila (tenant_id, import_id, n, fila_json)
         VALUES ($1, $2, $3, $4)`,
        [ctx.tenantId, importId, n, JSON.stringify(filas[n])],
      );
    }
  }

  /** R2 — confirmar el mapeo y guardarlo como perfil reutilizable. */
  async confirmarMapeo(
    ctx: ContextoPeticion,
    importId: string,
    mapeo: MapeoColumnas,
  ): Promise<void> {
    const importacion = await this.buscarImportacion(ctx, importId);
    if (importacion.estado !== 'cargada') {
      throw new ResourceNotFoundError();
    }
    await ctx.cliente.query(
      `UPDATE payment_import SET mapeo_aplicado_json = $2, estado = 'mapeada'
        WHERE id = $1 AND tenant_id = $3`,
      [importId, JSON.stringify(mapeo), ctx.tenantId],
    );

    // RF-PA6: el mapeo se guarda como perfil reutilizable por origen.
    const { rows: origen } = await ctx.cliente.query<{ nombre_origen: string }>(
      `SELECT nombre_origen FROM payment_import WHERE id = $1`,
      [importId],
    );
    await ctx.cliente.query(
      `INSERT INTO payment_mapping_profile (tenant_id, nombre_origen, mapeo_columnas_json, activo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (tenant_id, nombre_origen)
       DO UPDATE SET mapeo_columnas_json = EXCLUDED.mapeo_columnas_json, activo = true`,
      [ctx.tenantId, origen[0]?.nombre_origen ?? 'default', JSON.stringify(mapeo)],
    );
  }

  /** R3, R4 — procesar: parseo determinista + emparejamiento sugerido. */
  async procesar(ctx: ContextoPeticion, importId: string): Promise<{ total: number }> {
    const importacion = await this.buscarImportacion(ctx, importId);
    if (importacion.estado !== 'mapeada') {
      throw new ResourceNotFoundError();
    }
    const mapeo = importacion.mapeo_aplicado_json as MapeoColumnas;
    const { rows: archivo } = await ctx.cliente.query<{ nombre_archivo: string }>(
      `SELECT nombre_archivo FROM payment_import WHERE id = $1`,
      [importId],
    );

    void archivo;

    let total = 0;
    const registros = await this.registrosDelArchivo(ctx, importId, mapeo);
    for (const fila of registros) {
      total += 1;
      const { rows: duplicado } = await ctx.cliente.query<{ id: string }>(
        `SELECT r.id FROM payment_record r
          WHERE r.tenant_id = $1 AND r.fecha_movimiento = $2 AND r.valor = $3
            AND r.pagador_texto IS NOT DISTINCT FROM $4
          LIMIT 1`,
        [ctx.tenantId, fila.fecha_movimiento, fila.valor, fila.pagador_texto],
      );
      const estado = duplicado[0] ? 'Duplicado' : 'Cargado';
      await ctx.cliente.query(
        `INSERT INTO payment_record
           (tenant_id, import_id, fecha_movimiento, valor, referencia_texto,
            pagador_texto, cuenta_destino, medio_pago, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          ctx.tenantId,
          importId,
          fila.fecha_movimiento,
          fila.valor,
          fila.referencia_texto,
          fila.pagador_texto,
          fila.cuenta_destino,
          fila.medio_pago,
          estado,
        ],
      );
    }

    await this.emparejar(ctx, importId);
    await ctx.cliente.query(
      `UPDATE payment_import SET estado = 'procesada', total_registros = $2,
              conciliados = (SELECT count(*) FROM payment_record
                              WHERE import_id = $1 AND estado = 'Conciliado'),
              sin_identificar = (SELECT count(*) FROM payment_record
                                  WHERE import_id = $1 AND estado = 'Sin_identificar')
        WHERE id = $1 AND tenant_id = $3`,
      [importId, total, ctx.tenantId],
    );
    return { total };
  }

  /** R4 — estrategias de §15.4: referencia única, cuenta+valor+fecha, nombre. */
  private async emparejar(ctx: ContextoPeticion, importId: string): Promise<void> {
    const { rows: registros } = await ctx.cliente.query<{
      id: string;
      valor: number;
      referencia_texto: string | null;
      pagador_texto: string | null;
      cuenta_destino: string | null;
      fecha_movimiento: Date;
    }>(
      `SELECT id, valor::numeric::float8 AS valor, referencia_texto,
              pagador_texto, cuenta_destino, fecha_movimiento
         FROM payment_record
        WHERE tenant_id = $1 AND import_id = $2 AND estado = 'Cargado'`,
      [ctx.tenantId, importId],
    );
    for (const registro of registros) {
      const match = await this.buscarContrato(ctx, registro);
      if (match) {
        await ctx.cliente.query(
          `UPDATE payment_record SET estado = 'Sugerido', contract_id = $2,
                  estrategia_conciliacion = $3, confianza = $4
            WHERE id = $1 AND tenant_id = $5`,
          [
            registro.id,
            match.contract_id,
            match.estrategia,
            match.confianza,
            ctx.tenantId,
          ],
        );
      } else {
        await ctx.cliente.query(
          `UPDATE payment_record SET estado = 'Sin_identificar'
            WHERE id = $1 AND tenant_id = $2`,
          [registro.id, ctx.tenantId],
        );
      }
    }
  }

  private async buscarContrato(
    ctx: ContextoPeticion,
    registro: { valor: number; referencia_texto: string | null; pagador_texto: string | null; cuenta_destino: string | null; fecha_movimiento: Date },
  ): Promise<{ contract_id: string; estrategia: string; confianza: number } | null> {
    // Estrategia 1: referencia única ARR-XXXXX (RF-PA9): se genera para
    // cada contrato del tenant (referenciaDePago) y se compara.
    if (registro.referencia_texto) {
      const { rows: contratos } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM contract WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      for (const contrato of contratos) {
        const sufijo = contrato.id.slice(0, 5).toUpperCase().replaceAll('-', '0');
        if (registro.referencia_texto === `ARR-${sufijo}`) {
          return { contract_id: contrato.id, estrategia: 'referencia_unica', confianza: 0.95 };
        }
      }
    }
    // Estrategia 2: cuenta destino + valor + ventana de fecha (fiabilidad media).
    if (registro.cuenta_destino && registro.valor > 0) {
      const { rows } = await ctx.cliente.query<{ id: string }>(
        `SELECT c.id FROM contract c
          JOIN propiedad p ON p.id = c.property_id
          LEFT JOIN cuenta_bancaria cb ON cb.id = p.cuenta_bancaria_id
         WHERE c.tenant_id = $1
           AND cb.numero_cuenta = $2
           AND c.fecha_inicio <= $3 AND c.fecha_fin >= $3 - interval '5 days'
         LIMIT 1`,
        [ctx.tenantId, registro.cuenta_destino, registro.fecha_movimiento],
      );
      if (rows[0]) {
        return { contract_id: rows[0].id, estrategia: 'cuenta_valor_fecha', confianza: 0.6 };
      }
    }
    return null;
  }

  /** R5 — resolver un registro sin identificar (bandeja de excepciones). */
  async resolverRegistro(
    ctx: ContextoPeticion,
    recordId: string,
    accion: { contract_id?: string; descartar?: boolean },
  ): Promise<PaymentRecord> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, import_id::text AS import_id,
              fecha_movimiento, valor::text AS valor, referencia_texto,
              pagador_texto, cuenta_destino, medio_pago, estado,
              contract_id::text AS contract_id, estrategia_conciliacion,
              confianza, conciliado_por::text AS conciliado_por,
              fecha_conciliacion, created_at
         FROM payment_record WHERE id = $1 AND tenant_id = $2`,
      [recordId, ctx.tenantId],
    );
    if (!rows[0]) throw new ResourceNotFoundError();

    if (accion.descartar) {
      await ctx.cliente.query(
        `UPDATE payment_record SET estado = 'Descartado'
          WHERE id = $1 AND tenant_id = $2`,
        [recordId, ctx.tenantId],
      );
    } else if (accion.contract_id) {
      const { rows: contrato } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM contract WHERE id = $1 AND tenant_id = $2`,
        [accion.contract_id, ctx.tenantId],
      );
      if (contrato.length === 0) throw new ResourceNotFoundError();
      await ctx.cliente.query(
        `UPDATE payment_record SET estado = 'Conciliado', contract_id = $2,
                estrategia_conciliacion = 'manual', conciliado_por = $3,
                fecha_conciliacion = now()
          WHERE id = $1 AND tenant_id = $4`,
        [recordId, accion.contract_id, ctx.actorId ?? null, ctx.tenantId],
      );
    } else {
      throw new ResourceNotFoundError();
    }

    const { rows: actualizado } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, import_id::text AS import_id,
              fecha_movimiento, valor::text AS valor, referencia_texto,
              pagador_texto, cuenta_destino, medio_pago, estado,
              contract_id::text AS contract_id, estrategia_conciliacion,
              confianza, conciliado_por::text AS conciliado_por,
              fecha_conciliacion, created_at
         FROM payment_record WHERE id = $1 AND tenant_id = $2`,
      [recordId, ctx.tenantId],
    );
    return aRegistro(actualizado[0]!);
  }

  /** R6 — estado de cuenta del contrato (con scoping del inquilino). */
  async estadoDeCuenta(
    ctx: ContextoPeticion,
    contractId: string,
    rol: string,
  ): Promise<{ contract_id: string; pagos: PaymentRecord[]; moroso: boolean }> {
    const { rows: contrato } = await ctx.cliente.query<{ id: string; inquilino_id: string | null }>(
      `SELECT id, inquilino_id::text AS inquilino_id FROM contract WHERE id = $1 AND tenant_id = $2`,
      [contractId, ctx.tenantId],
    );
    if (!contrato[0]) throw new ResourceNotFoundError();

    // Scoping del inquilino (RF-PA12): solo su contrato.
    if (rol === 'inquilino' && ctx.actorId) {
      const { rows: perfil } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM perfil_inquilino WHERE tenant_id = $1 AND user_id = $2`,
        [ctx.tenantId, ctx.actorId],
      );
      if (perfil[0]?.id !== contrato[0].inquilino_id) throw new ResourceNotFoundError();
    }

    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, import_id::text AS import_id,
              fecha_movimiento, valor::text AS valor, referencia_texto,
              pagador_texto, cuenta_destino, medio_pago, estado,
              contract_id::text AS contract_id, estrategia_conciliacion,
              confianza, conciliado_por::text AS conciliado_por,
              fecha_conciliacion, created_at
         FROM payment_record
        WHERE tenant_id = $1 AND contract_id = $2 AND estado = 'Conciliado'
        ORDER BY fecha_movimiento`,
      [ctx.tenantId, contractId],
    );
    // Morosidad con días de gracia configurables (PA-30-3, RF-PA13): el
    // canon esperado vence cada 30 días desde la fecha de inicio; si el
    // último pago conciliado es anterior a (ventana + gracia), es moroso.
    const { rows: canon } = await ctx.cliente.query<{ canon: string }>(
      `SELECT canon::text AS canon FROM propiedad p JOIN contract c ON c.property_id = p.id
        WHERE c.id = $1 AND p.tenant_id = $2`,
      [contractId, ctx.tenantId],
    );
    const { rows: config } = await ctx.cliente.query<{ dias_gracia: number }>(
      `SELECT dias_gracia FROM config_renovacion WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const diasGracia = config[0]?.dias_gracia ?? 5;
    const ultimoPago = rows.length > 0 ? new Date(rows[rows.length - 1]!.fecha_movimiento) : null;
    const moroso =
      canon[0] !== undefined &&
      (ultimoPago === null ||
        Date.now() - ultimoPago.getTime() > (30 + diasGracia) * 86_400_000);
    return { contract_id: contractId, pagos: rows.map(aRegistro), moroso };
  }

  /** R9 (RF-PA9) — referencia única de pago por contrato. */
  async referenciaDePago(ctx: ContextoPeticion, contractId: string): Promise<{ referencia: string }> {
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM contract WHERE id = $1 AND tenant_id = $2`,
      [contractId, ctx.tenantId],
    );
    if (rows.length === 0) throw new ResourceNotFoundError();
    const sufijo = contractId.slice(0, 5).toUpperCase().replaceAll('-', '0');
    return { referencia: `ARR-${sufijo}` };
  }

  async buscarImportacion(
    ctx: ContextoPeticion,
    importId: string,
  ): Promise<{ id: string; estado: string; mapeo_aplicado_json: unknown }> {
    const { rows } = await ctx.cliente.query<{ id: string; estado: string; mapeo_aplicado_json: unknown }>(
      `SELECT id, estado, mapeo_aplicado_json FROM payment_import
        WHERE id = $1 AND tenant_id = $2`,
      [importId, ctx.tenantId],
    );
    if (!rows[0]) throw new ResourceNotFoundError();
    return rows[0];
  }

  async listarImportaciones(ctx: ContextoPeticion): Promise<Array<Record<string, unknown>>> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, nombre_archivo, hash_archivo, formato_detectado,
              mapeo_aplicado_json, cargado_por::text AS cargado_por,
              fecha_carga, total_registros, conciliados, sin_identificar, estado
         FROM payment_import WHERE tenant_id = $1 ORDER BY fecha_carga DESC`,
      [ctx.tenantId],
    );
    return rows;
  }

  async registrosDeImportacion(ctx: ContextoPeticion, importId: string): Promise<PaymentRecord[]> {
    await this.buscarImportacion(ctx, importId);
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, import_id::text AS import_id,
              fecha_movimiento, valor::text AS valor, referencia_texto,
              pagador_texto, cuenta_destino, medio_pago, estado,
              contract_id::text AS contract_id, estrategia_conciliacion,
              confianza, conciliado_por::text AS conciliado_por,
              fecha_conciliacion, created_at
         FROM payment_record
        WHERE tenant_id = $1 AND import_id = $2 ORDER BY fecha_movimiento`,
      [ctx.tenantId, importId],
    );
    return rows.map(aRegistro);
  }

  private async registrosDelArchivo(
    ctx: ContextoPeticion,
    importId: string,
    mapeo: MapeoColumnas,
  ): Promise<Array<{ fecha_movimiento: Date; valor: number; referencia_texto: string | null; pagador_texto: string | null; cuenta_destino: string | null; medio_pago: string | null }>> {
    // El binario viaja con la petición de procesar: se conserva en la
    // importación como base64 en memoria no es viable; el cliente lo
    // reenvía (documentado en el controller).
    return this.filasPendientes(ctx, importId, mapeo);
  }

  private async filasPendientes(
    ctx: ContextoPeticion,
    importId: string,
    mapeo: MapeoColumnas,
  ): Promise<Array<{ fecha_movimiento: Date; valor: number; referencia_texto: string | null; pagador_texto: string | null; cuenta_destino: string | null; medio_pago: string | null }>> {
    // El ORDEN de las columnas es el del archivo (jsonb reordena las
    // claves del mapeo): se conserva en `encabezados_json`.
    const { rows: importacion } = await ctx.cliente.query<{ encabezados_json: unknown }>(
      `SELECT encabezados_json FROM payment_import WHERE id = $1 AND tenant_id = $2`,
      [importId, ctx.tenantId],
    );
    const encabezados = (importacion[0]?.encabezados_json ?? Object.keys(mapeo)) as string[];
    const { rows: pendientes } = await ctx.cliente.query<{ fila_json: unknown }>(
      `SELECT fila_json FROM payment_import_fila
        WHERE tenant_id = $1 AND import_id = $2 ORDER BY n`,
      [ctx.tenantId, importId],
    );
    return pendientes.map((p) => {
      const fila = p.fila_json as string[];
      return parsearRegistro(fila, encabezados, mapeo);
    });
  }
}

interface FilaRegistro {
  id: string;
  tenant_id: string;
  import_id: string;
  fecha_movimiento: Date;
  valor: string;
  referencia_texto: string | null;
  pagador_texto: string | null;
  cuenta_destino: string | null;
  medio_pago: string | null;
  estado: PaymentRecord['estado'];
  contract_id: string | null;
  estrategia_conciliacion: string | null;
  confianza: number | null;
  conciliado_por: string | null;
  fecha_conciliacion: Date | null;
  created_at: Date;
}

function aRegistro(fila: unknown): PaymentRecord {
  const f = fila as FilaRegistro;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    import_id: f.import_id,
    fecha_movimiento: f.fecha_movimiento.toISOString(),
    valor: f.valor,
    referencia_texto: f.referencia_texto,
    pagador_texto: f.pagador_texto,
    cuenta_destino: f.cuenta_destino,
    medio_pago: f.medio_pago,
    estado: f.estado,
    contract_id: f.contract_id,
    estrategia_conciliacion: f.estrategia_conciliacion,
    confianza: f.confianza,
    conciliado_por: f.conciliado_por,
    fecha_conciliacion: f.fecha_conciliacion ? f.fecha_conciliacion.toISOString() : null,
    created_at: f.created_at.toISOString(),
  };
}

/** Desglosa CSV simple: encabezados, una fila de ejemplo y todas las filas. */
function desglosar(binario: Buffer): {
  encabezados: string[];
  filaEjemplo: string[];
  filas: string[][];
} {
  const lineas = binario.toString('utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lineas.length < 2) {
    throw new BadRequestException('El archivo debe tener encabezado y al menos una fila.');
  }
  const separar = (linea: string) => linea.split(',').map((c) => c.trim());
  const encabezados = separar(lineas[0]!);
  return {
    encabezados,
    filaEjemplo: separar(lineas[1]!),
    filas: lineas.slice(1).map(separar),
  };
}
