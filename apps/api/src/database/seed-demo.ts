/**
 * Seed de DEMO para desarrollo local (no es parte del producto).
 *
 * Uso: `set -a && source .env && set +a && npm run db:seed --workspace apps/api`
 * Crea: tenant, admin, propietarios, inquilinos, propiedades con su ciclo
 * de vida, plantilla base + clon, contratos, inventarios (uno CERRADO),
 * una póliza, pagos conciliados y un ticket — para que el panel web se vea
 * con contenido.
 */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';

const URL = process.env.DATABASE_MIGRATION_URL;
if (!URL) {
  throw new Error('Falta DATABASE_MIGRATION_URL (ejecuta: set -a && source .env && set +a).');
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: URL });
  const ahora = Date.now().toString().slice(-6);
  const hash = await bcrypt.hash('clave-de-prueba-1234', 10);

  const TENANT = '11111111-1111-1111-1111-111111111111';
  const ADMIN = randomUUID();

  await pool.query(
    `INSERT INTO tenant (id, nombre, nit, codigo) VALUES ($1, 'Inmobiliaria Demo', '900111111', 'inmobiliaria-a')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
  await pool.query(
    `INSERT INTO "user" (id, tenant_id, email, password_hash, nombre)
     VALUES ($1, $2, 'admin@demo.com', $3, 'Admin Demo')
     ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [ADMIN, TENANT, hash],
  );
  const { rows: adminReal } = await pool.query<{ id: string }>(
    `SELECT id FROM "user" WHERE tenant_id = $1 AND email = 'admin@demo.com'`,
    [TENANT],
  );
  const adminId = adminReal[0]!.id;
  await pool.query(
    `INSERT INTO user_role (user_id, tenant_id, rol) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
    [adminId, TENANT],
  );

  const { rows: prop } = await pool.query<{ id: string }>(
    `INSERT INTO perfil_propietario (tenant_id, user_id, tipo_documento, documento)
     VALUES ($1, $2, 'CC', $3)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET tipo_documento = EXCLUDED.tipo_documento
     RETURNING id`,
    [TENANT, adminId, `CC-DEMO-${ahora}`],
  );
  const propietarioId = prop[0]!.id;

  // Tres propiedades con ciclo de vida.
  const propiedades: string[] = [];
  const estados = ['disponible', 'arrendada', 'en_desocupacion'];
  for (let i = 0; i < 3; i++) {
    const { rows: propiedad } = await pool.query<{ id: string }>(
      `INSERT INTO propiedad
         (tenant_id, direccion, tipo, area, canon, valor_administracion,
          incremento_anual_pactado, propietario_principal_id)
       VALUES ($1, $2, 'APARTAMENTO', '60.00', $3, '200000.00', '5.00', $4)
       RETURNING id`,
      [TENANT, `Calle Demo ${i + 1} #10-${20 + i}`, `${1000000 + i * 200000}.00`, propietarioId],
    );
    propiedades.push(propiedad[0]!.id);
  }

  // Inquilino + contrato para la propiedad arrendada.
  const { rows: inquilino } = await pool.query<{ id: string }>(
    `INSERT INTO perfil_inquilino
       (tenant_id, user_id, tipo_documento, documento, email_contacto, celular, medio_preferido_contacto)
     VALUES ($1, $2, 'CC', $3, $4, $5, 'CORREO')
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET email_contacto = EXCLUDED.email_contacto
     RETURNING id`,
    [TENANT, adminId, `CC-INQ-DEMO-${ahora}`, `inquilino-demo-${ahora}@example.com`, `314${ahora.slice(0, 4)}`],
  );
  await pool.query(
    `INSERT INTO contract
       (tenant_id, property_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin)
     VALUES ($1, $2, $3, $4, now() - interval '6 months', now() + interval '6 months')`,
    [TENANT, propiedades[1]!, inquilino[0]!.id, propietarioId],
  );

  // Ciclo de vida de las propiedades (el dashboard de #8 lee instancias).
  for (let i = 0; i < propiedades.length; i++) {
    await pool.query(
      `INSERT INTO workflow_instancia
         (id, tenant_id, definicion_id, entidad_tipo, entidad_id, estado_actual_id, contexto)
       SELECT $1, $2, d.id, 'propiedad', $3, e.id, '{}'
         FROM workflow_definicion d
         JOIN workflow_estado e ON e.definicion_id = d.id AND e.clave = $4
        WHERE d.tipo = 'ciclo_vida_propiedad'`,
      [randomUUID(), TENANT, propiedades[i], estados[i]],
    );
  }

  // Inventarios: uno CERRADO (para el anexo) y uno BORRADOR.
  const { rows: cerrado } = await pool.query<{ id: string }>(
    `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, estado)
     VALUES ($1, $2, 'ENTREGA', 'CERRADO') RETURNING id`,
    [TENANT, propiedades[0]!],
  );
  await pool.query(
    `INSERT INTO inventario (tenant_id, propiedad_id, tipo_evento, estado)
     VALUES ($1, $2, 'ENTREGA', 'BORRADOR')`,
    [TENANT, propiedades[2]!],
  );
  void cerrado;

  // Plantilla base del tenant + clon por propiedad.
  await pool.query(
    `INSERT INTO contract_template
       (tenant_id, nombre, cuerpo, merge_fields_json, version, estado)
     VALUES ($1, 'Clausulado estándar Demo',
             'Entre {arrendador} y {arrendatario}, canon {canon}.',
             '{"arrendador":"","arrendatario":"","canon":""}', 1, 'validado')
     ON CONFLICT DO NOTHING`,
    [TENANT],
  );

  // Póliza aprobada.
  await pool.query(
    `INSERT INTO insurance_policy
       (tenant_id, property_id, aseguradora, numero_poliza, vigencia_desde,
        vigencia_hasta, valor_cobertura, estado)
     VALUES ($1, $2, 'Suramericana', 'POL-DEMO-001', now(), now() + interval '1 year',
             50000000, 'aprobada')`,
    [TENANT, propiedades[0]!],
  );

  // Un pago conciliado al contrato (para el estado de cuenta).
  const { rows: contrato } = await pool.query<{ id: string }>(
    `SELECT id FROM contract WHERE tenant_id = $1 LIMIT 1`,
    [TENANT],
  );
  await pool.query(
    `INSERT INTO payment_import (tenant_id, nombre_archivo, nombre_origen, hash_archivo, estado)
     VALUES ($1, 'demo.csv', 'demo', $2, 'procesada')`,
    [TENANT, 'a'.repeat(64)],
  );
  const { rows: importacion } = await pool.query<{ id: string }>(
    `SELECT id FROM payment_import WHERE tenant_id = $1 LIMIT 1`,
    [TENANT],
  );
  await pool.query(
    `INSERT INTO payment_record
       (tenant_id, import_id, fecha_movimiento, valor, referencia_texto, pagador_texto,
        estado, contract_id, estrategia_conciliacion, confianza)
     VALUES ($1, $2, now() - interval '10 days', 1200000, 'ARR-DEMO', 'Ana Pérez',
             'Conciliado', $3, 'manual', 1)`,
    [TENANT, importacion[0]!.id, contrato[0]?.id ?? null],
  );

  // Un ticket en curso.
  await pool.query(
    `INSERT INTO workflow_instancia
       (id, tenant_id, definicion_id, entidad_tipo, entidad_id, estado_actual_id, contexto)
     SELECT $1, $2, d.id, 'ticket', $3, e.id, $4
       FROM workflow_definicion d
       JOIN workflow_estado e ON e.definicion_id = d.id AND e.clave = 'en_curso'
      WHERE d.tipo = 'incidencias'`,
    [
      randomUUID(),
      TENANT,
      randomUUID(),
      JSON.stringify({
        propiedad_id: propiedades[1],
        solicitante_user_id: adminId,
        categoria: 'PLOMERIA',
        descripcion: 'Fuga en el baño (demo).',
        costo_aprobado: true,
        comentarios: [],
      }),
    ],
  );

  console.info('[db:seed] Demo sembrada: 3 propiedades, contrato, inventarios, póliza, pago y ticket.');
  await pool.end();
}

main().catch((error) => {
  console.error('[db:seed] Falló:', error.message);
  process.exit(1);
});
