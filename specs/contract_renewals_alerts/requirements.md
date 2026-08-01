# Requirements — contract_renewals_alerts

> Feature #19. Renovaciones y alertas de vencimiento (RF-CT8..CT13, §13.5,
> Ley 820 de 2003).

### R1 — (RF-CT8) Configuración por tenant
CUANDO un usuario con rol `admin` invoca `GET /configuracion-renovacion`,
el sistema DEBE responder la configuración del tenant (umbrales en días
múltiples, destinatarios por rol, IPC anual) con valores por defecto si no
existe; y CUANDO invoca `PUT /configuracion-renovacion`, DEBE guardarla.

### R2 — (RF-CT10) Panel de vencimientos
CUANDO un usuario con rol `admin` o `empleado` invoca
`GET /contratos/vencimientos?dias=90`, el sistema DEBE responder los
contratos `vigente` o `firmado` con `fecha_fin` dentro del rango, con días
restantes, estado de gestión y el tiempo desde la primera alerta.

### R3 — (RF-CT9, RF-CT12) Generación de alertas
CUANDO un usuario con rol `admin` invoca `POST /contratos/vencimientos/
alertas`, el sistema DEBE encolar por el motor de notificaciones (#10) una
entrega por cada contrato que cruce un umbral no notificado aún
(`alerta_vencimiento` dedupe), dirigida a los destinatarios configurados
(RF-C4), y DEBE registrar la alerta con `enviada_en`; la repetición NO
DEBE duplicar (mismo contrato+umbral).

### R4 — (RF-CT11, Ley 820) Renovación asistida
CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /contratos/:id/renovar` con `{ nuevo_canon?, nueva_fecha_fin? }`, el
sistema DEBE crear el contrato renovado con el canon propuesto (IPC de la
configuración o el incremento pactado de la propiedad, ajustable
manualmente) y las fechas nuevas, generar el documento de prórroga (merge
del template, como #17), y DEBE auditar la decisión (quién, cuándo,
valores).

### R5 — (RF-CT13) No renovación
CUANDO un usuario con rol `admin` o `empleado` invoca
`POST /contratos/:id/no-renovar` con `{ motivo }`, el sistema DEBE auditar
la decisión (RF-CT12), ejecutar la transición `iniciar_desocupacion` de la
propiedad (RF-P4/#8) y crear el inventario de salida (`DEVOLUCION`,
borrador de #12) si no existe.

### R6 — (RF-C3, C4/C6) Aislamiento y migración
SI una petición de otro tenant consulta, renueva o da de baja un contrato
ENTONCES 404. Roles: R1 y R3 solo admin; R2/R4/R5 admin/empleado; 401 sin
token. Las tablas `config_renovacion` y `alerta_vencimiento` viven en una
única migración (RLS ENABLE+FORCE); `TABLAS_PERMITIDAS` (+2) y
`RUTAS_PERMITIDAS` (+5) se actualizan en el mismo cambio.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-19-1 | El IPC se carga manualmente por el admin (valor anual, §13.5); el incremento pactado de la propiedad tiene prioridad si existe |
| PA-19-2 | La renovación crea un CONTRATO NUEVO (prórroga con fechas/canon nuevos); el histórico queda en `contract` por propiedad |
| PA-19-3 | La generación de alertas es manual (botón admin); un job programado puede dispararla después sin tocar el motor |
