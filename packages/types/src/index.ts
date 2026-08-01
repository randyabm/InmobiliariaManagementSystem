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

// Feature #16 contract_templates.
export { ESTADOS_CONTRATO, ESTADOS_PLANTILLA_CONTRATO } from './contratos';
export type {
  Contrato,
  ContratoDocumento,
  ContractTemplate,
  EstadoContrato,
  EstadoPlantillaContrato,
  FirmaContrato,
  MergeFields,
} from './contratos';

// Feature #14 inventory_signature_pdf.
export { FIRMANTES } from './inventario-firma';
export type { FirmaInventario, FirmanteTipo } from './inventario-firma';

// Feature #13 inventory_tenant_review.
export { PROPOSITOS_OTP, RESPUESTAS_REVISION } from './inventario-revision';
export type {
  CodigoOtp,
  InvitacionInventario,
  PropositoOtp,
  RespuestaRevision,
  RevisionItemInventario,
} from './inventario-revision';

// Feature #12 inventory_creation.
export {
  AUTORES_FOTO,
  ESTADOS_CHECKLIST,
  ESTADOS_INVENTARIO,
  TIPOS_EVENTO_INVENTARIO,
} from './inventarios';
export type {
  AutorFoto,
  EstadoChecklist,
  EstadoInventario,
  Inventario,
  InventarioCompleto,
  InventarioItem,
  InventarioItemFoto,
  InventarioZona,
  TipoEventoInventario,
} from './inventarios';

// Feature #11 inventory_templates.
export { FIELD_TYPES, ORIGENES_PLANTILLA } from './plantillas';
export type {
  FieldType,
  OrigenPlantilla,
  PlantillaCompleta,
  PlantillaInmueble,
  PlantillaItem,
  PlantillaZona,
} from './plantillas';

// Feature #10 notifications.
export { CANALES_NOTIFICACION, ESTADOS_PENDIENTE, ESTADOS_PROGRAMADA } from './notificaciones';
export type {
  CanalNotificacion,
  DestinatarioHook,
  EstadoPendiente,
  EstadoProgramada,
  HookNotificacion,
  NotificacionEnviada,
  NotificacionPendiente,
  NotificacionProgramada,
} from './notificaciones';

// Feature #8 property_lifecycle.
export type {
  CicloVidaDePropiedad,
  DashboardFila,
  DashboardPropiedades,
  EstadoCicloVida,
  InstanciaDeCicloVida,
} from './ciclo-vida';

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
