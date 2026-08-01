import { Injectable } from '@nestjs/common';
import type {
  Propiedad,
  PropiedadConExtras,
  PropiedadPropietario,
  TipoPropiedad,
} from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

/**
 * Único punto de acceso a `propiedad` y sus tablas asociadas (feature #6).
 *
 * Mismas reglas que el resto del proyecto: solo el `PoolClient` de la
 * transacción con `SET LOCAL app.current_tenant` (R19) y `tenant_id`
 * explícito en cada consulta como defensa en profundidad sobre el RLS (R14).
 *
 * Las cantidades viajan como `::text` (R9): `numeric` no se convierte a
 * `number` en ninguna frontera.
 */
@Injectable()
export class PropiedadesRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id, direccion, tipo, area::text AS area,
           matricula_inmobiliaria, estrato, parqueaderos, depositos,
           fotos, canon::text AS canon,
           valor_administracion::text AS valor_administracion,
           canon_incluye_administracion,
           incremento_anual_pactado::text AS incremento_anual_pactado,
           nombre_conjunto, contacto_admin_nombre, contacto_admin_telefono,
           contacto_admin_correo, propietario_principal_id,
           cuenta_bancaria_id, inquilino_actual_id, activo,
           created_at, updated_at
      FROM propiedad`;

  async insertar(
    ctx: ContextoPeticion,
    datos: {
      direccion: string;
      tipo: TipoPropiedad;
      area: string;
      matriculaInmobiliaria: string | null;
      estrato: number | null;
      parqueaderos: number;
      depositos: number;
      canon: string;
      valorAdministracion: string | null;
      canonIncluyeAdministracion: boolean;
      incrementoAnualPactado: string | null;
      nombreConjunto: string | null;
      contactoAdminNombre: string | null;
      contactoAdminTelefono: string | null;
      contactoAdminCorreo: string | null;
      propietarioPrincipalId: string;
      cuentaBancariaId: string | null;
    },
  ): Promise<Propiedad> {
    const { rows } = await ctx.cliente.query(
      `${PropiedadesRepository.SELECT_INSERT_RETURNING}`,
      [
        ctx.tenantId,
        datos.direccion,
        datos.tipo,
        datos.area,
        datos.matriculaInmobiliaria,
        datos.estrato,
        datos.parqueaderos,
        datos.depositos,
        datos.canon,
        datos.valorAdministracion,
        datos.canonIncluyeAdministracion,
        datos.incrementoAnualPactado,
        datos.nombreConjunto,
        datos.contactoAdminNombre,
        datos.contactoAdminTelefono,
        datos.contactoAdminCorreo,
        datos.propietarioPrincipalId,
        datos.cuentaBancariaId,
      ],
    );
    return aPropiedad(rows[0]!);
  }

  private static readonly CAMPOS = `
    id, tenant_id, direccion, tipo, area::text AS area,
    matricula_inmobiliaria, estrato, parqueaderos, depositos,
    fotos, canon::text AS canon,
    valor_administracion::text AS valor_administracion,
    canon_incluye_administracion,
    incremento_anual_pactado::text AS incremento_anual_pactado,
    nombre_conjunto, contacto_admin_nombre, contacto_admin_telefono,
    contacto_admin_correo, propietario_principal_id,
    cuenta_bancaria_id, inquilino_actual_id, activo,
    created_at, updated_at`;

  private static readonly SELECT_INSERT_RETURNING = `
    INSERT INTO propiedad
      (tenant_id, direccion, tipo, area, matricula_inmobiliaria, estrato,
       parqueaderos, depositos, canon, valor_administracion,
       canon_incluye_administracion, incremento_anual_pactado,
       nombre_conjunto, contacto_admin_nombre, contacto_admin_telefono,
       contacto_admin_correo, propietario_principal_id, cuenta_bancaria_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
            $16, $17, $18)
    RETURNING ${PropiedadesRepository.CAMPOS}`;

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<Propiedad | null> {
    const { rows } = await ctx.cliente.query(
      `${PropiedadesRepository.SELECT} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aPropiedad(rows[0]) : null;
  }

  /** Lista de las propiedades activas del tenant, más recientes primero. */
  async listar(ctx: ContextoPeticion): Promise<Propiedad[]> {
    const { rows } = await ctx.cliente.query(
      `${PropiedadesRepository.SELECT} WHERE tenant_id = $1 AND activo = true
        ORDER BY created_at DESC`,
      [ctx.tenantId],
    );
    return rows.map(aPropiedad);
  }

  /** R7 — PATCH parcial; devuelve filas afectadas (0 → 404 en el service). */
  async actualizar(
    ctx: ContextoPeticion,
    id: string,
    cambios: Partial<{
      direccion: string;
      tipo: TipoPropiedad;
      area: string;
      matriculaInmobiliaria: string | null;
      estrato: number | null;
      parqueaderos: number;
      depositos: number;
      canon: string;
      valorAdministracion: string | null;
      canonIncluyeAdministracion: boolean;
      incrementoAnualPactado: string | null;
      nombreConjunto: string | null;
      contactoAdminNombre: string | null;
      contactoAdminTelefono: string | null;
      contactoAdminCorreo: string | null;
      propietarioPrincipalId: string;
      cuentaBancariaId: string | null;
    }>,
  ): Promise<number> {
    const asignaciones: string[] = [];
    const valores: unknown[] = [];

    const mapeo: Record<string, keyof typeof cambios> = {
      direccion: 'direccion',
      tipo: 'tipo',
      area: 'area',
      matricula_inmobiliaria: 'matriculaInmobiliaria',
      estrato: 'estrato',
      parqueaderos: 'parqueaderos',
      depositos: 'depositos',
      canon: 'canon',
      valor_administracion: 'valorAdministracion',
      canon_incluye_administracion: 'canonIncluyeAdministracion',
      incremento_anual_pactado: 'incrementoAnualPactado',
      nombre_conjunto: 'nombreConjunto',
      contacto_admin_nombre: 'contactoAdminNombre',
      contacto_admin_telefono: 'contactoAdminTelefono',
      contacto_admin_correo: 'contactoAdminCorreo',
      propietario_principal_id: 'propietarioPrincipalId',
      cuenta_bancaria_id: 'cuentaBancariaId',
    };

    for (const [columna, clave] of Object.entries(mapeo)) {
      const valor = cambios[clave];
      if (valor !== undefined) {
        valores.push(valor);
        asignaciones.push(`${columna} = $${valores.length}`);
      }
    }

    if (asignaciones.length === 0) return 0;

    asignaciones.push('updated_at = now()');
    valores.push(id, ctx.tenantId);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE propiedad SET ${asignaciones.join(', ')}
        WHERE id = $${valores.length - 1} AND tenant_id = $${valores.length}`,
      valores,
    );
    return rowCount ?? 0;
  }

  /** R7 — baja lógica, nada de borrado físico. */
  async marcarInactivo(ctx: ContextoPeticion, id: string): Promise<number> {
    const { rowCount } = await ctx.cliente.query(
      `UPDATE propiedad SET activo = false, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rowCount ?? 0;
  }

  /** R6 — propietarios activos (principal + adicionales) de la ficha. */
  async propietariosActivos(
    ctx: ContextoPeticion,
    propiedadId: string,
  ): Promise<PropiedadPropietario[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id, propiedad_id, perfil_propietario_id, activo,
              created_at, updated_at
         FROM propiedad_propietario
        WHERE tenant_id = $1 AND propiedad_id = $2 AND activo = true
        ORDER BY created_at`,
      [ctx.tenantId, propiedadId],
    );
    return rows.map((fila) => aPropiedadPropietario(fila));
  }

  /** R6 — nombre del inquilino actual, para la ficha. */
  async nombreDelInquilinoActual(
    ctx: ContextoPeticion,
    perfilInquilinoId: string,
  ): Promise<string | null> {
    const { rows } = await ctx.cliente.query<{ nombre: string }>(
      `SELECT u.nombre
         FROM perfil_inquilino p JOIN "user" u ON u.id = p.user_id
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [perfilInquilinoId, ctx.tenantId],
    );
    return rows[0]?.nombre ?? null;
  }
}

