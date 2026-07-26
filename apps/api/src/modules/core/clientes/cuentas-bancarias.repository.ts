import { Injectable } from '@nestjs/common';
import type { CuentaBancaria, TipoCuenta, TipoDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';

export interface DatosCuentaBancaria {
  banco: string;
  tipoCuenta: TipoCuenta;
  numeroCuenta: string;
  titularNombre: string;
  titularTipoDocumento: TipoDocumento;
  titularDocumento: string;
}

/**
 * Único punto de acceso a datos de `cuenta_bancaria`.
 *
 * Mismas reglas que `PropietariosRepository`: solo `ctx.cliente` (**R34**) y
 * `tenant_id` explícito además del RLS.
 */
@Injectable()
export class CuentasBancariasRepository {
  private static readonly SELECT = `
    SELECT id, tenant_id, perfil_propietario_id, banco, tipo_cuenta,
           numero_cuenta, titular_nombre, titular_tipo_documento,
           titular_documento, es_predeterminada, activa,
           created_at, updated_at
      FROM cuenta_bancaria`;

  async insertar(
    ctx: ContextoPeticion,
    perfilPropietarioId: string,
    datos: DatosCuentaBancaria,
    esPredeterminada: boolean,
  ): Promise<CuentaBancaria> {
    const { rows } = await ctx.cliente.query(
      `INSERT INTO cuenta_bancaria
         (tenant_id, perfil_propietario_id, banco, tipo_cuenta, numero_cuenta,
          titular_nombre, titular_tipo_documento, titular_documento, es_predeterminada)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, tenant_id, perfil_propietario_id, banco, tipo_cuenta,
                 numero_cuenta, titular_nombre, titular_tipo_documento,
                 titular_documento, es_predeterminada, activa,
                 created_at, updated_at`,
      [
        ctx.tenantId,
        perfilPropietarioId,
        datos.banco,
        datos.tipoCuenta,
        datos.numeroCuenta,
        datos.titularNombre,
        datos.titularTipoDocumento,
        datos.titularDocumento,
        esPredeterminada,
      ],
    );
    return aCuenta(rows[0]);
  }

  async buscarPorId(
    ctx: ContextoPeticion,
    id: string,
  ): Promise<CuentaBancaria | null> {
    const { rows } = await ctx.cliente.query(
      `${CuentasBancariasRepository.SELECT} WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
    return rows[0] ? aCuenta(rows[0]) : null;
  }

  /** Cuentas **activas** del propietario (**R12**). */
  async listarActivas(
    ctx: ContextoPeticion,
    perfilPropietarioId: string,
  ): Promise<CuentaBancaria[]> {
    const { rows } = await ctx.cliente.query(
      `${CuentasBancariasRepository.SELECT}
        WHERE tenant_id = $1 AND perfil_propietario_id = $2 AND activa = true
        ORDER BY es_predeterminada DESC, created_at`,
      [ctx.tenantId, perfilPropietarioId],
    );
    return rows.map(aCuenta);
  }

  /** La predeterminada activa del propietario, o `null` (**R28**). */
  async buscarPredeterminada(
    ctx: ContextoPeticion,
    perfilPropietarioId: string,
  ): Promise<CuentaBancaria | null> {
    const { rows } = await ctx.cliente.query(
      `${CuentasBancariasRepository.SELECT}
        WHERE tenant_id = $1 AND perfil_propietario_id = $2
          AND activa = true AND es_predeterminada = true`,
      [ctx.tenantId, perfilPropietarioId],
    );
    return rows[0] ? aCuenta(rows[0]) : null;
  }

  /** Quita la marca de predeterminada a todas las cuentas del propietario. */
  async desmarcarPredeterminadas(
    ctx: ContextoPeticion,
    perfilPropietarioId: string,
  ): Promise<void> {
    await ctx.cliente.query(
      `UPDATE cuenta_bancaria
          SET es_predeterminada = false, updated_at = now()
        WHERE tenant_id = $1 AND perfil_propietario_id = $2
          AND es_predeterminada = true`,
      [ctx.tenantId, perfilPropietarioId],
    );
  }

  async marcarPredeterminada(ctx: ContextoPeticion, id: string): Promise<void> {
    await ctx.cliente.query(
      `UPDATE cuenta_bancaria
          SET es_predeterminada = true, updated_at = now()
        WHERE id = $1 AND tenant_id = $2`,
      [id, ctx.tenantId],
    );
  }
}

interface FilaCuenta {
  id: string;
  tenant_id: string;
  perfil_propietario_id: string;
  banco: string;
  tipo_cuenta: TipoCuenta;
  numero_cuenta: string;
  titular_nombre: string;
  titular_tipo_documento: TipoDocumento;
  titular_documento: string;
  es_predeterminada: boolean;
  activa: boolean;
  created_at: Date;
  updated_at: Date;
}

function aCuenta(fila: unknown): CuentaBancaria {
  const f = fila as FilaCuenta;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    perfil_propietario_id: f.perfil_propietario_id,
    banco: f.banco,
    tipo_cuenta: f.tipo_cuenta,
    numero_cuenta: f.numero_cuenta,
    titular_nombre: f.titular_nombre,
    titular_tipo_documento: f.titular_tipo_documento,
    titular_documento: f.titular_documento,
    es_predeterminada: f.es_predeterminada,
    activa: f.activa,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
  };
}
