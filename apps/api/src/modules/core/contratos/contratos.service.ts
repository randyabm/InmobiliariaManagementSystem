import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Contrato, FirmaContrato } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { OtpService } from '../otp/otp.service';
import { GeneradorPdfPdfLib, type GeneradorPdf } from '../inventarios/firma/generador-pdf';
import { DocumentoNoFirmableError } from '../inventarios/errors/documento-no-firmable.error';
import { FirmaSinOtpError } from '../inventarios/errors/firma-sin-otp.error';
import { PlantillasContratoRepository } from './plantillas-contrato.repository';
import { ContratosRepository } from './contratos.repository';

/**
 * Contratos (feature #17, R1–R6): merge del template validado + datos del
 * inquilino → PDF (RF-CT3), firma con evidencia (RF-CT4, Ley 527) y
 * almacenamiento en el repositorio documental con el anexo del inventario
 * cerrado (RF-I12, RF-CT5).
 */
@Injectable()
export class ContratosService {
  private readonly generador: GeneradorPdf = new GeneradorPdfPdfLib();

  constructor(
    private readonly repositorio: ContratosRepository,
    private readonly plantillas: PlantillasContratoRepository,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly otp: OtpService,
  ) {}

  /** R1, R2, R4 — generar el contrato (merge) y materializar el PDF. */
  async generar(
    ctx: ContextoPeticion,
    propertyId: string,
    datos: {
      inquilino_id: string;
      fecha_inicio: string;
      fecha_fin: string;
    },
  ): Promise<Contrato> {
    return this.generarInterno(ctx, propertyId, datos);
  }

