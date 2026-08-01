import { Injectable } from '@nestjs/common';
import type { InventarioCompleto } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { NotificacionesOutboxService } from '../notificaciones/notificaciones-outbox.service';
import { RevisionInventarioRepository } from './revision-inventario.repository';
import { InventariosRepository } from './inventarios.repository';
import { RevisionInvalidaError } from './errors/revision-invalida.error';

/**
 * Revisión del inquilino (feature #13, R6, R7, R9).
 *
 * El SCOPING es por entidad: el perfil del usuario autenticado debe
 * coincidir con `perfil_inquilino_id` del inventario (404 si no, R9). La
 * revisión es de una sola ronda (PA-13-2): UNIQUE por ítem+perfil.
 */
@Injectable()
export class RevisionInventarioService {
  constructor(
    private readonly repositorio: RevisionInventarioRepository,
    private readonly inventarios: InventariosRepository,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly outbox: NotificacionesOutboxService,
  ) {}

  /** R9 — el inquilino lee SOLO su inventario. */
  async obtener(ctx: ContextoPeticion, inventarioId: string): Promise<InventarioCompleto> {
    const perfil = await this.perfilDe(ctx);
    const inventario = await this.repositorio.buscarInventarioDelPerfil(
      ctx,
      inventarioId,
      perfil,
    );
    if (!inventario) {
      throw new ResourceNotFoundError();
    }
    return inventario;
  }

  /** R6, R7 — revisar un ítem (aceptar/objetar, comentario obligatorio al objetar). */
  async revisar(
    ctx: ContextoPeticion,
    inventarioId: string,
    itemId: string,
    datos: {
      respuesta: 'ACEPTADO' | 'OBJETADO';
      comentario?: string;
      foto?: { binario: Buffer; mime: string };
    },
  ): Promise<{ id: string; respuesta: 'ACEPTADO' | 'OBJETADO' }> {
    const perfil = await this.perfilDe(ctx);
    const inventario = await this.repositorio.buscarInventarioDelPerfil(
      ctx,
      inventarioId,
      perfil,
    );
    if (!inventario) {
      throw new ResourceNotFoundError();
    }

    // El ítem debe pertenecer al inventario.
    const item = await this.inventarios.buscarItem(ctx, itemId);
    if (!item) {
      throw new ResourceNotFoundError();
    }
    const zona = await this.inventarios.buscarZona(ctx, item.zona_id);
    if (!zona || zona.inventario_id !== inventario.id) {
      throw new ResourceNotFoundError();
    }

    // R6: objetar SIN comentario → 400 y nada se escribe.
    if (datos.respuesta === 'OBJETADO' && !datos.comentario?.trim()) {
      throw new RevisionInvalidaError(
        'Al objetar un ítem el comentario es obligatorio.',
      );
    }

    // R6: la foto del inquilino (opcional) se sube con autor INQUILINO y se
    // vincula a la revisión (diseño §4).
    let revisionId: string | undefined;
    try {
      const revision = await this.repositorio.insertarRevision(ctx, {
        itemId,
        perfilInquilinoId: perfil,
        respuesta: datos.respuesta,
        comentario: datos.respuesta === 'OBJETADO' ? (datos.comentario ?? '').trim() : null,
      });
      revisionId = revision.id;
    } catch (error) {
      // UNIQUE (item_id, perfil_inquilino_id): ya se revisó este ítem.
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new RevisionInvalidaError('Este ítem ya fue revisado.');
      }
      throw error;
    }

    if (datos.foto) {
      const { clave, hash_sha256 } = await this.almacenamiento.subir(
        datos.foto.binario,
        datos.foto.mime,
      );
      try {
        await this.inventarios.insertarFoto(ctx, {
          itemId,
          claveStorage: clave,
          hashSha256: hash_sha256,
          autor: 'INQUILINO',
          revisionId,
        });
      } catch (error) {
        await this.almacenamiento.borrar(clave);
        throw error;
      }
    }

    // R7: cuando todos los ítems activos tienen revisión → completada, y el
    // empleado (quien creó el inventario) recibe la notificación por el
    // motor de #10 (canal CORREO del creador, diseño §4).
    const [total, revisadas] = await Promise.all([
      this.repositorio.conteoItemsActivos(ctx, inventario.id),
      this.repositorio.conteoRevisiones(ctx, inventario.id, perfil),
    ]);
    if (revisadas >= total && total > 0) {
      await this.repositorio.marcarCompletada(ctx, inventario.id);
      const { rows: creador } = await ctx.cliente.query<{ email: string | null }>(
        `SELECT email FROM "user" WHERE id = $1 AND tenant_id = $2`,
        [inventario.creado_por, ctx.tenantId],
      );
      const emailCreador = creador[0]?.email;
      if (emailCreador) {
        await this.outbox.crear(
          {
            destinatario: emailCreador,
            canal: 'CORREO',
            contenido: {
              asunto: `El inquilino completó la revisión del inventario ${inventario.id}`,
              inventario_id: inventario.id,
              revision_completada: true,
            },
          },
          ctx,
        );
      }
    }

    return { id: revisionId!, respuesta: datos.respuesta };
  }

  private async perfilDe(ctx: ContextoPeticion): Promise<string> {
    if (!ctx.actorId) {
      throw new ResourceNotFoundError();
    }
    const perfil = await this.repositorio.perfilDelUsuario(ctx, ctx.actorId);
    if (!perfil) {
      throw new ResourceNotFoundError();
    }
    return perfil;
  }
}
