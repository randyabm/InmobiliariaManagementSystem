/**
 * Contratos de la hoja de vida de propietario e inquilino (feature #5).
 *
 * Viven aquí y no duplicados en `apps/web` (docs/conventions.md): el frontend
 * y el backend comparten exactamente la misma forma.
 *
 * **Los campos van en `snake_case`**, igual que en `specs/owner_tenant_profiles/`
 * (R1, R10, R12, R18…) y que las columnas. Es la única excepción a la regla de
 * `camelCase` para variables: estos tipos describen la carga útil HTTP, que el
 * spec fija literalmente, y mantenerlos idénticos a las columnas evita una
 * capa de traducción que solo serviría para introducir erratas.
 *
 * La feature #25 (`retencion_codeudor_referencias`) añadirá sus tipos a este
 * mismo archivo: tarifa de retención, codeudores y referencias.
 */

export const TIPOS_DOCUMENTO = ['CC', 'CE', 'NIT', 'PASAPORTE'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const MEDIOS_PREFERIDOS_CONTACTO = [
  'CORREO',
  'SMS',
  'WHATSAPP',
  'LLAMADA',
] as const;
export type MedioPreferidoContacto = (typeof MEDIOS_PREFERIDOS_CONTACTO)[number];

export const TIPOS_CUENTA = ['AHORROS', 'CORRIENTE'] as const;
export type TipoCuenta = (typeof TIPOS_CUENTA)[number];

/**
 * Identificación de la persona.
 *
 * **Enmendado por D-9 (R68, R69, R71):** aquí queda solo el `nombre`, que es de
 * la persona. El **contacto** —correo y teléfono— se movió al perfil, porque es
 * un dato de la relación comercial con una inmobiliaria concreta y dos
 * inmobiliarias pueden tener datos distintos de la misma persona. `user.email`
 * pasa a ser exclusivamente credencial de acceso, y en un cliente recién
 * registrado queda NULL.
 */
export interface DatosDeContacto {
  readonly nombre: string;
}

export interface PerfilPropietario extends DatosDeContacto {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly tipo_documento: TipoDocumento;
  readonly documento: string;
  /** Contacto de ESTA relación comercial (D-9, R68). Opcional por D-5. */
  readonly email_contacto: string | null;
  readonly telefono_contacto: string | null;
  readonly direccion_notificacion: string | null;
  readonly ciudad: string | null;
  /**
   * Marca fiscal (D-2). La **tarifa** de retención NO vive aquí: la fija la
   * ley, cambia por año y es configuración del tenant (feature #25). La
   * feature #5 captura y devuelve este booleano, pero **no calcula ninguna
   * retención** (R17).
   */
  readonly sujeto_retencion: boolean;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PerfilInquilino extends DatosDeContacto {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly tipo_documento: TipoDocumento;
  readonly documento: string;
  /** Obligatorio (RF-C4, R69): desde D-9 es una columna NOT NULL del perfil. */
  readonly email_contacto: string;
  readonly celular: string;
  readonly medio_preferido_contacto: MedioPreferidoContacto;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CuentaBancaria {
  readonly id: string;
  readonly tenant_id: string;
  readonly perfil_propietario_id: string;
  readonly banco: string;
  readonly tipo_cuenta: TipoCuenta;
  readonly numero_cuenta: string;
  readonly titular_nombre: string;
  readonly titular_tipo_documento: TipoDocumento;
  readonly titular_documento: string;
  readonly es_predeterminada: boolean;
  readonly activa: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Respuesta de `GET /propietarios/:id` (**R12**).
 *
 * NO lleva —y no debe llevar— lista de `propiedades` (**D-1**, diferida a la
 * feature #6) ni certificados fiscales (**D-3**, diferidos al módulo
 * contable) ni ningún porcentaje de retención (**R17**, **D-2**). Hay un test
 * de contrato sobre la respuesta HTTP real que lo verifica.
 */
export interface HojaDeVidaPropietario extends PerfilPropietario {
  readonly cuentas_bancarias: readonly CuentaBancaria[];
  readonly cuenta_predeterminada_id: string | null;
}