  private async generarInterno(
    ctx: ContextoPeticion,
    propertyId: string,
    datos: {
      inquilino_id: string;
      fecha_inicio: string;
      fecha_fin: string;
    },
  ): Promise<Contrato> {
    // La plantilla de la propiedad debe estar VALIDADA (R1).
    const plantilla = await this.plantillas.buscarPorPropiedad(ctx, propertyId);
    if (!plantilla || plantilla.estado !== 'validado') {
      throw new DocumentoNoFirmableError(
        'La plantilla de la propiedad no está validada.',
      );
    }

    const { rows: propiedad } = await ctx.cliente.query<{
      id: string;
      direccion: string;
      canon: string;
      propietario_principal_id: string;
    }>(
      `SELECT id, direccion, canon::text AS canon, propietario_principal_id::text AS propietario_principal_id
         FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [propertyId, ctx.tenantId],
    );
    const filaPropiedad = propiedad[0];
    if (!filaPropiedad) throw new ResourceNotFoundError();

    const { rows: inquilino } = await ctx.cliente.query<{
      id: string;
      user_id: string;
      tipo_documento: string;
      documento: string;
      email_contacto: string;
    }>(
      `SELECT id, user_id::text AS user_id, tipo_documento, documento, email_contacto
         FROM perfil_inquilino WHERE id = $1 AND tenant_id = $2`,
      [datos.inquilino_id, ctx.tenantId],
    );
    const filaInquilino = inquilino[0];
    if (!filaInquilino) throw new ResourceNotFoundError();

    // Merge (PA-17-1): campos del template + datos del inquilino.
    const merge = {
      ...plantilla.merge_fields_json,
      nombre_inquilino: await this.nombreDeUsuario(ctx, filaInquilino.user_id),
      documento_inquilino: `${filaInquilino.tipo_documento} ${filaInquilino.documento}`,
      email_inquilino: filaInquilino.email_contacto,
      fecha_inicio: datos.fecha_inicio,
      fecha_fin: datos.fecha_fin,
    };
    const cuerpo = mergear(plantilla.cuerpo, merge);

    const contrato = await this.repositorio.insertarContrato(ctx, {
      propertyId,
      inquilinoId: datos.inquilino_id,
      propietarioId: filaPropiedad.propietario_principal_id,
      fechaInicio: new Date(datos.fecha_inicio),
      fechaFin: new Date(datos.fecha_fin),
    });

    // PDF del contrato (PA-17-1, PA-17-2): repositorio documental.
    const pdf = await this.generador.generar({
      propiedad_direccion: filaPropiedad.direccion,
      propiedad_tipo: 'contrato',
      tipo_evento: 'ENTREGA',
      estado: contrato.estado,
      zonas: [
        {
          nombre: 'CONTRATO DE ARRENDAMIENTO',
          items: [{ nombre: cuerpo, respuesta: null, comentario: null, fotos: [] }],
        },
      ],
    });
    const subido = await this.almacenamiento.subir(pdf.binario, 'application/pdf');
    await ctx.cliente.query(
      `INSERT INTO propiedad_documento
         (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
          hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id, subido_por)
       VALUES ($1, $2, $3, 'contrato_generado', $4, $5, 'application/pdf',
               $6, 'contrato', $7, $8)`,
      [
        ctx.tenantId,
        propertyId,
        `Contrato ${plantilla.nombre}`,
        subido.clave,
        subido.hash_sha256,
        subido.tamano_bytes,
        contrato.id,
        ctx.actorId ?? null,
      ],
    );

    // R4 (RF-I12): el último inventario CERRADO de la propiedad como anexo.
    // El UNIQUE de clave_storage impide duplicar el objeto: el anexo es el
    // MISMO documento con `anexo_de_contrato_id` (PA-17-3).
    const { rows: inventarios } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM inventario
        WHERE tenant_id = $1 AND propiedad_id = $2 AND estado = 'CERRADO' AND activo = true
        ORDER BY updated_at DESC LIMIT 1`,
      [ctx.tenantId, propertyId],
    );
    const inventarioCerrado = inventarios[0];
    if (inventarioCerrado) {
      const { rows: documento } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM propiedad_documento
          WHERE tenant_id = $1 AND entidad_tipo = 'inventario' AND entidad_id = $2
            AND tipo_documento = 'inventario_firmado'
          ORDER BY created_at DESC LIMIT 1`,
        [ctx.tenantId, inventarioCerrado.id],
      );
      const anexo = documento[0];
      if (anexo) {
        await ctx.cliente.query(
          `UPDATE propiedad_documento SET anexo_de_contrato_id = $3
            WHERE id = $1 AND tenant_id = $2`,
          [anexo.id, ctx.tenantId, contrato.id],
        );
      }
    }

    return contrato;
  }

  /** R3 — firma del empleado. */
  async firmarEmpleado(
    ctx: ContextoPeticion,
    contractId: string,
    hashDocumento: string,
    ip: string,
  ): Promise<FirmaContrato> {
    const contrato = await this.repositorio.buscarPorId(ctx, contractId);
    if (!contrato) throw new ResourceNotFoundError();
    await this.validarFirmable(ctx, contrato, hashDocumento);
    if (!ctx.actorId) throw new DocumentoNoFirmableError();
    return this.firmar(ctx, contrato, 'EMPLEADO', ctx.actorId, hashDocumento, ip);
  }

  /** R5 — firma del inquilino (scoping + OTP FIRMA reciente). */
  async firmarInquilino(
    ctx: ContextoPeticion,
    contractId: string,
    hashDocumento: string,
    ip: string,
  ): Promise<FirmaContrato> {
    const contrato = await this.repositorio.buscarPorId(ctx, contractId);
    if (!contrato) throw new ResourceNotFoundError();
    if (!ctx.actorId) throw new ResourceNotFoundError();

    // Scoping (#13, R9): el inquilino autenticado debe ser el del contrato.
    const { rows } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_inquilino
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, ctx.actorId],
    );
    if (rows[0]?.id !== contrato.inquilino_id) {
      throw new ResourceNotFoundError();
    }

    const verificadoEn = await this.otp.firmaVerificadaRecientemente(ctx, ctx.actorId);
    if (!verificadoEn) throw new FirmaSinOtpError();

    await this.validarFirmable(ctx, contrato, hashDocumento);
    return this.firmar(
      ctx,
      contrato,
      'INQUILINO',
      ctx.actorId,
      hashDocumento,
      ip,
      verificadoEn,
    );
  }

  async obtener(ctx: ContextoPeticion, id: string): Promise<Contrato> {
    const contrato = await this.repositorio.buscarPorId(ctx, id);
    if (!contrato) throw new ResourceNotFoundError();
    return contrato;
  }

  async listar(ctx: ContextoPeticion, propertyId?: string): Promise<Contrato[]> {
    return this.repositorio.listar(ctx, { propertyId });
  }

  /** R6 — descargar el PDF del contrato con hash verificado. */
  async obtenerPdfFirmado(
    ctx: ContextoPeticion,
    contractId: string,
  ): Promise<{ binario: Buffer; hash_sha256: string }> {
    const { rows } = await ctx.cliente.query<{ clave_storage: string; hash_sha256: string }>(
      `SELECT clave_storage, hash_sha256 FROM propiedad_documento
        WHERE tenant_id = $1 AND entidad_tipo = 'contrato' AND entidad_id = $2
          AND tipo_documento = 'contrato_generado'
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, contractId],
    );
    const fila = rows[0];
    if (!fila) throw new ResourceNotFoundError();
    const binario = await this.almacenamiento.obtener(fila.clave_storage);
    const hashReal = createHash('sha256').update(binario).digest('hex');
    if (hashReal !== fila.hash_sha256) {
      throw new DocumentoNoFirmableError('El documento no supera la verificación de integridad.');
    }
    return { binario, hash_sha256: fila.hash_sha256 };
  }

  private async firmar(
    ctx: ContextoPeticion,
    contrato: Contrato,
    firmanteTipo: 'EMPLEADO' | 'INQUILINO',
    firmanteUserId: string,
    hashDocumento: string,
    ip: string,
    otpVerificadoEn?: Date,
  ): Promise<FirmaContrato> {
    try {
      const firma = await this.repositorio.insertarFirma(ctx, {
        contractId: contrato.id,
        firmanteTipo,
        firmanteUserId,
        hashDocumento,
        ip,
        otpVerificadoEn,
      });
      const firmas = await this.repositorio.buscarFirmas(ctx, contrato.id);
      const empleado = firmas.find((f) => f.firmante_tipo === 'EMPLEADO');
      const inquilino = firmas.find((f) => f.firmante_tipo === 'INQUILINO');
      if (
        empleado &&
        inquilino &&
        empleado.hash_documento === inquilino.hash_documento &&
        contrato.estado === 'vigente'
      ) {
        await this.repositorio.actualizarEstado(ctx, contrato.id, 'firmado');
      }
      return firma;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new DocumentoNoFirmableError(
          `La parte ${firmanteTipo} ya firmó este contrato.`,
        );
      }
      throw error;
    }
  }

  private async validarFirmable(
    ctx: ContextoPeticion,
    contrato: Contrato,
    hashDocumento: string,
  ): Promise<void> {
    if (contrato.estado !== 'vigente') {
      throw new DocumentoNoFirmableError(
        `El contrato está en ${contrato.estado}; solo se firma en vigente.`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(hashDocumento)) {
      throw new DocumentoNoFirmableError('El hash del documento no es válido.');
    }
    const { rows } = await ctx.cliente.query(
      `SELECT id FROM propiedad_documento
        WHERE tenant_id = $1 AND entidad_tipo = 'contrato' AND entidad_id = $2
          AND tipo_documento = 'contrato_generado' AND hash_sha256 = $3`,
      [ctx.tenantId, contrato.id, hashDocumento],
    );
    if (rows.length === 0) {
      throw new DocumentoNoFirmableError(
        'El documento firmado no coincide con el del contrato.',
      );
    }
  }

  private async nombreDeUsuario(ctx: ContextoPeticion, userId: string): Promise<string> {
    const { rows } = await ctx.cliente.query<{ nombre: string }>(
      `SELECT nombre FROM "user" WHERE id = $1 AND tenant_id = $2`,
      [userId, ctx.tenantId],
    );
    return rows[0]?.nombre ?? '';
  }
}

/** PA-16-2 heredada: todo `{campo}` debe tener valor. */
function mergear(cuerpo: string, campos: Record<string, string>): string {
  return cuerpo.replace(/\{([a-zA-Z0-9_]+)\}/g, (marca, campo: string) => {
    const valor = campos[campo];
    if (valor === undefined) {
      throw new DocumentoNoFirmableError(`Merge field sin valor: {${campo}}.`);
    }
    return valor;
  });
}
