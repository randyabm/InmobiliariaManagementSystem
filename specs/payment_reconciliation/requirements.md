# Requirements — payment_reconciliation

> Feature #30. Conciliación de Pagos (RF-PA1..PA15, §15, D9). Fase 3.
> Premisa dura: el sistema NO procesa pagos ni emite recibos — es un
> espejo de la información externa (15.1).

### R1 — (RF-PA1, RF-PA3) Carga de archivos agnóstica al formato
CUANDO un usuario con rol `admin` o `empleado` envía `POST
/pagos/importaciones` (multipart: archivo CSV/Excel/TXT + `nombre_origen`),
el sistema DEBE guardar el archivo (hash SHA-256 en `PaymentImport`),
inferir la estructura (RF-PA5) y DEBE responder 202 con el mapeo propuesto
para confirmación (RF-PA6). Cada tenant conserva su propio `nombre_origen`.

### R2 — (RF-PA5, RF-PA6) Mapeo propuesto, confirmable y reutilizable
CUANDO la inferencia propone el mapeo (`{columna_archivo → campo_canonico}`),
el sistema DEBE permitir al asesor confirmarlo (`POST /pagos/importaciones/
:id/mapeo` con el mapeo corregido) y DEBE guardarlo como
`PaymentMappingProfile` por (tenant, nombre_origen) para reutilizarlo en
cargas siguientes (si el perfil existe, se aplica sin inferencia).
**Salvaguarda (§15.3):** el mapeo decide QUÉ columna es QUÉ; los VALORES
se parsean de forma determinista (nunca transcritos por IA).

### R3 — (RF-PA2, RF-PA4) Modelo canónico e idempotencia
CUANDO se procesa el archivo con el mapeo confirmado, el sistema DEBE
crear los `PaymentRecord` canónicos (fecha, valor, referencia, pagador,
cuenta, medio) parseando determinísticamente; la recarga del mismo archivo
(mismo hash) o de períodos solapados NO DEBE duplicar: los duplicados
quedan marcados `Duplicado` (RF-PA4).

### R4 — (RF-PA7, RF-PA8, RF-PA11) Emparejamiento sugerido
CUANDO los registros existen, el sistema DEBE proponer el contrato por las
estrategias combinadas de §15.4 (referencia única `ARR-XXXXX` — RF-PA9 —,
cuenta destino + valor + ventana de fecha, nombre similar), indicando la
estrategia y el nivel de confianza (RF-PA7), y DEBE presentar la carga en
tres grupos: sugeridos / sin identificar / pendientes (RF-PA8). Cada
registro guarda `estrategia_conciliacion` (RF-PA11). Ninguno se marca
`Conciliado` sin confirmación humana (salvaguarda §15.3).

### R5 — (RF-PA10, RF-PA9) Bandeja de excepciones y referencia única
CUANDO un asesor resuelve un registro sin identificar (`PATCH
/pagos/registros/:id` con `contract_id` o `descartar`), el sistema DEBE
registrar quién y cuándo (auditoría) y DEBE generar/exponer la referencia
única de pago por contrato (`GET /contratos/:id/referencia-pago`).

### R6 — (RF-PA12, RF-PA13, RF-PA14, RF-PA15) Uso de la información
CUANDO existen pagos conciliados, el sistema DEBE exponer el estado de
cuenta del contrato (GET /contratos/:id/estado-cuenta, para el inquilino
con scoping), identificar morosidad (canon esperado sin pago en el plazo
configurado) y DEBE generar las alertas por el motor de #10 (RF-PA13,
RF-C4); los reportes al propietario y los KPIs (RF-PA14/PA15) DEBEN quedar
anclados a los portales de Fase 3+ (frontera).

### R7 — (RF-C3, §16.1, C4/C6) Seguridad determinista y migración
SI una petición de otro tenant consulta importaciones, registros o el
estado de cuenta ENTONCES 404. Roles: admin/empleado (inquilino: solo su
estado de cuenta, R6); sin token 401. **Los invariantes se prueban SIN IA**
(§16.1): el parseo determinista tiene tests propios. Migración única con
`PaymentImport`, `PaymentRecord`, `PaymentMappingProfile` (RLS ENABLE+
FORCE, CHECK estado del registro: Cargado/Sugerido/Conciliado/
Sin_identificar/Duplicado/Descartado); `TABLAS_PERMITIDAS` (+3) y
`RUTAS_PERMITIDAS` (+8) actualizadas.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-30-1 | La inferencia de estructura es una interfaz `InferidorEstructura` con implementación MVP DETERMINISTA basada en encabezados/filas de ejemplo (sin LLM en esta iteración); el LLM se enchufa detrás de la interfaz en Fase 4 (frontera #33) |
| PA-30-2 | El parseo de valores es 100% determinista (código), nunca IA (§15.3 salvaguarda) |
| PA-30-3 | La morosidad se configura por tenant (días de gracia) reutilizando `config_renovacion` o una nueva llave; los reportes al propietario y KPIs quedan para los portales (frontera explícita) |

Sin preguntas de producto abiertas (los pendientes de §15.7 quedan anotados
como frontera).
