import { Injectable } from '@nestjs/common';
import type { PropiedadDocumento } from '@inmobiliaria/types';

import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { ResourceNotFoundError } from '../../../common/errors';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service';
import { PropiedadesService } from './propiedades.service';

/**
 * Repositorio documental de la propiedad (RF-P3, R13, R16).
 *
 * El binario se sube a object storage y en la base solo queda la fila con la
 * clave, el hash SHA-256 (R21), el mime y el tamaño. La baja es lógica y NO
 * borra el objeto (R16): la trazabilidad de qué se archivó y cuándo vive en
 * `audit_log`, y un objeto borrado perdería esa referencia.
 */
@Injectable()
export class DocumentosService {
  constructor(
    private readonly propiedades: PropiedadesService,
    private readonly almacenamiento: AlmacenamientoService,
  ) {}

  /** R13, R21 — subir el binario y registrar la fila. */
  async subir(
    propiedadId: string,
    datos: { nombre: string; tipoDocumento: string | null; binario: Buffer; mime: string },
    ctx: ContextoPeticion,
  ): Promise<PropiedadDocumento> {
    await this.propiedades.exigir(propiedadId, ctx);

    const { clave, hash_sha256, tamano_bytes } = await this.almacenamiento.subir(
      datos.binario,
      datos.mime,
    );

    const { rows } = await ctx.cliente.query(
      `INSERT INTO propiedad_documento
         (tenant_id, propiedad_id, nombre, tipo_documento, clave_storage,
          hash_sha256, mime, tamano_bytes, subido_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, tenant_id, propiedad_id, nombre, tipo_documento,
                 clave_storage, hash_sha256, mime, tamano_bytes, activo,
                 created_at`,
      [
        ctx.tenantId,
        propiedadId,
        datos.nombre,
        datos.tipoDocumento,
        clave,
        hash_sha256,
        datos.mime,
        tamano_bytes,
        ctx.actorId ?? null,
      ],
    );
    return aDocumento(rows[0]!);
  }

  /** R16 — solo activos. */
  async listar(
    propiedadId: string,
    ctx: ContextoPeticion,
  ): Promise<PropiedadDocumento[]> {
    await this.propiedades.exigir(propiedadId, ctx);

    const { rows } = await ctx.cliente.query(
      `SELECT id, tenant_id, propiedad_id, nombre, tipo_documento,
              clave_storage, hash_sha256, mime, tamano_bytes, activo, created_at
         FROM propiedad_documento
        WHERE tenant_id = $1 AND propiedad_id = $2 AND activo = true
        ORDER BY created_at DESC`,
      [ctx.tenantId, propiedadId],
    );
    return rows.map(aDocumento);
  }

  /** R16 — baja lógica; el objeto de storage NO se borra. */
  async archivar(
    propiedadId: string,
    idDocumento: string,
    ctx: ContextoPeticion,
  ): Promise<void> {
    await this.propiedades.exigir(propiedadId, ctx);

    const { rowCount } = await ctx.cliente.query(
      `UPDATE propiedad_documento SET activo = false, updated_at = now()
        WHERE id = $1 AND propiedad_id = $2 AND tenant_id = $3`,
      [idDocumento, propiedadId, ctx.tenantId],
    );
    if ((rowCount ?? 0) === 0) {
      throw new ResourceNotFoundError();
    }
  }
}

interface FilaDocumento {
  id: string;
  tenant_id: string;
  propiedad_id: string;
  nombre: string;
  tipo_documento: string | null;
  clave_storage: string;
  hash_sha256: string;
  mime: string | null;
  tamano_bytes: number | null;
  activo: boolean;
  created_at: Date;
}

function aDocumento(fila: unknown): PropiedadDocumento {
  const f = fila as FilaDocumento;
  return {
    id: f.id,
    tenant_id: f.tenant_id,
    propiedad_id: f.propiedad_id,
    nombre: f.nombre,
    tipo_documento: f.tipo_documento,
    clave_storage: f.clave_storage,
    hash_sha256: f.hash_sha256,
    mime: f.mime,
    tamano_bytes: f.tamano_bytes,
    activo: f.activo,
    created_at: f.created_at.toISOString(),
  };
}