interface FilaPropiedad {
  id: string;
  tenant_id: string;
  direccion: string;
  tipo: TipoPropiedad;
  area: string;
  matricula_inmobiliaria: string | null;
  estrato: number | null;
  parqueaderos: number;
  depositos: number;
  fotos: string[];
  canon: string;
  valor_administracion: string | null;
  canon_incluye_administracion: boolean;
  incremento_anual_pactado: string | null;
  nombre_conjunto: string | null;
  contacto_admin_nombre: string | null;
  contacto_admin_telefono: string | null;
  contacto_admin_correo: string | null;
  propietario_principal_id: string;
  cuenta_bancaria_id: string | null;
  inquilino_actual_id: string | null;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aPropiedad(fila: unknown): Propiedad {
  const f = fila as FilaPropiedad;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    direccion: f.direccion,
    tipo: f.tipo,
    area: f.area,
    matricula_inmobiliaria: f.matricula_inmobiliaria,
    estrato: f.estrato,
    parqueaderos: f.parqueaderos,
    depositos: f.depositos,
    fotos: f.fotos,
    canon: f.canon,
    valor_administracion: f.valor_administracion,
    canon_incluye_administracion: f.canon_incluye_administracion,
    incremento_anual_pactado: f.incremento_anual_pactado,
    nombre_conjunto: f.nombre_conjunto,
    contacto_admin_nombre: f.contacto_admin_nombre,
    contacto_admin_telefono: f.contacto_admin_telefono,
    contacto_admin_correo: f.contacto_admin_correo,
    propietario_principal_id: f.propietario_principal_id,
    cuenta_bancaria_id: f.cuenta_bancaria_id,
    inquilino_actual_id: f.inquilino_actual_id,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

interface FilaPropiedadPropietario {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  perfil_propietario_id: string;
  activo: boolean;
  created_at: Date;
  updated_at: Date;
}

function aPropiedadPropietario(fila: unknown): PropiedadPropietario {
  const f = fila as FilaPropiedadPropietario;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    propiedad_id: f.propiedad_id,
    perfil_propietario_id: f.perfil_propietario_id,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}

/** Ficha completa para `GET /propiedades/:id` (R6). */
export function aPropiedadConExtras(
  propiedad: Propiedad,
  extras: {
    propietarios: PropiedadPropietario[];
    cuentaGiro: PropiedadConExtras['cuenta_giro'];
    inquilinoActualNombre: string | null;
  },
): PropiedadConExtras {
  return {
    ...propiedad,
    propietarios: extras.propietarios,
    cuenta_giro: extras.cuentaGiro,
    inquilino_actual_nombre: extras.inquilinoActualNombre,
  };
}
