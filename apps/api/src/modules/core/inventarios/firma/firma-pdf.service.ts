import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { FirmaInventario, FirmanteTipo } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../../common/errors';
import { AlmacenamientoService } from '../../almacenamiento/almacenamiento.service';
import { OtpService } from '../../otp/otp.service';
import { InventariosRepository } from '../inventarios.repository';
import { AcuerdoIncompletoError } from '../errors/acuerdo-incompleto.error';
import { DocumentoNoFirmableError } from '../errors/documento-no-firmable.error';
import { FirmaSinOtpError } from '../errors/firma-sin-otp.error';
import { FirmaPdfRepository } from './firma-pdf.repository';
import { GeneradorPdfPdfLib, type GeneradorPdf, type PdfGenerado } from './generador-pdf';

/**
 * Firma electrónica y PDF del inventario (feature #14, R1–R7).
 *
 * Flujo: EN_REVISION → (confirmar-acuerdo, exige revisión completa, R6) →
 * ACORDADO → (firma del empleado, R3) → (firma del inquilino con OTP
 * FIRMA reciente, R4) → ambas con el MISMO hash → FIRMADO → CERRADO (R5).
 * El documento vive en el repositorio documental (#6) con su hash (R2, R7,
 * R11) y la evidencia en `inventario_firma` (R3, Ley 527).
 */
@Injectable()
export class FirmaPdfService {
  private readonly generador: GeneradorPdf = new GeneradorPdfPdfLib();

  constructor(
    private readonly repositorio: FirmaPdfRepository,
    private readonly inventarios: InventariosRepository,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly otp: OtpService,
  ) {}

