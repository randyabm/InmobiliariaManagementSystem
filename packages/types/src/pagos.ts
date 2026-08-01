/**
 * Contratos de la conciliación de pagos (feature #30, §15, D9).
 * El sistema es un ESPEJO de la información externa: nunca procesa pagos.
 */

export const ESTADOS_REGISTRO_PAGO = [
  'Cargado',
  'Sugerido',
  'Conciliado',
  'Sin_identificar',
  'Duplicado',
  'Descartado',
] as const;
export type EstadoRegistroPago = (typeof ESTADOS_REGISTRO_PAGO)[number];

export interface PaymentRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly import_id: string;
  readonly fecha_movimiento: string;
  readonly valor: string;
  readonly referencia_texto: string | null;
  readonly pagador_texto: string | null;
  readonly cuenta_destino: string | null;
  readonly medio_pago: string | null;
  readonly estado: EstadoRegistroPago;
  readonly contract_id: string | null;
  readonly estrategia_conciliacion: string | null;
  readonly confianza: number | null;
  readonly conciliado_por: string | null;
  readonly fecha_conciliacion: string | null;
  readonly created_at: string;
}

export interface MapeoColumnas {
  readonly [columna_archivo: string]: string;
}
