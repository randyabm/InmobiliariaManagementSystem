import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ContratoDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { ContratosRepository } from './contratos.repository';

/**
 * Digitalización de contratos físicos (feature #18, R1–R3).
 */
@Injectable()
export class DigitalizacionService {
  constructor(
    private readonly almacenamiento: AlmacenamientoService,
    private readonly contratos: ContratosRepository,
  ) {}

  /** R1 — subir el escaneo con metadatos (PA-18-1). */
  async subirDigitalizado(
    ctx: ContextoPeticion,
    datos: {
      nombre: string;
      binario: Buffer;
      mime: string;
      propiedad_id: string;
      inquilino_id?: string;
      fecha_inicio?: string;
      fecha_fin?: string;
      canon?: string;
      contract_id?: string;
    },
  ): Promise<ContratoDocumento> {
    // El contrato destino: el recibido o uno creado con los metadatos.
    let contractId = datos.contract_id;
    if (!contractId) {
      const { rows: propiedad } = await ctx.cliente.query<{ propietario_principal_id: string }>(
        `SELECT propietario_principal_id::text AS propietario_principal_id
           FROM propiedad WHERE id = $1 AND tenant_id = $2`,
        [datos.propiedad_id, ctx.tenantId],
      );
      const filaPropiedad = propiedad[0];
      if (!filaPropiedad) throw new ResourceNotFoundError();

      const inquilinoId = datos.inquilino_id;
      if (inquilinoId) {
        const { rows: inquilino } = await ctx.cliente.query<{ id: string }>(
          `SELECT id FROM perfil_inquilino WHERE id = $1 AND tenant_id = $2`,
          [inquilinoId, ctx.tenantId],
        );
        if (inquilino.length === 0) throw new ResourceNotFoundError();
      }
      const creado = await this.contratos.insertarContrato(ctx, {
        propertyId: datos.propiedad_id,
        inquilinoId: inquilinoId ?? null,
        propietarioId: filaPropiedad.propietario_principal_id,
        fechaInicio: datos.fecha_inicio ? new Date(datos.fecha_inicio) : new Date(),
        fechaFin: datos.fecha_fin ? new Date(datos.fecha_fin) : new Date(),
      });
      contractId = creado.id;
    } else {
      const contrato = await this.contratos.buscarPorId(ctx, contractId);
      if (!contrato) throw new ResourceNotFoundError();
    }

    const subido = await this.almacenamiento.subir(datos.binario, datos.mime);
    const hashReal = createHash('sha256').update(datos.binario).digest('hex');
    const { rows } = await ctx.cliente.query(
      `INSERT INTO contract_document
         (tenant_id, contract_id, nombre, origen, clave_storage,
          hash_sha256, mime, tamano_bytes, metadatos)
       VALUES ($1, $2, $3, 'digitalizado', $4, $5, $6, $7, $8)
       RETURNING id, tenant_id::text AS tenant_id, contract_id::text AS contract_id,
                 nombre, origen, clave_storage, hash_sha256, mime, tamano_bytes,
                 metadatos, created_at`,
      [
        ctx.tenantId,
        contractId,
        datos.nombre,
        subido.clave,
        subido.hash_sha256,
        datos.mime,
        datos.binario.length,
        JSON.stringify({
          canon: datos.canon ?? null,
          fecha_inicio: datos.fecha_inicio ?? null,
          fecha_fin: datos.fecha_fin ?? null,
          inquilino_id: datos.inquilino_id ?? null,
        }),
      ],
    );
    if (hashReal !== subido.hash_sha256) {
      throw new Error('El hash del binario no coincide con el registrado.');
    }
    return aDocumento(rows[0]!);
  }

  /** R2 — documentos del contrato. */
  async listarDeContrato(
    ctx: ContextoPeticion,
    contractId: string,
  ): Promise<ContratoDocumento[]> {
    const contrato = await this.contratos.buscarPorId(ctx, contractId);
    if (!contrato) throw new ResourceNotFoundError();
    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id::text AS tenant_id, contract_id::text AS contract_id,
              nombre, origen, clave_storage, hash_sha256, mime, tamano_bytes,
              metadatos, created_at
         FROM contract_document
        WHERE tenant_id = $1 AND contract_id = $2 ORDER BY created_at`,
      [ctx.tenantId, contractId],
    );
    return rows.map(aDocumento);
  }

  /** R2 — documentos de los contratos de la propiedad. */
  async listarDePropiedad(
    ctx: ContextoPeticion,
    propertyId: string,
  ): Promise<ContratoDocumento[]> {
    const { rows } = await ctx.cliente.query(
      `SELECT d.id, d.tenant_id::text AS tenant_id, d.contract_id::text AS contract_id,
              d.nombre, d.origen, d.clave_storage, d.hash_sha256, d.mime,
              d.tamano_bytes, d.metadatos, d.created_at
         FROM contract_document d
         JOIN contract c ON c.id = d.contract_id
        WHERE d.tenant_id = $1 AND c.property_id = $2
        ORDER BY d.created_at`,
      [ctx.tenantId, propertyId],
    );
    return rows.map(aDocumento);
  }

  /** R3 — descarga con hash verificado. */
  async descargar(
    ctx: ContextoPeticion,
    contractId: string,
    documentId: string,
  ): Promise<{ binario: Buffer; nombre: string; hash_sha256: string }> {
    const { rows } = await ctx.cliente.query<{
      clave_storage: string;
      hash_sha256: string;
      nombre: string;
    }>(
      `SELECT clave_storage, hash_sha256, nombre FROM contract_document
        WHERE tenant_id = $1 AND contract_id = $2 AND id = $3`,
      [ctx.tenantId, contractId, documentId],
    );
    const fila = rows[0];
    if (!fila) throw new ResourceNotFoundError();
    const binario = await this.almacenamiento.obtener(fila.clave_storage);
    const hashReal = createHash('sha256').update(binario).digest('hex');
    if (hashReal !== fila.hash_sha256) {
      throw new ResourceNotFoundError();
    }
    return { binario, nombre: fila.nombre, hash_sha256: fila.hash_sha256 };
  }
}

interface FilaDocumento {
  id: string;
  tenant_id: string;
  contract_id: string;
  nombre: string;
  origen: 'generado' | 'digitalizado';
  clave_storage: string;
  hash_sha256: string;
  mime: string;
  tamano_bytes: number | null;
  metadatos: unknown;
  created_at: Date;
}

function aDocumento(fila: unknown): ContratoDocumento {
  const f = fila as FilaDocumento;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    contract_id: f.contract_id,
    nombre: f.nombre,
    origen: f.origen,
    hash_sha256: f.hash_sha256,
    mime: f.mime,
    tamano_bytes: f.tamano_bytes,
    metadatos:
      typeof f.metadatos === 'object' && f.metadatos !== null
        ? (f.metadatos as Record<string, unknown>)
        : null,
    created_at: f.created_at.toISOString(),
  };
}
