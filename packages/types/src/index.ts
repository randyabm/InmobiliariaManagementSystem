export { HEALTH_ENDPOINT } from './health';
export type { HealthStatus } from './health';
export type { ApiErrorResponse } from './api-error';

// Feature #5 owner_tenant_profiles. La feature #25 añadirá aquí sus tipos.
export {
  MEDIOS_PREFERIDOS_CONTACTO,
  TIPOS_CUENTA,
  TIPOS_DOCUMENTO,
} from './clientes';
export type {
  CuentaBancaria,
  DatosDeContacto,
  HojaDeVidaPropietario,
  MedioPreferidoContacto,
  PerfilInquilino,
  PerfilPropietario,
  TipoCuenta,
  TipoDocumento,
} from './clientes';
