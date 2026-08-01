export { HEALTH_ENDPOINT } from './health';
export type { HealthStatus } from './health';
export type { ApiErrorResponse } from './api-error';

// Feature #6 property_profile.
export { TIPOS_PROPIEDAD } from './propiedades';
export type {
  HistorialOcupacion,
  Propiedad,
  PropiedadConExtras,
  PropiedadDocumento,
  PropiedadPropietario,
  TipoPropiedad,
} from './propiedades';

// Feature #7 workflow_engine.
export {
  OPERADORES_CONDICION,
  ORIGENES_DEFINICION,
  TIPOS_EJECUCION,
} from './workflows';
export type {
  Condicion,
  CondicionClausula,
  DefinicionCompleta,
  InstanciaConDisponibles,
  NotificacionHook,
  OperadorCondicion,
  OrigenDefinicion,
  TipoEjecucion,
  WorkflowDefinicion,
  WorkflowEstado,
  WorkflowInstancia,
  WorkflowTransicion,
  WorkflowTransicionLog,
} from './workflows';

// Feature #5 owner_tenant_profiles y feature #25 retencion_codeudor_referencias.
export {
  MEDIOS_PREFERIDOS_CONTACTO,
  TIPOS_CODEUDOR,
  TIPOS_CUENTA,
  TIPOS_DOCUMENTO,
} from './clientes';
export type {
  CodeudorInquilino,
  CuentaBancaria,
  DatosDeContacto,
  HojaDeVidaPropietario,
  MedioPreferidoContacto,
  PerfilInquilino,
  PerfilPropietario,
  ReferenciaInquilino,
  TarifaRetencion,
  TipoCodeudor,
  TipoCuenta,
  TipoDocumento,
} from './clientes';
