import { beforeEach, describe, expect, it, vi } from 'vitest';
import { abrirAlmacen, almacen } from '../almacen-local';
import { ClienteApi, type Peticion, type Respuesta, type Transporte } from '../../api/cliente-api';
import { MotorSync } from '../motor-sync';

/**
 * E2E de pérdida de conexión (T11 → R2, R5, R7, R8, R11).
 *
 * Transporte mock que «pierde la conexión» (lanza `offline`) y la
 * recupera. El «backend» registra las operaciones recibidas y las confirma
 * con el `updated_at` esperado. La compresión de fotos se dobla (jsdom no
 * tiene canvas): aquí lo que importa es la COLA y el ORDEN del sync.
 */

class TransporteMock implements Transporte {
  apagado = false;
  recibidas: Array<{ metodo: string; ruta: string; cuerpo: unknown }> = [];
  private contador = 0;

  async request(peticion: Peticion): Promise<Respuesta> {
    if (this.apagado) {
      throw new Error('offline');
    }
    this.recibidas.push({ metodo: peticion.metodo, ruta: peticion.ruta, cuerpo: peticion.cuerpo });
    this.contador += 1;
    const updatedAt = `2026-08-01T00:00:${String(this.contador).padStart(2, '0')}Z`;
    if (peticion.ruta === '/inventarios' && peticion.metodo === 'POST') {
      return {
        status: 201,
        cuerpo: { id: 'inv-servidor', updated_at: updatedAt, estado: 'BORRADOR' },
      };
    }
    if (peticion.ruta.includes('/fotos') && peticion.metodo === 'POST') {
      return { status: 201, cuerpo: { id: 'foto-1', hash_sha256: 'a'.repeat(64), autor: 'EMPLEADO' } };
    }
    return { status: 200, cuerpo: { updated_at: updatedAt } };
  }
}

describe('E2E — pérdida de conexión (T11: R2, R5, R7, R8, R11)', () => {
  let transporte: TransporteMock;
  let api: ClienteApi;
  let motor: MotorSync;

  beforeEach(async () => {
    const db = await abrirAlmacen();
    await Promise.all([db.clear('cola'), db.clear('inventarios'), db.clear('cache')]);
    transporte = new TransporteMock();
    api = new ClienteApi(transporte);
    motor = new MotorSync(api);

    // Doblar la compresión (jsdom no implementa canvas): el blob ya viene
    // «comprimido» a la cola, que es lo que el E2E verifica (R9 se prueba
    // en `compresor-fotos.test.ts`).
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => undefined }),
      toDataURL: () => 'data:image/webp;base64,xx',
      toBlob: (cb: (blob: Blob | null) => void) => cb?.(new Blob(['webp'], { type: 'image/webp' })),
    };
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 100,
      height: 100,
      close: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb?.(new Blob(['webp'], { type: 'image/webp' }));
    });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  });

  it('offline completo → pendientes → sync en orden → indicador limpio', async () => {
    // 1) «Sesión» en línea.
    await api.setAccessToken('token-de-prueba');

    // 2) APAGADO: se pierde la conexión.
    transporte.apagado = true;

    // Trabajo offline completo (R2): inventario + zonas + ítems + foto.
    const inv = await motor.crearInventarioLocal('prop-1', 'ENTREGA');
    const conZonas = {
      ...inv,
      estado: 'BORRADOR',
      base_version: null,
      updated_at: null,
      zonas: [
        {
          id: 'zona-local-1',
          nombre: 'Sala',
          repetible: false,
          orden: 0,
          items: [
            {
              id: 'item-local-1',
              nombre: 'Paredes',
              field_type: 'estado' as const,
              estado_checklist: null,
              comentario: null,
              valor_respuesta: null,
              fotos: [] as Array<{ id: string; datos: Blob; mime: string }>,
            },
          ],
        },
      ],
    };
    await almacen.guardarInventario(conZonas);
    await motor.responderItemLocal(inv.id, 'item-local-1', { estado_checklist: 'REGULAR' });
    await motor.adjuntarFotoLocal(inv.id, 'item-local-1', new Blob(['x'.repeat(1024)], { type: 'image/jpeg' }));

    // R5: indicador de pendientes MIENTRAS no haya conexión.
    const cola = await almacen.listarCola();
    expect(cola.every((o) => o.estado === 'pendiente')).toBe(true);
    expect(cola.length).toBeGreaterThanOrEqual(3);

    // 3) ENCENDIDO: la conexión se recupera → sync.
    transporte.apagado = false;
    const resultado = await motor.sincronizar();
    expect(resultado.conflictos).toBe(0);
    expect(resultado.errores).toBe(0);

    // R8: el backend recibió las operaciones en orden (padres → hijos).
    expect(transporte.recibidas.map((r) => r.ruta)).toEqual([
      '/inventarios',
      `/inventarios/${inv.id}/items/item-local-1`,
      `/inventarios/${inv.id}/items/item-local-1/fotos`,
    ]);

    // R5: el indicador se limpia SOLO con la confirmación del backend.
    const despues = await almacen.listarCola();
    expect(despues.every((o) => o.estado === 'confirmada')).toBe(true);

    // R4/R8: la versión base quedó actualizada con la del servidor.
    const confirmada = despues.find((o) => o.tipo === 'crear_inventario');
    expect(confirmada?.base_version).toMatch(/^2026-08-01T/);
  });

  it('un fallo persistente marca conflicto y NO pierde la cola (R8)', async () => {
    transporte.apagado = true;
    await motor.crearInventarioLocal('prop-1', 'DEVOLUCION');
    transporte.apagado = false;
    transporte.request = async () => ({ status: 500, cuerpo: {} });

    const resultado = await motor.sincronizar();
    expect(resultado.errores).toBeGreaterThan(0);

    const cola = await almacen.listarCola();
    expect(cola.length).toBeGreaterThan(0); // la cola NO se perdió
    expect(cola.some((o) => o.estado === 'conflicto')).toBe(true);
  });
});
