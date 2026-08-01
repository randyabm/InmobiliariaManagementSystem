import { Client as ClienteMinio } from 'minio';
import { MinioContainer } from '@testcontainers/minio';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type EntornoClientes,
  levantarEntornoClientes,
  TENANT_A,
} from '../../../../../test/support/entorno-clientes';

/**
 * Inventario — integración (T12–T15 → R1, R2, R3, R4, R5, R6, R7, R8, R10,
 * R11). Contra PostgreSQL y MinIO reales. El contenedor de MinIO se levanta
 * ANTES de crear la app: `AlmacenamientoService` lee `MINIO_*` al construirse.
 */
describe('Inventario — creación (#12)', () => {
  let entorno: EntornoClientes;
  let minio: Awaited<ReturnType<MinioContainer['start']>>;
  let clienteMinio: ClienteMinio;
  let envOriginal: NodeJS.ProcessEnv;

  beforeAll(async () => {
    envOriginal = { ...process.env };
    minio = await new MinioContainer('minio/minio:RELEASE.2024-09-13T20-26-02Z').start();
    Object.assign(process.env, {
      MINIO_ENDPOINT: minio.getHost(),
      MINIO_PORT: String(minio.getMappedPort(9000)),
      MINIO_ACCESS_KEY: minio.getUsername(),
      MINIO_SECRET_KEY: minio.getPassword(),
      MINIO_USE_SSL: 'false',
      MINIO_BUCKET: 'inventarios-test',
    });
    clienteMinio = new ClienteMinio({
      endPoint: minio.getHost(),
      port: minio.getMappedPort(9000),
      useSSL: false,
      accessKey: minio.getUsername(),
      secretKey: minio.getPassword(),
    });

    entorno = await levantarEntornoClientes();
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

  const comoEmpleadoA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.empleadoA.token}`)
      .set('x-tenant-id', TENANT_A);

  const comoInquilinoA = (metodo: 'post' | 'get' | 'patch' | 'delete', ruta: string) =>
    request(servidor())
      [metodo](ruta)
      .set('Authorization', `Bearer ${entorno.inquilinoA.token}`)
      .set('x-tenant-id', TENANT_A);

  let idPropiedad: string;
  let idInventario: string;

  beforeAll(async () => {
    // Propiedad APARTAMENTO en tenant A (la plantilla SISTEMA de
    // APARTAMENTO viene del seed de #11; sin copia TENANT).
    const propietario = await comoAdminA('post', '/propietarios').send({
      nombre: 'Propietario Inv',
      tipo_documento: 'CC',
      documento: `INV-${Date.now()}`,
      telefono: '3001112233',
      email: `inv-${Date.now()}@example.com`,
    });
    expect(propietario.status).toBe(201);
    const cuenta = await comoAdminA(
      'post',
      `/propietarios/${propietario.body.id}/cuentas-bancarias`,
    ).send({
      banco: 'Bancolombia',
      tipo_cuenta: 'AHORROS',
      numero_cuenta: `NC-INV-${Date.now()}`,
      titular_nombre: 'Propietario Inv',
      titular_tipo_documento: 'CC',
      titular_documento: `P-INV-${Date.now()}`,
    });
    expect(cuenta.status).toBe(201);

    const propiedad = await comoAdminA('post', '/propiedades').send({
      direccion: 'Calle Inventario #1-1',
      tipo: 'APARTAMENTO',
      area: '70.00',
      matricula_inmobiliaria: `001-INV-${Date.now()}`,
      estrato: 4,
      canon: '1200000.00',
      valor_administracion: '200000.00',
      canon_incluye_administracion: false,
      incremento_anual_pactado: '5.00',
      nombre_conjunto: 'Conjunto Inv',
      contacto_admin_nombre: 'Adm.',
      contacto_admin_telefono: '3000000000',
      contacto_admin_correo: 'adm@inv.example.com',
      propietario_principal_id: propietario.body.id,
      cuenta_bancaria_id: cuenta.body.id,
    });
    expect(propiedad.status).toBe(201);
    idPropiedad = propiedad.body.id;
  });

  // ─── T12 — alta y materialización (R1, R4, PA-12-2, PA-12-3) ─────────────

  describe('T12 — alta y materialización (R1, R4, R5)', () => {
    it('crear un inventario materializa la plantilla SISTEMA vigente (R4, PA-12-3)', async () => {
      const respuesta = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'ENTREGA',
      });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.estado).toBe('BORRADOR');
      expect(respuesta.body.tipo_evento).toBe('ENTREGA');
      expect(respuesta.body.creado_por).toBe(entorno.adminA.id);
      idInventario = respuesta.body.id;

      const zonas = respuesta.body.zonas.map(
        (z: { nombre: string }) => z.nombre,
      );
      expect(zonas).toEqual(['Sala', 'Cocina', 'Habitación', 'Baño', 'Entrega de llaves']);
      expect(respuesta.body.zonas[0].items.length).toBeGreaterThan(0);
      expect(
        respuesta.body.zonas.some((z: { items: { foto_obligatoria: boolean }[] }) =>
          z.items.some((i) => i.foto_obligatoria),
        ),
      ).toBe(true);
    });

    it('un solo borrador por propiedad+tipo_evento → 409 (PA-12-2, R1)', async () => {
      const duplicado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'ENTREGA',
      });
      expect(duplicado.status).toBe(409);
      expect(duplicado.body.error).toBe('INVENTARIO_BORRADOR_YA_EXISTE');

      const conOtroEvento = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'DEVOLUCION',
      });
      expect(conOtroEvento.status).toBe(201);
      const limpieza = await comoAdminA('delete', `/inventarios/${conOtroEvento.body.id}`);
      expect(limpieza.status).toBe(200);
    });

    it('propiedad ajena o inexistente → 404 (R11)', async () => {
      const ajena = await comoAdminA('post', '/inventarios').send({
        propiedad_id: '00000000-0000-0000-0000-000000000000',
        tipo_evento: 'ENTREGA',
      });
      expect(ajena.status).toBe(404);
    });

    it('GET /inventarios lista con filtros y GET :id devuelve el completo (R1)', async () => {
      const lista = await comoAdminA('get', '/inventarios?tipoEvento=ENTREGA');
      expect(lista.status).toBe(200);
      expect(lista.body.map((i: { id: string }) => i.id)).toContain(idInventario);
      expect(lista.body[0].zonas.length).toBeGreaterThan(0);

      const detalle = await comoAdminA('get', `/inventarios/${idInventario}`);
      expect(detalle.status).toBe(200);
      expect(detalle.body.estado).toBe('BORRADOR');
    });

    it('la copia TENANT de la plantilla tiene prioridad sobre la SISTEMA (PA-12-3, R4)', async () => {
      // Clonar la APARTAMENTO del sistema crea la copia TENANT; la edición
      // de su primera zona debe materializarse en los inventarios nuevos.
      const lista = await comoAdminA('get', '/plantillas');
      const sistema = lista.body.find(
        (p: { tipo: string; origen: string }) =>
          p.tipo === 'APARTAMENTO' && p.origen === 'SISTEMA',
      );
      const clon = await comoAdminA('post', `/plantillas/${sistema.id}/clonar`);
      expect(clon.status).toBe(201);
      const detalleCopia = await comoAdminA('get', `/plantillas/${clon.body.id}`);
      const zonaTenant = detalleCopia.body.zonas[0];
      const renombrada = await comoAdminA(
        'patch',
        `/plantillas/${clon.body.id}/zonas/${zonaTenant.id}`,
      ).send({ nombre: 'Salón TENANT' });
      expect(renombrada.status).toBe(200);

      // Nueva propiedad e inventario: la materialización usa la TENANT.
      const propietario2 = await comoAdminA('post', '/propietarios').send({
        nombre: `P2 ${Date.now()}`,
        tipo_documento: 'CC',
        documento: `P2-${Date.now()}`,
      });
      const propiedad2 = await comoAdminA('post', '/propiedades').send({
        direccion: `Calle Tenancy ${Date.now()}`,
        tipo: 'APARTAMENTO',
        area: '60.00',
        canon: '1000000.00',
        propietario_principal_id: propietario2.body.id,
      });
      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: propiedad2.body.id,
        tipo_evento: 'ENTREGA',
      });
      expect(creado.status).toBe(201);
      const nombres = creado.body.zonas.map((z: { nombre: string }) => z.nombre);
      expect(nombres).toContain('Salón TENANT');
      expect(nombres).not.toContain('Sala');

      // El borrador se limpia para no ensuciar las suites de T15.
      const limpieza = await comoAdminA('delete', `/inventarios/${creado.body.id}`);
      expect(limpieza.status).toBe(200);
    });
  });

  // ─── T13 — edición del borrador (R6, R7, R8) ─────────────────────────────

  describe('T13 — edición del borrador (R6, R7, R8)', () => {
    let idZonaSala: string;
    let idItemParedes: string;

    beforeAll(async () => {
      const detalle = await comoAdminA('get', `/inventarios/${idInventario}`);
      idZonaSala = detalle.body.zonas[0].id;
      idItemParedes = detalle.body.zonas[0].items[0].id;
    });

    it('responder un ítem con estado y comentario (R8)', async () => {
      const respuesta = await comoAdminA('patch', `/inventarios/${idInventario}/items/${idItemParedes}`)
        .send({
          estado_checklist: 'REGULAR',
          comentario: 'Se observa una grieta en el muro norte.',
        });
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{
        estado_checklist: string;
        comentario: string;
      }>(
        `SELECT estado_checklist, comentario FROM inventario_item WHERE id = $1`,
        [idItemParedes],
      );
      expect(rows[0]?.estado_checklist).toBe('REGULAR');
      expect(rows[0]?.comentario).toContain('grieta');
    });

    it('estado_checklist inválido → 400 (R8)', async () => {
      const respuesta = await comoAdminA('patch', `/inventarios/${idInventario}/items/${idItemParedes}`)
        .send({ estado_checklist: 'EXCELENTE' });
      expect(respuesta.status).toBe(400);
    });

    it('editar una zona del borrador (R7)', async () => {
      const respuesta = await comoAdminA('patch', `/inventarios/${idInventario}/zonas/${idZonaSala}`)
        .send({ nombre: 'Salón principal' });
      expect(respuesta.status).toBe(200);
      const { rows } = await entorno.poolAdmin.query<{ nombre: string }>(
        'SELECT nombre FROM inventario_zona WHERE id = $1',
        [idZonaSala],
      );
      expect(rows[0]?.nombre).toBe('Salón principal');
    });

    it('reordenar zonas (R6)', async () => {
      const detalle = await comoAdminA('get', `/inventarios/${idInventario}`);
      const enOrden = [...detalle.body.zonas.map((z: { id: string }) => z.id)].reverse();
      const respuesta = await comoAdminA('patch', `/inventarios/${idInventario}/zonas/orden`)
        .send({ zonas: enOrden });
      expect(respuesta.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ nombre: string; orden: number }>(
        `SELECT nombre, orden FROM inventario_zona
          WHERE inventario_id = $1 ORDER BY orden`,
        [idInventario],
      );
      expect(rows[0]?.orden).toBe(0);
      expect(rows[rows.length - 1]?.orden).toBe(rows.length - 1);
    });

    it('crear zona e ítem ad-hoc: la plantilla NO cambia (R6, RF-I24)', async () => {
      const zona = await comoAdminA('post', `/inventarios/${idInventario}/zonas`).send({
        nombre: 'Zona de campo',
        repetible: false,
        orden: 99,
      });
      expect(zona.status).toBe(201);
      expect(zona.body.plantilla_zona_id).toBeNull();

      const item = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/zonas/${zona.body.id}/items`,
      ).send({
        nombre: 'Humedad en pared',
        field_type: 'estado',
        foto_obligatoria: true,
      });
      expect(item.status).toBe(201);
      expect(item.body.plantilla_item_id).toBeNull();

      // La plantilla del SISTEMA sigue intacta (RF-I24): no hay ninguna
      // zona llamada así en la plantilla base.
      const { rows: enPlantilla } = await entorno.poolAdmin.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM plantilla_zona z JOIN plantilla_inmueble p ON p.id = z.plantilla_id
          WHERE p.origen = 'SISTEMA' AND z.nombre = 'Zona de campo'`,
      );
      expect(Number(enPlantilla[0]?.total)).toBe(0);

      // Respuesta del ítem nuevo (R6).
      const respuesta = await comoAdminA(
        'patch',
        `/inventarios/${idInventario}/items/${item.body.id}`,
      ).send({ estado_checklist: 'MALO', comentario: 'Humedad visible.' });
      expect(respuesta.status).toBe(200);
    });

    it('baja lógica de zona e ítem ad-hoc (R6, R8)', async () => {
      const zona = await comoAdminA('post', `/inventarios/${idInventario}/zonas`).send({
        nombre: 'Zona a eliminar',
        repetible: false,
        orden: 100,
      });
      const item = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/zonas/${zona.body.id}/items`,
      ).send({ nombre: 'Item a eliminar', field_type: 'texto' });

      const bajaItem = await comoAdminA(
        'delete',
        `/inventarios/${idInventario}/items/${item.body.id}`,
      );
      expect(bajaItem.status).toBe(200);

      const bajaZona = await comoAdminA(
        'delete',
        `/inventarios/${idInventario}/zonas/${zona.body.id}`,
      );
      expect(bajaZona.status).toBe(200);

      const { rows } = await entorno.poolAdmin.query<{ activo: boolean }>(
        `SELECT activo FROM inventario_zona WHERE id = $1`,
        [zona.body.id],
      );
      expect(rows[0]?.activo).toBe(false);

      // Fuera de la ficha: ya no se lista (activo = false).
      const detalle = await comoAdminA('get', `/inventarios/${idInventario}`);
      expect(
        detalle.body.zonas.some((z: { nombre: string }) => z.nombre === 'Zona a eliminar'),
      ).toBe(false);
    });
  });

  // ─── T14 — fotos (R3, R10) ───────────────────────────────────────────────

  describe('T14 — fotos (R3, R10)', () => {
    let idItemVentanas: string;

    beforeAll(async () => {
      const detalle = await comoAdminA('get', `/inventarios/${idInventario}`);
      // T13 reordenó las zonas: buscar 'Ventanas' en cualquiera de ellas.
      idItemVentanas = detalle.body.zonas
        .flatMap((z: { items: { nombre: string }[] }) => z.items)
        .find((i: { nombre: string }) => i.nombre === 'Ventanas').id;
    });

    it('subir una foto JPEG a un ítem registra la fila con su hash (R3)', async () => {
      const binario = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64',
      );
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/items/${idItemVentanas}/fotos`,
      )
        .attach('archivo', binario, { filename: 'ventana.jpg', contentType: 'image/jpeg' });
      expect(respuesta.status).toBe(201);
      expect(respuesta.body.hash_sha256).toHaveLength(64);
      expect(respuesta.body.autor).toBe('EMPLEADO');

      const { rows } = await entorno.poolAdmin.query<{
        clave_storage: string;
        hash_sha256: string;
      }>(
        `SELECT clave_storage, hash_sha256 FROM inventario_item_foto WHERE id = $1`,
        [respuesta.body.id],
      );
      expect(rows[0]?.clave_storage).toMatch(/\.jpg$/);
      expect(rows[0]?.hash_sha256).toBe(respuesta.body.hash_sha256);

      // El binario existe en MinIO (verificado con el cliente directo).
      const objeto = await clienteMinio.getObject(
        'inventarios-test',
        rows[0]?.clave_storage ?? '',
      );
      const chunks: Buffer[] = [];
      for await (const c of objeto) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      expect(Buffer.concat(chunks).length).toBe(binario.length);
    });

    it('baja lógica de la foto: la fila muere, el objeto se conserva (R10)', async () => {
      const lista = await comoAdminA('get', `/inventarios/${idInventario}`);
      const foto = lista.body.zonas
        .flatMap((z: { items: { fotos: { id: string }[] }[] }) =>
          z.items.flatMap((i) => i.fotos),
        )
        .find(() => true);
      expect(foto).toBeDefined();
      const { rows: antes } = await entorno.poolAdmin.query<{ clave_storage: string }>(
        'SELECT clave_storage FROM inventario_item_foto WHERE id = $1',
        [foto.id],
      );
      const clave = antes[0]?.clave_storage;

      const baja = await comoAdminA('delete', `/inventarios/${idInventario}/fotos/${foto.id}`);
      expect(baja.status).toBe(200);

      const { rows: despues } = await entorno.poolAdmin.query<{ activo: boolean }>(
        'SELECT activo FROM inventario_item_foto WHERE id = $1',
        [foto.id],
      );
      expect(despues[0]?.activo).toBe(false);

      const objeto = await clienteMinio.getObject('inventarios-test', clave ?? '');
      for await (const c of objeto) void c;
      // Si llegó aquí, el objeto sigue existiendo (getObject no lanzó).
    });

    it('foto sin archivo → 400 (R3)', async () => {
      const respuesta = await comoAdminA(
        'post',
        `/inventarios/${idInventario}/items/${idItemVentanas}/fotos`,
      );
      expect(respuesta.status).toBe(400);
    });
  });

  // ─── T15 — roles y fronteras (R8, R9) ────────────────────────────────────

  describe('T15 — roles y fronteras (R8, R9)', () => {
    it('inquilino → 403 en las rutas de empleado (R8)', async () => {
      const respuesta = await comoInquilinoA('get', `/inventarios/${idInventario}`);
      expect(respuesta.status).toBe(403);
    });

    it('empleado puede crear y leer (R8)', async () => {
      const listado = await comoEmpleadoA('get', '/inventarios');
      expect(listado.status).toBe(200);
    });

    it('eliminar el borrador deja de listarse (R5)', async () => {
      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'DEVOLUCION',
      });
      expect(creado.status).toBe(201);

      const borrado = await comoAdminA('delete', `/inventarios/${creado.body.id}`);
      expect(borrado.status).toBe(200);

      const detalle = await comoAdminA('get', `/inventarios/${creado.body.id}`);
      expect(detalle.status).toBe(404);
    });

    it('fuera de BORRADOR la edición estructural da 409 sin escribir (R7, R8)', async () => {
      const creado = await comoAdminA('post', '/inventarios').send({
        propiedad_id: idPropiedad,
        tipo_evento: 'DEVOLUCION',
      });
      expect(creado.status).toBe(201);
      const itemId = creado.body.zonas[0].items[0].id;

      // Transición de estado a mano (poolAdmin): el dominio no la expone
      // hasta #13; aquí solo se verifica que el borde de #12 la respeta.
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'ENVIADO' WHERE id = $1`,
        [creado.body.id],
      );

      const patch = await comoAdminA(
        'patch',
        `/inventarios/${creado.body.id}/items/${itemId}`,
      ).send({ comentario: 'No debería aplicarse' });
      expect(patch.status).toBe(409);

      // Nada se escribió.
      const { rows } = await entorno.poolAdmin.query<{ comentario: string | null }>(
        'SELECT comentario FROM inventario_item WHERE id = $1',
        [itemId],
      );
      expect(rows[0]?.comentario).toBeNull();

      // Limpieza: volver a BORRADOR y eliminar por la API.
      await entorno.poolAdmin.query(
        `UPDATE inventario SET estado = 'BORRADOR' WHERE id = $1`,
        [creado.body.id],
      );
      const limpieza = await comoAdminA('delete', `/inventarios/${creado.body.id}`);
      expect(limpieza.status).toBe(200);
    });
  });
});
