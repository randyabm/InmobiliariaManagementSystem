import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'minio';

/**
 * Object storage compartido (MinIO, S3-compatible). Feature #6 (PA-6-1).
 *
 * Es el único punto del sistema que toca binarios: fotos de la propiedad
 * (R17) y el repositorio documental (R13). Las features #12 (fotos de
 * inventario) y #18 (contratos digitalizados) consumirán este mismo módulo.
 *
 * ## Claves generadas por el servidor, nunca por el cliente
 *
 * La clave es `uuid/v4 + extensión normalizada` del mime (los nombres de
 * archivo del cliente son PII y vectores de path traversal: `../`, espacios,
 * caracteres no ASCII). El nombre "bonito" vive en la fila de la base, no en
 * el objeto.
 *
 * ## Hash (R21)
 *
 * El SHA-256 se calcula del binario **antes** de subir y se guarda como
 * metadato del objeto (`x-amz-meta-sha256`). La verificación de integridad
 * contra el almacenamiento real —leer el objeto y recalcular— la hace el
 * test de `propiedad_documento` (T18): el hash que la ficha expone es el del
 * binario que el cliente envió, y el objeto almacenado debe coincidir.
 *
 * ## Credenciales
 *
 * `MINIO_*` desde el entorno (docker-compose usa `minioadmin/minioadmin` de
 * fábrica; `.env.example` las expone). El bucket se asegura en el arranque
 * (idempotente).
 */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  private readonly cliente: Client;
  readonly bucket: string;

  constructor() {
    const endPoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    const port = Number(process.env.MINIO_PORT) || 9000;
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const accessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
    const secretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
    this.bucket = process.env.MINIO_BUCKET ?? 'propiedades';

    this.cliente = new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      const existe = await this.cliente.bucketExists(this.bucket);
      if (!existe) {
        await this.cliente.makeBucket(this.bucket);
        this.logger.log(`Bucket ${this.bucket} creado`);
      }
    } catch (error) {
      // Sin MinIO la API sigue arrancando: solo fallan las rutas que suben
      // o leen objetos. El healthcheck de docker-compose lo vigila.
      this.logger.warn(`MinIO no disponible al iniciar: ${String(error)}`);
    }
  }

  /**
   * Sube un binario y devuelve la clave y el hash. La clave es
   * `uuid + extensión` derivada del mime; el hash, SHA-256 del binario (R21).
   */
  async subir(
    binario: Buffer,
    mime: string,
  ): Promise<{ clave: string; hash_sha256: string; tamano_bytes: number }> {
    const hash = createHash('sha256').update(binario).digest('hex');
    const clave = `${randomUUID()}${extensionDeMime(mime)}`;

    await this.cliente.putObject(this.bucket, clave, binario, binario.length, {
      'Content-Type': mime,
      'x-amz-meta-sha256': hash,
    });

    return { clave, hash_sha256: hash, tamano_bytes: binario.length };
  }

  /** URL firmada de lectura (el bucket no es público; §7 NFR). */
  async urlTemporal(clave: string): Promise<string> {
    return this.cliente.presignedGetObject(this.bucket, clave, 3600);
  }

  /** Borra el objeto (la baja de la fila es lógica y no lo toca, R16). */
  async borrar(clave: string): Promise<void> {
    await this.cliente.removeObject(this.bucket, clave);
  }
}

/** Extensión normalizada a partir del mime; vacía si no se reconoce. */
function extensionDeMime(mime: string): string {
  const tabla: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'text/plain': '.txt',
  };
  return tabla[mime] ?? '';
}
