import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * Generador de PDF consolidado del inventario (feature #14, R1, PA-14-1).
 *
 * Interfaz abstracta (D4): la implementación MVP es `pdf-lib` (sin
 * Chromium); Puppeteer queda como proveedor enchufable si se necesita
 * HTML→PDF. El hash SHA-256 se calcula del binario final (R11).
 */

export interface PdfInventario {
  propiedad_direccion: string;
  propiedad_tipo: string;
  tipo_evento: 'ENTREGA' | 'DEVOLUCION';
  estado: string;
  zonas: Array<{
    nombre: string;
    items: Array<{
      nombre: string;
      respuesta: string | null;
      comentario: string | null;
      fotos: Array<{ binario: Buffer; mime: string }>;
    }>;
  }>;
}

export interface PdfGenerado {
  binario: Buffer;
  hash_sha256: string;
  tamano_bytes: number;
}

export interface GeneradorPdf {
  generar(datos: PdfInventario): Promise<PdfGenerado>;
}

/** Implementación MVP con pdf-lib (PA-14-1). */
export class GeneradorPdfPdfLib implements GeneradorPdf {
  async generar(datos: PdfInventario): Promise<PdfGenerado> {
    const documento = await PDFDocument.create();
    documento.setTitle(`Inventario ${datos.tipo_evento} — ${datos.propiedad_direccion}`);
    // Sin fechas automáticas: el hash debe ser estable entre regeneraciones
    // del mismo contenido (R11: el mismo documento lo firman ambas partes).
    documento.setCreationDate(new Date(0));
    documento.setModificationDate(new Date(0));

    const fuente = await documento.embedFont(StandardFonts.Helvetica);
    const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);
    const negro = rgb(0.1, 0.1, 0.1);

    // Página 1: cabecera + zonas/ítems con respuesta y comentario.
    let pagina = documento.addPage([595, 842]);
    const margen = 50;
    let y = 800;

    const escribir = (texto: string, negrita = false, tamaño = 11) => {
      pagina.drawText(texto, {
        x: margen,
        y,
        size: tamaño,
        font: negrita ? fuenteNegrita : fuente,
        color: negro,
      });
      y -= tamaño + 4;
    };

    escribir(`INVENTARIO ${datos.tipo_evento}`, true, 16);
    escribir(`${datos.propiedad_direccion} (${datos.propiedad_tipo})`);
    escribir(`Estado: ${datos.estado}`);
    y -= 12;

    for (const zona of datos.zonas) {
      if (y < 80) {
        pagina = documento.addPage([595, 842]);
        y = 800;
      }
      escribir(`— ${zona.nombre} —`, true, 13);
      for (const item of zona.items) {
        if (y < 60) {
          pagina = documento.addPage([595, 842]);
          y = 800;
        }
        const respuesta = item.respuesta ?? 'sin respuesta';
        escribir(`• ${item.nombre}: ${respuesta}`);
        if (item.comentario) {
          escribir(`   Comentario: ${item.comentario}`, false, 9);
        }
      }
    }

    // Firma: dos líneas con el hash (la evidencia completa vive en
    // inventario_firma, R3).
    y = Math.min(y - 20, 100);
    escribir('FIRMA DEL EMPLEADO', true);
    escribir('FIRMA DEL INQUILINO', true);
    escribir('', false, 6);
    escribir('Documento firmado digitalmente. La evidencia de cada firma', false, 8);
    escribir('(timestamp, IP, verificación de identidad) se conserva en el', false, 8);
    escribir('registro de firmas del sistema.', false, 8);

    // Fotos incrustadas (R1): una por página, con su ítem.
    for (const zona of datos.zonas) {
      for (const item of zona.items) {
        for (const foto of item.fotos) {
          const paginaFoto = documento.addPage([595, 842]);
          const imagen = await this.incrustar(foto.binario, documento);
          const ancho = 500;
          const alto = Math.min(600, (ancho * imagen.height) / Math.max(1, imagen.width));
          paginaFoto.drawImage(imagen, { x: 47, y: 742 - alto, width: ancho, height: alto });
          paginaFoto.drawText(`Foto: ${zona.nombre} — ${item.nombre}`, {
            x: 50,
            y: 800,
            size: 10,
            font: fuente,
            color: negro,
          });
        }
      }
    }

    const binario = Buffer.from(await documento.save());
    const { createHash } = await import('node:crypto');
    const hash_sha256 = createHash('sha256').update(binario).digest('hex');
    return { binario, hash_sha256, tamano_bytes: binario.length };
  }

  private async incrustar(
    binario: Buffer,
    documento: PDFDocument,
  ): Promise<import('pdf-lib').PDFImage> {
    try {
      return await documento.embedJpg(binario);
    } catch {
      return documento.embedPng(binario);
    }
  }
}
