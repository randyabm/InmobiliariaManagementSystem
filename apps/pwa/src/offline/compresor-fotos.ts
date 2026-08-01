/**
 * Compresión de fotos en el dispositivo (feature #15, R9, PA-15-4).
 *
 * `<img>` → canvas (máx. 1280 px, proporción conservada, orientación EXIF
 * respetada vía `createImageBitmap` con `imageOrientation: 'from-image'`)
 * → `toBlob('image/webp', 0.7)` con fallback JPEG. El blob comprimido es
 * lo único que entra a la cola: el original NO se sube (R9).
 */
export const MAX_DIMENSION_PX = 1280;
export const CALIDAD = 0.7;

export interface FotoComprimida {
  blob: Blob;
  mime: string;
  ancho: number;
  alto: number;
}

export async function comprimirFoto(
  origen: Blob,
  maxDimension: number = MAX_DIMENSION_PX,
  calidad: number = CALIDAD,
): Promise<FotoComprimida> {
  const bitmap = await decodificar(origen);
  const { ancho, alto } = escalar(bitmap.width, bitmap.height, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const contexto = canvas.getContext('2d');
  if (!contexto) {
    throw new Error('Canvas no disponible en este dispositivo.');
  }
  contexto.drawImage(bitmap, 0, 0, ancho, alto);
  if (typeof (bitmap as ImageBitmap).close === 'function') {
    (bitmap as ImageBitmap).close();
  }

  const soportaWebp =
    typeof HTMLCanvasElement.prototype.toBlob === 'function' &&
    canvas.toDataURL('image/webp').startsWith('data:image/webp');

  const mime = soportaWebp ? 'image/webp' : 'image/jpeg';
  const blob = await blobDe(canvas, mime, calidad);
  return { blob, mime, ancho, alto };
}

async function decodificar(origen: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` respeta la orientación EXIF (R9).
      return await createImageBitmap(origen, { imageOrientation: 'from-image' });
    } catch {
      // Fallo del bitmap (formato raro): cae al <img> clásico.
    }
  }
  const url = URL.createObjectURL(origen);
  try {
    const img = new Image();
    await new Promise<void>((resolver, rechazar) => {
      img.onload = () => resolver();
      img.onerror = () => rechazar(new Error('La imagen no se pudo decodificar.'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function escalar(ancho: number, alto: number, maxDimension: number): { ancho: number; alto: number } {
  if (ancho <= maxDimension && alto <= maxDimension) {
    return { ancho, alto };
  }
  const factor = maxDimension / Math.max(ancho, alto);
  return {
    ancho: Math.round(ancho * factor),
    alto: Math.round(alto * factor),
  };
}

function blobDe(canvas: HTMLCanvasElement, mime: string, calidad: number): Promise<Blob> {
  return new Promise((resolver, rechazar) => {
    canvas.toBlob(
      (blob) => (blob ? resolver(blob) : rechazar(new Error('La compresión falló.'))),
      mime,
      calidad,
    );
  });
}
