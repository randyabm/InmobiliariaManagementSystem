/**
 * Cola de sincronización (feature #15, R4, R8).
 *
 * Cada operación lleva su orden (padres antes que hijos: inventario →
 * zonas → ítems → fotos) y la versión base (`updated_at` del servidor en
 * el último sync, R4) para detectar conflictos (R6).
 */
import {
  almacen,
  type InventarioLocal,
  type OperacionCola,
  type TipoOperacion,
} from './almacen-local';

export interface OperacionNueva {
  tipo: TipoOperacion;
  entidad_id: string;
  inventario_id: string;
  datos: Record<string, unknown>;
  base_version: string | null;
}

export async function encolarOperacion(op: OperacionNueva): Promise<OperacionCola> {
  return almacen.encolar(op);
}

/** R8 — la cola en orden de ejecución (padres antes que hijos). */
export async function listarEnOrden(): Promise<OperacionCola[]> {
  return almacen.listarCola();
}

export async function pendientes(): Promise<OperacionCola[]> {
  return almacen.pendientes();
}

/** R8 — confirmada SOLO con 2xx del backend. */
export async function marcarConfirmada(id: string, baseVersion: string | null): Promise<void> {
  await almacen.marcarConfirmada(id, baseVersion);
}

/** R6 — divergencia de `updated_at`: conflicto, nunca sobrescritura muda. */
export async function marcarConflicto(id: string, detalle: string): Promise<void> {
  await almacen.marcarConflicto(id, detalle);
}

/** R6 — «conservar local»: reencola con la versión del servidor como base. */
export async function conservarLocal(id: string, baseVersion: string | null): Promise<void> {
  if (baseVersion !== null) {
    await almacen.reencolarConBase(id, baseVersion);
  } else {
    await almacen.reencolar(id);
  }
}

/** R6 — «conservar remoto»: descarta la operación local. */
export async function conservarRemoto(id: string): Promise<void> {
  await almacen.borrarOperacion(id);
}

export async function marcarConfirmadoInventario(
  inv: InventarioLocal,
  updatedAt: string,
): Promise<void> {
  await almacen.guardarInventario({ ...inv, origen: 'servidor', base_version: updatedAt, updated_at: updatedAt });
}

/** R5 — el indicador se enciende con CUALQUIER operación no confirmada. */
export async function hayPendientes(): Promise<boolean> {
  return (await almacen.pendientes()).length > 0;
}
