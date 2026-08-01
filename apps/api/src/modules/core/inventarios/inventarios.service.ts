import { Injectable } from '@nestjs/common';
import type {
  EstadoInventario,
  InventarioCompleto,
  TipoEventoInventario,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { PlantillasService } from '../plantillas/plantillas.service';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { InventariosRepository } from './inventarios.repository';
import { InventarioBorradorYaExisteError } from './errors/inventario-borrador-ya-existe.error';

/**
 * Orquesta la creación y edición del inventario (feature #12, R1–R11):
 *
 * - R1/R4: el alta materializa la plantilla vigente (copia TENANT o SISTEMA,
 *   PA-12-3) en el mismo snapshot, dentro de la transacción del alta.
 * - PA-12-2: un solo borrador por (propiedad, tipo_evento).
 * - R6: las zonas se reordenan como lista; R7/R8: la respuesta de un ítem.
 * - R3/R10: las fotos viven en object storage (#6); la fila con su hash.
 *
 * Las transiciones fuera de `BORRADOR` (enviar/revisar/firmar/cerrar) son de
 * las features #13 y #14: aquí solo se lee el estado, nunca se muta.
 */
@Injectable()
export class InventariosService {
  constructor(
    private readonly repositorio: InventariosRepository,
    private readonly plantillas: PlantillasService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** R1, R4 — alta con materialización de la plantilla vigente. */
  async crear(
    datos: {
      propiedadId: string;
      tipoEvento: TipoEventoInventario;
    },
    ctx: ContextoPeticion,
  ): Promise<InventarioCompleto> {
    const duplicado = await this.repositorio.buscarBorrador(
      ctx,
      datos.propiedadId,
      datos.tipoEvento,
    );
    if (duplicado) {
      throw new InventarioBorradorYaExisteError();
    }

    const propiedad = await ctx.cliente.query(
      `SELECT id, tipo FROM propiedad WHERE id = $1 AND tenant_id = $2`,
      [datos.propiedadId, ctx.tenantId],
    );
    if (propiedad.rowCount === 0) {
      throw new ResourceNotFoundError();
    }

    const plantilla = await this.plantillas.resolverPlantillaParaTenant(
      propiedad.rows[0]!.tipo,
      ctx,
    );
    if (!plantilla) {
      throw new ResourceNotFoundError('No existe plantilla activa para este tipo de propiedad.');
    }

    const inventario = await this.repositorio.insertarInventario(ctx, {
      propiedadId: datos.propiedadId,
      tipoEvento: datos.tipoEvento,
      creadoPor: ctx.actorId ?? null,
    });

    await this.repositorio.materializarPlantilla(
      ctx.cliente,
      plantilla.id,
      inventario.id,
      ctx.tenantId,
    );

    const completo = await this.repositorio.buscarCompleto(ctx, inventario.id);
    if (!completo) {
      throw new Error('El inventario recién creado no es legible.');
    }
    return completo;
  }

  async listar(
    ctx: ContextoPeticion,
    filtros: {
      propiedadId?: string;
      estado?: EstadoInventario;
      tipoEvento?: TipoEventoInventario;
    } = {},
  ): Promise<InventarioCompleto[]> {
    const lista = await this.repositorio.listar(ctx, filtros);
    const completos: InventarioCompleto[] = [];
    for (const inventario of lista) {
      const completo = await this.repositorio.buscarCompleto(ctx, inventario.id);
      if (completo) completos.push(completo);
    }
    return completos;
  }

  async obtener(ctx: ContextoPeticion, id: string): Promise<InventarioCompleto> {
    const completo = await this.repositorio.buscarCompleto(ctx, id);
    if (!completo) {
      throw new ResourceNotFoundError();
    }
    return completo;
  }

  /** R6 — reordenar zonas (recibe la lista completa en el nuevo orden). */
  async reordenarZonas(ctx: ContextoPeticion, id: string, idsEnOrden: string[]): Promise<void> {
    await this.exigirBorrador(ctx, id);
    await this.repositorio.reordenarZonas(ctx, idsEnOrden);
  }

  /** R7 — editar una zona del borrador. */
  async actualizarZona(
    ctx: ContextoPeticion,
    id: string,
    zonaId: string,
    cambios: { nombre?: string; orden?: number; repetible?: boolean },
  ): Promise<void> {
    const inventario = await this.exigirBorrador(ctx, id);
    const zona = await this.repositorio.buscarZona(ctx, zonaId);
    if (!zona || zona.inventario_id !== inventario.id) {
      throw new ResourceNotFoundError();
    }
    await this.repositorio.actualizarZona(ctx, zonaId, cambios);
  }

  /** R8 — registrar la respuesta de un ítem (estado, valor, comentario). */
  async responderItem(
    ctx: ContextoPeticion,
    id: string,
    itemId: string,
    cambios: {
      estadoChecklist?: 'BUENO' | 'REGULAR' | 'MALO';
      valorRespuesta?: Record<string, unknown>;
      comentario?: string;
    },
  ): Promise<void> {
    const inventario = await this.exigirBorrador(ctx, id);
    const item = await this.repositorio.buscarItem(ctx, itemId);
    if (!item) {
      throw new ResourceNotFoundError();
    }
    const zona = await this.repositorio.buscarZona(ctx, item.zona_id);
    if (!zona || zona.inventario_id !== inventario.id) {
      throw new ResourceNotFoundError();
    }
    await this.repositorio.actualizarItem(ctx, itemId, cambios);
  }

  /** R3 — sube la foto a object storage y registra la fila con su hash. */
  async subirFoto(
    ctx: ContextoPeticion,
    id: string,
    itemId: string,
    binario: Buffer,
    mime: string,
  ): Promise<{ id: string; hash_sha256: string; autor: 'EMPLEADO' }> {
    const inventario = await this.exigirBorrador(ctx, id);
    const item = await this.repositorio.buscarItem(ctx, itemId);
    if (!item) {
      throw new ResourceNotFoundError();
    }
    const zona = await this.repositorio.buscarZona(ctx, item.zona_id);
    if (!zona || zona.inventario_id !== inventario.id) {
      throw new ResourceNotFoundError();
    }

    const { clave, hash_sha256 } = await this.almacenamiento.subir(binario, mime);
    try {
      const foto = await this.repositorio.insertarFoto(ctx, {
        itemId,
        claveStorage: clave,
        hashSha256: hash_sha256,
        autor: 'EMPLEADO',
      });
      return { id: foto.id, hash_sha256, autor: 'EMPLEADO' };
    } catch (error) {
      await this.almacenamiento.borrar(clave);
      throw error;
    }
  }

  /** R10 — baja lógica de una foto: la fila muere, el objeto se conserva. */
  async eliminarFoto(ctx: ContextoPeticion, id: string, fotoId: string): Promise<void> {
    const inventario = await this.exigirBorrador(ctx, id);
    const foto = await this.repositorio.buscarFoto(ctx, fotoId);
    if (!foto) {
      throw new ResourceNotFoundError();
    }
    const item = await this.repositorio.buscarItem(ctx, foto.item_id);
    if (!item) {
      throw new ResourceNotFoundError();
    }
    const zona = await this.repositorio.buscarZona(ctx, item.zona_id);
    if (!zona || zona.inventario_id !== inventario.id) {
      throw new ResourceNotFoundError();
    }
    await this.repositorio.marcarFotoInactiva(ctx, fotoId);
  }

  /** R5 — eliminar el borrador (nunca un inventario no-BORRADOR). */
  async eliminar(ctx: ContextoPeticion, id: string): Promise<void> {
    await this.exigirBorrador(ctx, id);
    await this.repositorio.bajaLogicaCompleta(ctx, id);
  }

  private async exigirBorrador(ctx: ContextoPeticion, id: string) {
    const inventario = await this.repositorio.buscarInventarioPorId(ctx, id);
    if (!inventario) {
      throw new ResourceNotFoundError();
    }
    if (inventario.estado !== 'BORRADOR') {
      throw new InventarioBorradorYaExisteError(
        `El inventario está en ${inventario.estado}; solo se edita en borrador.`,
      );
    }
    return inventario;
  }
}
