/**
 * Contratos de arrendamiento (features #16–#19, §13).
 *
 * `ContractTemplate` es el clausulado con campos variables (merge fields):
 * la base del tenant (`property_id` NULL) y la copia por propiedad. El
 * merge y la firma viven en #17.
 */

export const ESTADOS_PLANTILLA_CONTRATO = ['borrador', 'validado'] as const;
export type EstadoPlantillaContrato = (typeof ESTADOS_PLANTILLA_CONTRATO)[number];

export interface MergeFields {
  readonly [campo: string]: string;
}

export const ESTADOS_CONTRATO = ['vigente', 'firmado'] as const;
export type EstadoContrato = (typeof ESTADOS_CONTRATO)[number];

export interface Contrato {
  readonly id: string;
  readonly tenant_id: string;
  readonly property_id: string;
  readonly inquilino_id: string;
  readonly propietario_id: string;
  readonly fecha_inicio: string;
  readonly fecha_fin: string;
  readonly estado: EstadoContrato;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FirmaContrato {
  readonly id: string;
  readonly tenant_id: string;
  readonly contract_id: string;
  readonly firmante_tipo: 'EMPLEADO' | 'INQUILINO';
  readonly firmante_user_id: string;
  readonly hash_documento: string;
  readonly ip: string;
  readonly otp_verificado_en: string | null;
  readonly created_at: string;
}

export interface ContractTemplate {
  readonly id: string;
  readonly tenant_id: string;
  readonly property_id: string | null;
  readonly nombre: string;
  readonly cuerpo: string;
  readonly merge_fields_json: Readonly<Record<string, string>>;
  readonly version: number;
  readonly validado_por: string | null;
  readonly estado: EstadoPlantillaContrato;
  readonly created_at: string;
  readonly updated_at: string;
}
