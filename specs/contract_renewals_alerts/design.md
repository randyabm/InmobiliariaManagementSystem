# Design — contract_renewals_alerts

## 1. Tablas (migración 0022)
config_renovacion (tenant_id PK, umbrales_dias jsonb, avisar_a jsonb,
ipc_anual numeric) y alerta_vencimiento (id, tenant, contract_id,
umbral_dias, enviada_en; UNIQUE contract+umbral). RLS ENABLE+FORCE.

## 2. Rutas (6)
GET/PUT /configuracion-renovacion (admin) · GET /contratos/vencimientos
(panel) · POST /contratos/vencimientos/alertas (admin, dedupe) · POST
/contratos/:id/renovar · POST /contratos/:id/no-renovar.

## 3. Reglas de negocio (Ley 820)
- Renovación: canon nuevo = canon × (1 + incremento_pactado/100) si la
  propiedad lo declara; si no, IPC de la configuración (PA-19-1).
- La renovación crea un CONTRATO NUEVO (PA-19-2) + documento de prórroga.
- No renovar: audita (RF-CT12), transiciona a en_desocupacion (workflow
  #8, clave iniciar_desocupacion) y crea el inventario DEVOLUCION.
- Alertas: manuales (PA-19-3), dedupe por (contract, umbral).
