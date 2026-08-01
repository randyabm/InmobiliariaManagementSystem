/**
 * Motor de sincronización (feature #15, R4, R6, R7, R8).
 *
 * Procesa la cola en orden; cada operación se envía por el transporte, se
 * confirma SOLO con 2xx (R8), y si el `updated_at` del servidor difiere de
 * la versión base local → conflicto (R6). Sin superposición (flag
 * `enSync`); el botón manual y el evento `online` comparten el mismo motor
 * (R7).
 */
import { ClienteApi } from '../api/cliente-api';
import {
  almacen,
  type InventarioLocal,
  type OperacionCola,
} from './almacen-local';
import { encolarOperacion, marcarConflicto, marcarConfirmada } from './cola-sync';
import { comprimirFoto } from './compresor-fotos';

export interface ResultadoSync {
  confirmadas: number;
  conflictos: number;
  errores: number;
}

export class MotorSync {
  private enSync = false;

  constructor(private readonly api: ClienteApi) {}

  get ocupado(): boolean {
    return this.enSync;
  }

  /**
   * R2 — crear inventario LOCAL: persiste el borrador en IndexedDB y
   * encola la operación; nada se envía hasta el sync (R8).
   */
  async crearInventarioLocal(
    propiedadId: string,
    tipoEvento: 'ENTREGA' | 'DEVOLUCION',
  ): Promise<{ id: string; propiedad_id: string; tipo_evento: 'ENTREGA' | 'DEVOLUCION'; origen: 'local' }> {
    const id = crypto.randomUUID();
    const inv = {
      id,
      propiedad_id: propiedadId,
      tipo_evento: tipoEvento,
      estado: 'BORRADOR',
      origen: 'local' as const,
      base_version: null,
      updated_at: null,
      zonas: [] as InventarioLocal['zonas'],
    };
    await almacen.guardarInventario(inv);
    await encolarOperacion({
      tipo: 'crear_inventario',
      entidad_id: id,
      inventario_id: id,
      datos: { propiedad_id: propiedadId, tipo_evento: tipoEvento, id },
      base_version: null,
    });
    return inv;
  }

  /** R2 — responder un ítem en el borrador local (encola el PATCH). */
  async responderItemLocal(
    inventarioId: string,
    itemId: string,
    datos: Record<string, unknown>,
  ): Promise<void> {
    const inv = await almacen.obtenerInventario(inventarioId);
    if (!inv) return;
    await encolarOperacion({
      tipo: 'responder_item',
      entidad_id: itemId,
      inventario_id: inventarioId,
      datos,
      base_version: inv.base_version,
    });
  }

  /** R2, R9 — adjuntar foto: comprime en el dispositivo y encola el binario. */
  async adjuntarFotoLocal(
    inventarioId: string,
    itemId: string,
    archivo: File | Blob,
  ): Promise<void> {
    const inv = await almacen.obtenerInventario(inventarioId);
    if (!inv) return;
    const comprimida = await comprimirFoto(archivo);
    // El binario se guarda como ArrayBuffer: los Blobs no sobreviven al
    // clonado estructurado de todos los IndexedDB (y fake-indexeddb).
    await encolarOperacion({
      tipo: 'subir_foto',
      entidad_id: itemId,
      inventario_id: inventarioId,
      datos: { buffer: await blobAArrayBuffer(comprimida.blob), mime: comprimida.mime },
      base_version: inv.base_version,
    });
  }

  /** R4, R8 — una corrida: procesa la cola en orden sin superponerse. */
  async sincronizar(): Promise<ResultadoSync> {
    if (this.enSync) {
      return { confirmadas: 0, conflictos: 0, errores: 0 };
    }
    this.enSync = true;
    const resultado: ResultadoSync = { confirmadas: 0, conflictos: 0, errores: 0 };
    try {
      const cola = await almacen.listarCola();
      // R8: solo los inventarios CREADOS en campo tienen que esperar al
      // `crear_inventario`; los descargados (editados offline) pasan.
      const creadoresPendientes = cola.filter(
        (o) => o.tipo === 'crear_inventario' && o.estado !== 'confirmada',
      );
      const confirmados = new Set<string>();
      for (const op of cola) {
        if (op.estado === 'confirmada') continue;
        if (op.estado === 'conflicto') {
          resultado.conflictos += 1;
          continue;
        }
        // R8: los hijos esperan al padre confirmado (solo si el padre es
        // una creación local aún no confirmada).
        if (op.tipo !== 'crear_inventario') {
          const esperaPadre = creadoresPendientes.some(
            (c) => c.inventario_id === op.inventario_id && !confirmados.has(c.inventario_id),
          );
          if (esperaPadre) continue;
        }
        try {
          const confirmado = await this.enviar(op);
          if (confirmado) {
            confirmados.add(op.inventario_id);
            resultado.confirmadas += 1;
          } else {
            // R6: divergencia de versión → conflicto (ya marcado en la cola).
            resultado.conflictos += 1;
          }
        } catch (error) {
          // 4xx/5xx persistente: visible, la cola NO se pierde (R8).
          resultado.errores += 1;
          await marcarConflicto(op.id, error instanceof Error ? error.message : String(error));
          resultado.conflictos += 1;
        }
      }
      return resultado;
    } finally {
      this.enSync = false;
    }
  }

