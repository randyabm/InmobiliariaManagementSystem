import { MinioContainer } from '@testcontainers/minio';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
  TENANT_B,
} from '../../../../../test/support/entorno-clientes';

/**
 * Propietarios adicionales, ocupación, documentos y fotos contra PostgreSQL
 * y MinIO reales (T17, T18 → R10, R11, R12, R13, R16, R17, R21).
 *
 * Las aserciones sobre el efecto se hacen con `SELECT` independientes. El
 * contenedor de MinIO se levanta ANTES de crear la app: `AlmacenamientoService`
 * lee `MINIO_*` al construirse.
 */

const BINARIO_PDF = Buffer.from('%PDF-1.4 binario-de-prueba #6\n');

describe('Propiedades — propietarios, ocupación, documentos y fotos (#6)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let envOriginal: NodeJS.ProcessEnv;
  let idPropiedad: string;
  let principalId: string;
  let idInquilino: string;

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'propiedades-test',
    });

    entorno = await levantarEntornoClientes();
    const servidor = () => entorno.app.getHttpServer();

    const prop = await request(servidor())
      .post('/propietarios')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({ nombre: 'Principal Ocupa', tipo_documento: 'CC', documento: 'PO-1' });
    expect(prop.status).toBe(201);
    principalId = prop.body.id;

    const creada = await request(servidor())
      .post('/propiedades')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        direccion: 'Calle 20 #30-40',
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1200000.00',
        propietario_principal_id: principalId,
      });
    expect(creada.status).toBe(201);
    idPropiedad = creada.body.id;

    const inq = await request(servidor())
      .post('/inquilinos')
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A)
      .send({
        nombre: 'Inquilino Ocupa',
        tipo_documento: 'CC',
        documento: 'IO-1',
        email: 'ocupa@example.com',
        celular: '3001112222',
        medio_preferido_contacto: 'SMS',
      });
    expect(inq.status).toBe(201);
    idInquilino = inq.body.id;
  }, 180_000);

  afterAll(async () => {
    await entorno?.cerrar();
    await minio?.stop();
    for (const clave of Object.keys(process.env)) {
      if (!(clave in envOriginal)) delete process.env[clave];
    }
    Object.assign(process.env, envOriginal);
  });

  const servidor = () => entorno.app.getHttpServer();

  const comoAdminA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.adminA.token}`)
      .set('x-tenant-id', TENANT_A);

  // ─── T17 — propietarios adicionales (R10) ───────────────────────────────

  describe('propietarios adicionales (R10)', () => {
    let idSegundo: string;

    it('añade un propietario adicional y la ficha lo lista (R10)', async () => {
      const segundo = await comoAdminA('post', '/propietarios').send({
        nombre: 'Segundo Propietario',
        tipo_documento: 'CE',
        documento: 'PS-1',
      });
      expect(segundo.status).toBe(201);
      idSegundo = segundo.body.id;

      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/propietarios`,
      ).send({ perfil_propietario_id: idSegundo });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.perfil_propietario_id).toBe(idSegundo);

      const ficha = await comoAdminA('get', `/propiedades/${idPropiedad}`);
      expect(
        ficha.body.propietarios.some(
          (p: { perfil_propietario_id: string }) => p.perfil_propietario_id === idSegundo,
        ),
      ).toBe(true);
    });

    it('repetir la misma asociación es idempotente (R2, R10)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/propietarios`,
      ).send({ perfil_propietario_id: idSegundo });
      expect(respuesta.status).toBe(201);
    });

    it('el principal no puede duplicarse como adicional (R10, 409)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/propietarios`,
      ).send({ perfil_propietario_id: principalId });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('PROPIETARIO_PRINCIPAL_NO_REMOVIBLE');
    });

    it('un perfil inexistente o de otro tenant es 404 (R14)', async () => {
      const inexistente = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/propietarios`,
      ).send({ perfil_propietario_id: inexistente });
      expect(respuesta.status).toBe(404);
    });

    it('remover la asociación es baja lógica y no toca al principal (R10)', async () => {
      const { rows: asociaciones } = await entorno.poolAdmin.query<{ id: string }>(
        `SELECT id FROM propiedad_propietario
          WHERE propiedad_id = $1 AND perfil_propietario_id = $2`,
        [idPropiedad, idSegundo],
      );
      expect(asociaciones).toHaveLength(1);
      const idAsociacion = asociaciones[0]!.id;

      const respuesta = await comoAdminA(
        'delete',
        `/propiedades/${idPropiedad}/propietarios/${idAsociacion}`,
      );
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM propiedad_propietario WHERE id = $1',
        [idAsociacion],
      );
      expect(rows[0]?.activo).toBe(false);

      const ficha = await comoAdminA('get', `/propiedades/${idPropiedad}`);
      expect(ficha.body.propietarios).toHaveLength(0);
    });

    it('una fila de la puente que apunte al principal (estado corrupto) no puede removerse (R10)', async () => {
      // La API no puede crear este estado (`anadir` lo bloquea con 409),
      // pero el invariante R10 debe resistir un estado corrupto en la base:
      // se siembra la fila directamente y la baja debe ser 409, no 200.
      const { rows } = await entorno.poolAdmin.query<{ id: string }>(
        `INSERT INTO propiedad_propietario (tenant_id, propiedad_id, perfil_propietario_id)
         VALUES ($1, $2, $3) RETURNING id`,
        [TENANT_A, idPropiedad, principalId],
      );
      const idCorrupta = rows[0]!.id;

      const respuesta = await comoAdminA(
        'delete',
        `/propiedades/${idPropiedad}/propietarios/${idCorrupta}`,
      );
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.error).toBe('PROPIETARIO_PRINCIPAL_NO_REMOVIBLE');

      const { rows: sigue } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM propiedad_propietario WHERE id = $1',
        [idCorrupta],
      );
      expect(sigue[0]?.activo).toBe(true);
    });

    it('remover una asociación inexistente es 404 (R14)', async () => {
      const respuesta = await comoAdminA(
        'delete',
        `/propiedades/${idPropiedad}/propietarios/ffffffff-ffff-ffff-ffff-ffffffffffff`,
      );
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T17 — ocupación (R11, R12) ─────────────────────────────────────────

  describe('ocupación (R11, R12)', () => {
    it('asignar el inquilino actual abre la línea y actualiza la ficha (R11)', async () => {
      const respuesta = await comoAdminA(
        'patch',
        `/propiedades/${idPropiedad}/inquilino-actual`,
      ).send({ perfil_inquilino_id: idInquilino });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.inquilino_actual_id).toBe(idInquilino);

      const { rows } = await entorno.poolAdmin.query<{
        hasta: Date | null;
        perfil_inquilino_id: string;
      }>(
        'SELECT hasta, perfil_inquilino_id FROM historial_ocupacion WHERE propiedad_id = $1',
        [idPropiedad],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.perfil_inquilino_id).toBe(idInquilino);
      expect(rows[0]?.hasta).toBeNull();
    });

    it('reasignar cierra la línea anterior y abre una nueva (R11)', async () => {
      const segundo = await request(servidor())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${entorno.adminA.token}`)
        .set('x-tenant-id', TENANT_A)
        .send({
          nombre: 'Segundo Inquilino',
          tipo_documento: 'CC',
          documento: 'IO-2',
          email: 'ocupa2@example.com',
          celular: '3003334444',
          medio_preferido_contacto: 'CORREO',
        });
      expect(segundo.status).toBe(201);

      const respuesta = await comoAdminA(
        'patch',
        `/propiedades/${idPropiedad}/inquilino-actual`,
      ).send({ perfil_inquilino_id: segundo.body.id });
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        hasta: Date | null;
        perfil_inquilino_id: string;
      }>(
        'SELECT hasta, perfil_inquilino_id FROM historial_ocupacion WHERE propiedad_id = $1 ORDER BY desde',
        [idPropiedad],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]?.hasta).not.toBeNull();
      expect(rows[1]?.hasta).toBeNull();
      expect(rows[1]?.perfil_inquilino_id).toBe(segundo.body.id);
    });

    it('asignar null libera la propiedad y cierra la línea vigente (R11)', async () => {
      const respuesta = await comoAdminA(
        'patch',
        `/propiedades/${idPropiedad}/inquilino-actual`,
      ).send({ perfil_inquilino_id: null });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.inquilino_actual_id).toBeNull();

      const { rows } = await entorno.poolAdmin.query<{ hasta: Date | null }>(
        'SELECT hasta FROM historial_ocupacion WHERE propiedad_id = $1 AND hasta IS NULL',
        [idPropiedad],
      );
      expect(rows).toHaveLength(0);
    });

    it('el historial se consulta ordenado por desde descendente, con el nombre (R12)', async () => {
      const historial = await comoAdminA(
        'get',
        `/propiedades/${idPropiedad}/historial-ocupacion`,
      );
      expect(historial.status).toBe(200);
      expect(historial.body).toHaveLength(2);
      const fechas = historial.body.map((h: { desde: string }) => h.desde);
      expect(fechas).toEqual([...fechas].sort().reverse());
      expect(
        historial.body.every((h: { inquilino_nombre: string }) =>
          typeof h.inquilino_nombre === 'string',
        ),
      ).toBe(true);
    });

    it('un inquilino de otro tenant es 404 (R14)', async () => {
      const inqB = await request(servidor())
        .post('/inquilinos')
        .set('Authorization', `Bearer ${entorno.adminB.token}`)
        .set('x-tenant-id', TENANT_B)
        .send({
          nombre: 'Inquilino B',
          tipo_documento: 'CC',
          documento: 'IO-B',
          email: 'io-b@example.com',
          celular: '3007778888',
          medio_preferido_contacto: 'SMS',
        });
      expect(inqB.status).toBe(201);

      const respuesta = await comoAdminA(
        'patch',
        `/propiedades/${idPropiedad}/inquilino-actual`,
      ).send({ perfil_inquilino_id: inqB.body.id });
      expect(respuesta.status).toBe(404);
    });
  });

  // ─── T18 — documentos (R13, R16, R21) ───────────────────────────────────

  describe('documentos (R13, R16, R21)', () => {
    it('subir almacena el binario y registra la fila con su hash SHA-256 (R13, R21)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/propiedades/${idPropiedad}/documentos`,
      )
        .field('nombre', 'contrato-fisico.pdf')
        .field('tipo_documento', 'contrato_fisico')
        .attach('archivo', BINARIO_PDF, { filename: 'contrato.pdf', contentType: 'application/pdf' });

      expect(respuesta.status).toBe(201);
      expect(respuesta.body.hash_sha256).toBe(
        createHash('sha256').update(BINARIO_PDF).digest('hex'),
      );
      expect(respuesta.body.clave_storage).toMatch(/^[0-9a-f-]{36}\.pdf$/);

      // El binario NO está en la base: solo la clave y el hash.
      const { rows } = await entorno.poolAdmin.query<{
        clave_storage: string;
        hash_sha256: string;
      }>('SELECT clave_storage, hash_sha256 FROM propiedad_documento WHERE id = $1', [
        respuesta.body.id,
      ]);
      expect(rows[0]?.hash_sha256).toBe(
        createHash('sha256').update(BINARIO_PDF).digest('hex'),
      );
    });

    it('listar devuelve solo los activos (R16)', async () => {
      const listado = await comoAdminA('get', `/propiedades/${idPropiedad}/documentos`);
      expect(listado.status).toBe(200);
      expect(listado.body).toHaveLength(1);
      expect(listado.body[0].nombre).toBe('contrato-fisico.pdf');
    });

    it('archivar es baja lógica: la fila queda inactiva y el objeto sigue (R16)', async () => {
      const listado = await comoAdminA('get', `/propiedades/${idPropiedad}/documentos`);
      const idDocumento = listado.body[0].id as string;

      const baja = await comoAdminA(
        'delete',
        `/propiedades/${idPropiedad}/documentos/${idDocumento}`,
      );
      expect(baja.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM propiedad_documento WHERE id = $1',
        [idDocumento],
      );
      expect(rows[0]?.activo).toBe(false);

      const listado2 = await comoAdminA('get', `/propiedades/${idPropiedad}/documentos`);
      expect(listado2.body).toHaveLength(0);
    });
  });

  // ─── T18 — fotos (R17) ──────────────────────────────────────────────────

  describe('fotos (R17)', () => {
    const FOTO = Buffer.from('datos-de-imagen-falsa-jpeg');

    it('subir una foto añade su clave al array de la ficha (R17)', async () => {
      const respuesta = await comoAdminA('post', `/propiedades/${idPropiedad}/fotos`)
        .attach('archivo', FOTO, { filename: 'foto.jpg', contentType: 'image/jpeg' });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.fotos).toHaveLength(1);
      expect(respuesta.body.fotos[0]).toMatch(/^[0-9a-f-]{36}\.jpg$/);

      const { rows } = await entorno.poolAdmin.query<{ fotos: string[] }>(
        'SELECT fotos FROM propiedad WHERE id = $1',
        [idPropiedad],
      );
      expect(rows[0]?.fotos).toHaveLength(1);
    });

    it('quitar una clave ajena es 400 y no toca el array (R17)', async () => {
      const respuesta = await comoAdminA('delete', `/propiedades/${idPropiedad}/fotos`).send({
        clave: 'clave-ajena',
      });
      expect(respuesta.status).toBe(400);
      expect(respuesta.body.error).toBe('FOTO_NO_PERTENECE_A_LA_PROPIEDAD');

      const { rows } = await entorno.poolAdmin.query<{ fotos: string[] }>(
        'SELECT fotos FROM propiedad WHERE id = $1',
        [idPropiedad],
      );
      expect(rows[0]?.fotos).toHaveLength(1);
    });

    it('quitar la clave propia la retira del array (R17)', async () => {
      const { rows } = await entorno.poolAdmin.query<{ fotos: string[] }>(
        'SELECT fotos FROM propiedad WHERE id = $1',
        [idPropiedad],
      );
      const clave = rows[0]?.fotos[0];
      expect(clave).toBeDefined();

      const respuesta = await comoAdminA('delete', `/propiedades/${idPropiedad}/fotos`).send({
        clave,
      });
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.fotos).toHaveLength(0);
    });
  });
});
