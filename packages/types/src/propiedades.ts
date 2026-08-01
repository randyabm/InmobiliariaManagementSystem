/**
 * Contratos de la hoja de vida del inmueble (feature #6, RF-P1/P2/P3).
 *
 * Viven aquí y no duplicados en `apps/web` (docs/conventions.md): el frontend
 * y el backend comparten exactamente la misma forma.
 *
 * **Los campos van en `snake_case`**, igual que en `clientes.ts`: describen
 * la carga útil HTTP y las columnas, sin capa de traducción.
 */

export const TIPOS_PROPIEDAD = [
  'APARTAMENTO',
  'CASA',
  'LOCAL',
  'OFICINA',
  'BODEGA',
  'PARQUEADERO',
] as const;
export type TipoPropiedad = (typeof TIPOS_PROPIEDAD)[number];

/**
 * Ficha de la propiedad con los cuatro grupos de datos del PRD (RF-P1).
 *
 * `canon`, `valor_administracion`, `area` e `incremento_anual_pactado` son
 * **cadenas decimales exactas** (R9): el driver `pg` devuelve `numeric` como
 * cadena y convertirlos a `number` introduciría error de coma flotante en
 * dinero (docs/conventions.md, "Dinero y fechas").
 *
 * `fotos` son claves de object storage, nunca binarios (R17).
 */
export interface Propiedad {
  readonly id: string;
  readonly tenant_id: string;
  readonly direccion: string;
  readonly tipo: TipoPropiedad;
  readonly area: string;
  readonly matricula_inmobiliaria: string | null;
  readonly estrato: number | null;
  readonly parqueaderos: number;
  readonly depositos: number;
  readonly fotos: readonly string[];
  readonly canon: string;
  readonly valor_administracion: string | null;
  readonly canon_incluye_administracion: boolean;
  readonly incremento_anual_pactado: string | null;
  readonly nombre_conjunto: string | null;
  readonly contacto_admin_nombre: string | null;
  readonly contacto_admin_telefono: string | null;
  readonly contacto_admin_correo: string | null;
  readonly propietario_principal_id: string;
  readonly cuenta_bancaria_id: string | null;
  readonly inquilino_actual_id: string | null;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Propietario adicional de la propiedad (RF-P2, R2). El principal vive en
 * `propiedad.propietario_principal_id`.
 */
export interface PropiedadPropietario {
  readonly id: string;
  readonly tenant_id: string;
  readonly propiedad_id: string;
  readonly perfil_propietario_id: string;
  readonly activo: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Período de ocupación (RF-P3, R3). `hasta` NULL = ocupación vigente.
 */
export interface HistorialOcupacion {
  readonly id: string;
  readonly tenant_id: string;
  readonly propiedad_id: string;
  readonly perfil_inquilino_id: string;
  readonly desde: string;
  readonly hasta: string | null;
  readonly inquilino_nombre: string | null;
}

/**
 * Documento del repositorio documental (RF-P3, R4).
 *
 * `clave_storage` es la clave del objeto en MinIO; `hash_sha256` es el
 * SHA-256 del binario (R21). El binario nunca vive en la base.
 */
export interface PropiedadDocumento {
  readonly id: string;
  readonly tenant_id: string;
  readonly propiedad_id: string;
  readonly nombre: string;
  readonly tipo_documento: string | null;
  readonly clave_storage: string;
  readonly hash_sha256: string;
  readonly mime: string | null;
  readonly tamano_bytes: number | null;
  readonly activo: boolean;
  readonly created_at: string;
}

/**
 * Ficha completa de `GET /propiedades/:id` (R6): la propiedad, sus
 * propietarios activos (principal + adicionales), la cuenta de giro resuelta
 * (R8: override → predeterminada del principal → null) y los datos básicos
 * del inquilino actual.
 *
 * `estado_ciclo_vida` (feature #8, R3): el estado se lee de la instancia
 * del motor de workflows, nunca de una columna de `propiedad` (PA-8-1).
 */
export interface PropiedadConExtras extends Propiedad {
  readonly propietarios: readonly PropiedadPropietario[];
  readonly cuenta_giro: import('./clientes').CuentaBancaria | null;
  readonly inquilino_actual_nombre: string | null;
  readonly estado_ciclo_vida: import('./ciclo-vida').EstadoCicloVida | null;
}