  /**
   * R6 — envía la operación; si el servidor responde con un `updated_at`
   * distinto de la versión base → conflicto (nunca sobrescritura muda).
   */
  private async enviar(op: OperacionCola): Promise<boolean> {
    const { metodo, ruta, cuerpo } = this.rutaDe(op);
    const respuesta = await this.api.request<Record<string, unknown>>(metodo, ruta, cuerpo);
    if (respuesta.status >= 200 && respuesta.status < 300) {
      const updatedAt = typeof respuesta.cuerpo?.updated_at === 'string'
        ? (respuesta.cuerpo.updated_at as string)
        : null;
      if (updatedAt && op.base_version && updatedAt !== op.base_version) {
        await marcarConflicto(op.id, 'El servidor tiene una versión más nueva de esta entidad.');
        return false;
      }
      await marcarConfirmada(op.id, updatedAt);
      await this.actualizarInventarioLocal(op, updatedAt);
      return true;
    }
    throw new Error(`HTTP ${respuesta.status}`);
  }

  private async actualizarInventarioLocal(op: OperacionCola, updatedAt: string | null): Promise<void> {
    const inv = await almacen.obtenerInventario(op.inventario_id);
    if (!inv) return;
    if (op.tipo === 'crear_inventario') {
      const servidorId = typeof op.datos.id === 'string' ? (op.datos.id as string) : op.inventario_id;
      await almacen.guardarInventario({
        ...inv,
        id: servidorId,
        origen: 'servidor',
        base_version: updatedAt,
        updated_at: updatedAt,
      });
      return;
    }
    await almacen.guardarInventario({
      ...inv,
      base_version: updatedAt ?? inv.base_version,
      updated_at: updatedAt ?? inv.updated_at,
    });
  }

  /** Mapa operación → llamada al backend de #12. */
  private rutaDe(op: OperacionCola): {
    metodo: 'POST' | 'PATCH';
    ruta: string;
    cuerpo: unknown;
  } {
    switch (op.tipo) {
      case 'crear_inventario':
        return {
          metodo: 'POST',
          ruta: '/inventarios',
          cuerpo: { propiedad_id: op.datos.propiedad_id, tipo_evento: op.datos.tipo_evento },
        };
      case 'crear_zona':
        return {
          metodo: 'POST',
          ruta: `/inventarios/${op.inventario_id}/zonas`,
          cuerpo: {
            nombre: op.datos.nombre,
            repetible: op.datos.repetible,
            orden: op.datos.orden,
          },
        };
      case 'editar_zona':
        return {
          metodo: 'PATCH',
          ruta: `/inventarios/${op.inventario_id}/zonas/${op.entidad_id}`,
          cuerpo: op.datos,
        };
      case 'crear_item':
        return {
          metodo: 'POST',
          ruta: `/inventarios/${op.inventario_id}/zonas/${String(op.datos.zona_id)}/items`,
          cuerpo: {
            nombre: op.datos.nombre,
            field_type: op.datos.field_type,
            opciones_json: op.datos.opciones_json,
            foto_obligatoria: op.datos.foto_obligatoria,
          },
        };
      case 'responder_item':
        return {
          metodo: 'PATCH',
          ruta: `/inventarios/${op.inventario_id}/items/${op.entidad_id}`,
          cuerpo: op.datos,
        };
      case 'subir_foto': {
        // R9: el binario comprimido viaja en FormData; el original nunca.
        const crudo = op.datos.buffer;
        const buffer =
          crudo instanceof ArrayBuffer
            ? crudo
            : new Uint8Array((crudo as number[] | ArrayBufferView).valueOf() as ArrayBuffer);
        const blob = new Blob([buffer], { type: String(op.datos.mime ?? 'image/jpeg') });
        const form = new FormData();
        form.append('archivo', blob, `foto-${op.entidad_id}.webp`);
        return {
          metodo: 'POST',
          ruta: `/inventarios/${op.inventario_id}/items/${op.entidad_id}/fotos`,
          cuerpo: form,
        };
      }
    }
  }
}

/** R3 — refresca la caché tras un sync exitoso (prefetch de campo). */
export async function refrescarCache(api: ClienteApi): Promise<void> {
  try {
    const propiedades = await api.request<Array<Record<string, unknown>>>('GET', '/propiedades');
    if (propiedades.status === 200) {
      await almacen.limpiarCache('propiedades');
      for (const p of propiedades.cuerpo) {
        await almacen.guardarCache('propiedades', String(p.id), p);
      }
    }
    const plantillas = await api.request<Array<Record<string, unknown>>>('GET', '/plantillas');
    if (plantillas.status === 200) {
      await almacen.limpiarCache('plantillas');
      for (const p of plantillas.cuerpo) {
        await almacen.guardarCache('plantillas', String(p.id), p);
      }
    }
    const borradores = await api.request<Array<Record<string, unknown>>>('GET', '/inventarios?estado=BORRADOR');
    if (borradores.status === 200) {
      for (const b of borradores.cuerpo) {
        const inv = b as unknown as InventarioLocal;
        await almacen.guardarInventario({
          id: inv.id,
          propiedad_id: inv.propiedad_id,
          tipo_evento: inv.tipo_evento,
          estado: inv.estado,
          origen: 'servidor',
          base_version: inv.updated_at,
          updated_at: inv.updated_at,
          zonas: [],
        });
      }
    }
  } catch {
    // Sin conexión: la caché anterior sigue sirviendo.
  }
}

/** FileReader: la única vía de leer un Blob en todos los navegadores y jsdom. */
function blobAArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result as ArrayBuffer);
    lector.onerror = () => rechazar(new Error('No se pudo leer el binario.'));
    lector.readAsArrayBuffer(blob);
  });
}
