import { MinioContainer } from '@testcontainers/minio';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AlmacenamientoService } from '../almacenamiento.service';

/**
 * Almacenamiento contra **MinIO real** (Testcontainers) — T6 → R13, R21.
 *
 * Verifica lo que no se puede afirmar con un mock del SDK: que el objeto
 * subido existe, que su binario devuelve el MISMO SHA-256 que la ficha
 * expone (R21), que la URL firmada lee el objeto y que el borrado elimina.
 */
describe('AlmacenamientoService (T6: R13, R21)', () => {
  let contenedor: Awaited<ReturnType<MinioContainer['start']>>;
  let servicio: AlmacenamientoService;
  const envOriginal = { ...process.env };

  const BINARIO_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );

  beforeAll(async () => {
    contenedor = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: contenedor.getHost(),
      MINIO_PORT: String(contenedor.getMappedPort(9000)),
      MINIO_ACCESS_KEY: contenedor.getUsername(),
      MINIO_SECRET_KEY: contenedor.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'propiedades-test',
    });
    servicio = new AlmacenamientoService();
    await servicio.onModuleInit();
  }, 180_000);

  afterAll(async () => {
    for (const clave of Object.keys(process.env)) {
      if (!(clave in envOriginal)) delete process.env[clave];
    }
    Object.assign(process.env, envOriginal);
    await contenedor?.stop();
  });

  it('subir devuelve clave, hash SHA-256 y tamaño correctos (R21)', async () => {
    const { clave, hash_sha256, tamano_bytes } = await servicio.subir(
      BINARIO_PDF,
      'application/pdf',
    );

    expect(clave).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(hash_sha256).toBe(createHash('sha256').update(BINARIO_PDF).digest('hex'));
    expect(tamano_bytes).toBe(BINARIO_PDF.length);
  });

  it('el objeto almacenado devuelve el MISMO hash que la ficha expone (R21)', async () => {
    const { clave } = await servicio.subir(BINARIO_PDF, 'application/pdf');

    // Lectura real desde MinIO: el hash del binario devuelto por el object
    // storage debe coincidir con el que la ficha guarda.
    const url = await servicio.urlTemporal(clave);
    const respuesta = await fetch(url);
    expect(respuesta.status).toBe(200);
    const binarioLeido = Buffer.from(await respuesta.arrayBuffer());
    expect(createHash('sha256').update(binarioLeido).digest('hex')).toBe(
      createHash('sha256').update(BINARIO_PDF).digest('hex'),
    );
  });

  it('la clave nunca refleja el nombre del cliente (R15, R21)', async () => {
    // El nombre del archivo es PII y un vector de path traversal: la clave
    // es uuid + extensión derivada del mime, nada más.
    const { clave } = await servicio.subir(BINARIO_PDF, 'application/pdf');
    expect(clave).not.toContain('..');
    expect(clave).not.toContain(' ');
    expect(clave).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  it('borrar elimina el objeto del almacenamiento', async () => {
    const { clave } = await servicio.subir(BINARIO_PDF, 'application/pdf');
    await servicio.borrar(clave);

    const url = await servicio.urlTemporal(clave);
    const respuesta = await fetch(url);
    expect([403, 404]).toContain(respuesta.status);
  });
});
