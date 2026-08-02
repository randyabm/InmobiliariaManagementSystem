import { Injectable } from '@nestjs/common';
import type { InventarioCompleto } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../../common/errors';
import { AlmacenamientoService } from '../../almacenamiento/almacenamiento.service';
import { GeneradorPdfPdfLib, type GeneradorPdf, type PdfGenerado } from '../firma/generador-pdf';
import { InventariosRepository } from '../inventarios.repository';
import { AcuerdoIncompletoError } from '../errors/acuerdo-incompleto.error';

/**
 * Formato en papel y reconstrucción digital (feature #29, R1–R3, §10.5).
 *
 * R1: el PDF es la MISMA plantilla en representación «tabla sin fotos»
 * (RF-I2: un solo modelo, dos representaciones), con columnas de notas y
 * el ID de vínculo (PA-29-1).
 */
@Injectable()
export class FormatoPapelService {
  private readonly generador: GeneradorPdf = new GeneradorPdfPdfLib();

  constructor(
    private readonly inventarios: InventariosRepository,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** R1 — generar el formato en papel (solo BORRADOR). */
  async generarFormatoPapel(
    ctx: ContextoPeticion,
    inventarioId: string,
  ): Promise<PdfGenerado & { vinculo: string }> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    if (inventario.estado !== 'BORRADOR') {
      throw new AcuerdoIncompletoError(
        `El inventario está en ${inventario.estado}; el formato en papel solo se genera en borrador.`,
      );
    }
    const completo = await this.inventarios.buscarCompleto(ctx, inventarioId);
    if (!completo) throw new ResourceNotFoundError();

    const { rows: propiedad } = await ctx.cliente.query<{ direccion: string; tipo: string }>(
      `SELECT direccion, tipo FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [completo.propiedad_id, ctx.tenantId],
    );
    const fila = propiedad[0];
    if (!fila) throw new ResourceNotFoundError();

    // PA-29-1: un código QR con el ID de vínculo (para retomar el borrador
    // en la reconstrucción, RF-I20). El QR se incrusta como imagen PNG.
    const qr = await generarQr(inventarioId);

    const generado = await this.generador.generar({
      propiedad_direccion: fila.direccion,
      propiedad_tipo: fila.tipo,
      tipo_evento: completo.tipo_evento,
      estado: completo.estado,
      zonas: [
        {
          nombre: 'VÍNCULO DEL FORMATO',
          items: [
            {
              nombre: `ID: ${inventarioId}`,
              respuesta: 'Escaneá el QR o buscá este ID para retomar el borrador.',
              comentario: null,
              fotos: [{ binario: qr, mime: 'image/png' }],
            },
          ],
        },
        ...completo.zonas.map((z) => ({
          nombre: z.nombre,
          items: z.items.map((i) => ({
            nombre: i.nombre,
            // En papel las respuestas van vacías: las llenan a mano (R1).
            respuesta: '________',
            comentario: null,
            fotos: [],
          })),
        })),
      ],
    });

    return {
      ...generado,
      vinculo: inventarioId,
    };
  }

  /**
   * R2 — reconstrucción digital (PA-29-2): notas → ítems, fotos sueltas →
   * su ítem (flujo #12), escaneo del papel como evidencia.
   */
  async reconstruir(
    ctx: ContextoPeticion,
    inventarioId: string,
    datos: {
      notas: Array<{ item_id: string; nota_agente?: string; nota_inquilino?: string }>;
      fotos?: Array<{ item_id: string; binario: Buffer; mime: string }>;
      escaneo?: { binario: Buffer; mime: string };
    },
  ): Promise<InventarioCompleto> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    if (inventario.estado !== 'BORRADOR') {
      throw new AcuerdoIncompletoError(
        'La reconstrucción solo se hace sobre el borrador vinculado al papel.',
      );
    }

    for (const nota of datos.notas) {
      const item = await this.inventarios.buscarItem(ctx, nota.item_id);
      if (!item) throw new ResourceNotFoundError();
      const zona = await this.inventarios.buscarZona(ctx, item.zona_id);
      if (!zona || zona.inventario_id !== inventario.id) {
        throw new ResourceNotFoundError();
      }
      const comentario = [nota.nota_agente, nota.nota_inquilino]
        .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        .join(' | ');
      if (comentario) {
        await this.inventarios.actualizarItem(ctx, nota.item_id, { comentario });
      }
    }

    for (const foto of datos.fotos ?? []) {
      await this.subirFotoEtiquetada(ctx, inventario.id, foto.item_id, foto.binario, foto.mime);
    }

    if (datos.escaneo) {
      const { rows: propiedad } = await ctx.cliente.query<{ id: string }>(
        `SELECT id FROM propiedad WHERE id = $1 AND tenant_id = $2`,
        [inventario.propiedad_id, ctx.tenantId],
      );
      if (propiedad[0]) {
        const { hash_sha256, tamano_bytes, clave } = await this.almacenarEscaneo(
          ctx,
          datos.escaneo.binario,
          datos.escaneo.mime,
        );
        await ctx.cliente.query(
          `INSERT INTO propiedad_documento
             (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
              hash_sha256, mime, tamano_bytes, entidad_tipo, entidad_id, subido_por)
           VALUES ($1, $2, 'Inventario en papel firmado', 'inventario_papel', $3, $4, $5,
                   $6, 'inventario', $7, $8)`,
          [
            ctx.tenantId,
            inventario.propiedad_id,
            clave,
            hash_sha256,
            datos.escaneo.mime,
            tamano_bytes,
            inventarioId,
            ctx.actorId ?? null,
          ],
        );
      }
    }

    const completo = await this.inventarios.buscarCompleto(ctx, inventarioId);
    if (!completo) throw new ResourceNotFoundError();
    return completo;
  }

  /** R3 — confirmar el papel: BORRADOR → ENVIADO con el perfil asignado. */
  async confirmarPapel(
    ctx: ContextoPeticion,
    inventarioId: string,
    perfilInquilinoId: string,
  ): Promise<void> {
    const inventario = await this.inventarios.buscarInventarioPorId(ctx, inventarioId);
    if (!inventario) throw new ResourceNotFoundError();
    if (inventario.estado !== 'BORRADOR') {
      throw new AcuerdoIncompletoError(
        `El inventario está en ${inventario.estado}; solo se confirma el papel en borrador.`,
      );
    }
    const { rows: perfil } = await ctx.cliente.query<{ id: string }>(
      `SELECT id FROM perfil_inquilino WHERE id = $1 AND tenant_id = $2`,
      [perfilInquilinoId, ctx.tenantId],
    );
    if (perfil.length === 0) throw new ResourceNotFoundError();

    await ctx.cliente.query(
      `UPDATE inventario SET estado = 'ENVIADO', perfil_inquilino_id = $3, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND estado = 'BORRADOR'`,
      [inventarioId, ctx.tenantId, perfilInquilinoId],
    );
  }

  private async subirFotoEtiquetada(
    ctx: ContextoPeticion,
    inventarioId: string,
    itemId: string,
    binario: Buffer,
    mime: string,
  ): Promise<void> {
    const item = await this.inventarios.buscarItem(ctx, itemId);
    if (!item) throw new ResourceNotFoundError();
    const zona = await this.inventarios.buscarZona(ctx, item.zona_id);
    if (!zona || zona.inventario_id !== inventarioId) throw new ResourceNotFoundError();

    // Mismo flujo de #12 (R3): MinIO con hash, fila con autor EMPLEADO.
    const subida = await this.almacenamiento.subir(binario, mime);
    await ctx.cliente.query(
      `INSERT INTO inventario_item_foto
         (tenant_id, item_id, clave_storage, hash_sha256, autor)
       VALUES ($1, $2, $3, $4, 'EMPLEADO')`,
      [ctx.tenantId, itemId, subida.clave, subida.hash_sha256],
    );
  }

  private async almacenarEscaneo(
    ctx: ContextoPeticion,
    binario: Buffer,
    mime: string,
  ): Promise<{ clave: string; hash_sha256: string; tamano_bytes: number }> {
    return this.almacenamiento.subir(binario, mime);
  }
}

/**
 * Genera un PNG con el código QR del vínculo (PA-29-1). El binario es
 * puro: sin dependencias de navegador.
 */
async function generarQr(contenido: string): Promise<Buffer> {
  const qrcode = (await import('qrcode')) as typeof import('qrcode');
  return qrcode.toBuffer(contenido, { type: 'png', width: 220, margin: 1 });
}
