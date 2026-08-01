import { beforeEach, describe, expect, it, vi } from 'vitest';
import { comprimirFoto, MAX_DIMENSION_PX } from '../compresor-fotos';

/**
 * Compresor de fotos (T8 → R9, PA-15-4): dimensión máxima, formato WebP
 * (fallback JPEG) y que el ORIGINAL nunca se sube (solo existe el blob
 * comprimido). jsdom no implementa canvas: la cadena se dobla con un
 * canvas falso.
 */

function canvasFalso() {
  const contexto = {
    drawImage: vi.fn(),
  };
  let blobEntregado: Blob | null = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => contexto),
    toDataURL: vi.fn(() => 'data:image/webp;base64,xx'),
    toBlob: (cb: (blob: Blob | null) => void, mime?: string) => {
      blobEntregado = new Blob(['comprimido'], { type: mime ?? 'image/webp' });
      cb(blobEntregado);
    },
  };
  return { canvas, contexto, leerBlob: () => blobEntregado };
}

describe('compresor-fotos (T8: R9, PA-15-4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('escala a la dimensión máxima manteniendo la proporción (R9)', async () => {
    const { canvas, leerBlob } = canvasFalso();
    const original = new Blob(['foto-grande'], { type: 'image/jpeg' });

    vi.stubGlobal('createImageBitmap', async () => ({
      width: 4000,
      height: 2000,
      close: () => undefined,
    }));
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);

    const resultado = await comprimirFoto(original);
    expect(canvas.width).toBe(MAX_DIMENSION_PX);
    expect(canvas.height).toBe(640); // 4000×2000 → 1280×640
    expect(resultado.mime).toBe('image/webp');
    expect(leerBlob()).not.toBeNull();
    expect(canvas.getContext).toHaveBeenCalledTimes(1);
  });

  it('no escala imágenes que ya caben (R9)', async () => {
    const { canvas } = canvasFalso();
    const original = new Blob(['foto-chica'], { type: 'image/jpeg' });

    vi.stubGlobal('createImageBitmap', async () => ({
      width: 800,
      height: 600,
      close: () => undefined,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb) {
      this.width = canvas.width;
      this.height = canvas.height;
      cb?.(new Blob(['comprimido'], { type: 'image/jpeg' }));
    });
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);

    const resultado = await comprimirFoto(original, 1280, 0.7);
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(resultado.ancho).toBe(800);
  });
});