  /** R6 — confirmar el acuerdo: revisión completa → ACORDADO. */
  async confirmarAcuerdo(ctx: ContextoPeticion, inventarioId: string): Promise<void> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    // #13 deja el inventario en ENVIADO tras la invitación; #22 añade
    // EN_NEGOCIACION (versionado, RF-I6). Todos con revisión completa son
    // confirmables (R6).
    const revisable =
      inventario.estado === 'ENVIADO' ||
      inventario.estado === 'EN_REVISION' ||
      inventario.estado === 'EN_NEGOCIACION';
    if (!revisable || inventario.revision_completada_en === null) {
      throw new AcuerdoIncompletoError(
        `El inventario está en ${inventario.estado}; se requiere la revisión completa.`,
      );
    }
    await this.inventarios.actualizarEstado(ctx, inventarioId, 'ACORDADO');
  }

  /**
   * R1 — generar el PDF consolidado y materializarlo en el repositorio
   * documental (#6) con su hash. Un mismo documento para ambas firmas:
   * regenerar el mismo contenido produce el mismo hash (sin fechas
   * automáticas).
   */
  async generarPdf(ctx: ContextoPeticion, inventarioId: string): Promise<PdfGenerado> {
    const completo = await this.inventarios.buscarCompleto(ctx, inventarioId);
    if (!completo) throw new ResourceNotFoundError();

    // Ya materializado: el documento es único (mismo hash para firmar).
    const existente = await ctx.cliente.query(
      `SELECT id FROM propiedad_documento
        WHERE tenant_id = $1 AND entidad_tipo = 'inventario' AND entidad_id = $2
          AND tipo_documento = 'inventario_firmado'`,
      [ctx.tenantId, inventarioId],
    );
    if ((existente.rowCount ?? 0) > 0) {
      throw new DocumentoNoFirmableError('El documento del inventario ya fue generado.');
    }

    const { rows: propiedad } = await ctx.cliente.query<{
      direccion: string;
      tipo: string;
    }>(
      `SELECT direccion, tipo FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [completo.propiedad_id, ctx.tenantId],
    );
    const filaPropiedad = propiedad[0];
    if (!filaPropiedad) throw new ResourceNotFoundError();

    // Fotos desde MinIO (#6): incrustadas en el PDF (R1).
    const zonasConFotos = [];
    for (const zona of completo.zonas) {
      const items = [];
      for (const item of zona.items) {
        const fotos = [];
        for (const foto of item.fotos) {
          try {
            fotos.push({ binario: await this.almacenamiento.obtener(foto.clave_storage), mime: 'image/jpeg' });
          } catch {
            // Una foto inaccesible no bloquea el documento: se omite.
          }
        }
        items.push({
          nombre: item.nombre,
          respuesta: item.estado_checklist ?? JSON.stringify(item.valor_respuesta) ?? null,
          comentario: item.comentario,
          fotos,
        });
      }
      zonasConFotos.push({ nombre: zona.nombre, items });
    }

    const generado = await this.generador.generar({
      propiedad_direccion: filaPropiedad.direccion,
      propiedad_tipo: filaPropiedad.tipo,
      tipo_evento: completo.tipo_evento,
      estado: completo.estado,
      zonas: zonasConFotos,
    });

    // R2: el documento queda en el repositorio documental con su hash.
    const subido = await this.almacenamiento.subir(generado.binario, 'application/pdf');
    await ctx.cliente.query(
      `INSERT INTO propiedad_documento
         (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
          hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id, subido_por)
       VALUES ($1, $2, $3, 'inventario_firmado', $4, $5, 'application/pdf',
               $6, 'inventario', $7, $8)`,
      [
        ctx.tenantId,
        completo.propiedad_id,
        `Inventario ${completo.tipo_evento} firmado`,
        subido.clave,
        subido.hash_sha256,
        subido.tamano_bytes,
        inventarioId,
        ctx.actorId ?? null,
      ],
    );

    return generado;
  }

  /** R3, R5 — firma del EMPLEADO: exige ACORDADO y el documento generado. */
  async firmarEmpleado(
    ctx: ContextoPeticion,
    inventarioId: string,
    hashDocumento: string,
    ip: string,
  ): Promise<FirmaInventario> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    await this.validarFirmable(ctx, inventarioId, inventario.estado, hashDocumento);

    if (!ctx.actorId) throw new DocumentoNoFirmableError();
    const firma = await this.insertarFirmaProtegida(ctx, {
      inventarioId,
      firmanteTipo: 'EMPLEADO',
      firmanteUserId: ctx.actorId,
      hashDocumento,
      ip,
    });
    await this.transicionarSiCompleta(ctx, inventarioId);
    return firma;
  }

  /**
   * R4, R5 — firma del INQUILINO: scoping por perfil (#13) + OTP de FIRMA
   * verificado en los últimos 10 min (RF-AU3); 401 uniforme si no.
   */
  async firmarInquilino(
    ctx: ContextoPeticion,
    inventarioId: string,
    hashDocumento: string,
    ip: string,
  ): Promise<FirmaInventario> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();

    // Scoping R9 de #13: solo el inquilino asignado firma SU inventario.
    if (!ctx.actorId) throw new ResourceNotFoundError();
    const { rows: perfil } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_inquilino
        WHERE tenant_id = $1 AND user_id = $2`,
      [ctx.tenantId, ctx.actorId],
    );
    const perfilId = perfil[0]?.id;
    if (!perfilId || inventario.perfil_inquilino_id !== perfilId) {
      throw new ResourceNotFoundError();
    }

    // R4: OTP de FIRMA recién verificado (ventana de 10 min).
    const verificadoEn = await this.otp.firmaVerificadaRecientemente(ctx, ctx.actorId);
    if (!verificadoEn) {
      throw new FirmaSinOtpError();
    }

    await this.validarFirmable(ctx, inventarioId, inventario.estado, hashDocumento);
    const firma = await this.insertarFirmaProtegida(ctx, {
      inventarioId,
      firmanteTipo: 'INQUILINO',
      firmanteUserId: ctx.actorId,
      hashDocumento,
      ip,
      otpVerificadoEn: verificadoEn,
    });
    await this.transicionarSiCompleta(ctx, inventarioId);
    return firma;
  }

  /** R7, R11 — descargar el documento y verificar su hash antes de responder. */
  async obtenerPdfFirmado(ctx: ContextoPeticion, inventarioId: string): Promise<{
    binario: Buffer;
    hash_sha256: string;
  }> {
    const { rows } = await ctx.cliente.query<{ clave_storage: string; hash_sha256: string }>(
      `SELECT clave_storage, hash_sha256 FROM propiedad_documento
        WHERE tenant_id = $1 AND entidad_tipo = 'inventario' AND entidad_id = $2
          AND tipo_documento = 'inventario_firmado'
        ORDER BY created_at DESC LIMIT 1`,
      [ctx.tenantId, inventarioId],
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

  /** R5 — el documento existe y coincide; el inventario está en ACORDADO. */
  private async validarFirmable(
    ctx: ContextoPeticion,
    inventarioId: string,
    estado: string,
    hashDocumento: string,
  ): Promise<void> {
    if (estado !== 'ACORDADO') {
      throw new DocumentoNoFirmableError(
        `El inventario está en ${estado}; solo se firma en ACORDADO.`,
      );
    }
    if (!/^[0-9a-f]{64}$/.test(hashDocumento)) {
      throw new DocumentoNoFirmableError('El hash del documento no es válido.');
    }
    const { rows } = await ctx.cliente.query(
      `SELECT id FROM propiedad_documento
        WHERE tenant_id = $1 AND entidad_tipo = 'inventario' AND entidad_id = $2
          AND tipo_documento = 'inventario_firmado' AND hash_sha256 = $3`,
      [ctx.tenantId, inventarioId, hashDocumento],
    );
    if (rows.length === 0) {
      throw new DocumentoNoFirmableError('El documento firmado no coincide con el del inventario.');
    }
  }

  /** R5 — una firma por parte: el UNIQUE del motor se traduce en 409. */
  private async insertarFirmaProtegida(
    ctx: ContextoPeticion,
    datos: {
      inventarioId: string;
      firmanteTipo: FirmanteTipo;
      firmanteUserId: string;
      hashDocumento: string;
      ip: string;
      otpVerificadoEn?: Date;
    },
  ): Promise<FirmaInventario> {
    try {
      return await this.repositorio.insertarFirma(ctx, datos);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new DocumentoNoFirmableError(
          `La parte ${datos.firmanteTipo} ya firmó este inventario.`,
        );
      }
      throw error;
    }
  }

  /** R5 — ambas partes firmaron el MISMO hash → FIRMADO → CERRADO. */
  private async transicionarSiCompleta(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<void> {
    const firmas = await this.repositorio.buscarFirmas(ctx, inventarioId);
    const empleado = firmas.find((f) => f.firmante_tipo === 'EMPLEADO');
    const inquilino = firmas.find((f) => f.firmante_tipo === 'INQUILINO');
    if (empleado && inquilino && empleado.hash_documento === inquilino.hash_documento) {
      await this.inventarios.actualizarEstado(ctx, inventarioId, 'FIRMADO');
      // El documento ya está materializado (R2 en `generarPdf`): se cierra.
      await this.inventarios.actualizarEstado(ctx, inventarioId, 'CERRADO');
    }
  }
}
