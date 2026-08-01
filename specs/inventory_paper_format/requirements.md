# Requirements — inventory_paper_format

> Feature #29. Contingencia de campo: formato en papel co-diligenciado y
> reconstrucción digital (RF-I19, RF-I20, RF-I21, §10.5). Fase 2.
> Anclaje: RF-I2 (una sola plantilla, dos representaciones).

### R1 — (RF-I19) Formato en papel pre-generado
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/inventarios/:id/formato-papel`, el sistema DEBE generar un PDF imprimible
SIN imágenes desde la plantilla del inmueble: datos de propiedad/contrato
pre-impresos, tabla zonas → ítems → estado (Bueno/Regular/Malo), columnas
separadas de notas para AGENTE e INQUILINO, espacios de firma manuscrita y
un ID/QR que vincula el papel con el borrador existente; DEBE responder el
binario y el ID de vínculo. El inventario DEBE estar en `BORRADOR` (409 si
no).

### R2 — (RF-I20) Reconstrucción digital
CUANDO un usuario con rol `admin` o `empleado` invoca `POST
/inventarios/:id/reconstruir` con `{ notas_agente, notas_inquilino,
fotos: [{item_id, binario}]?, escaneo_papel? }`, el sistema DEBE
transcribir las notas de ambas partes a los ítems (comentario), etiquetar
cada foto suelta a su ítem (`autor = 'EMPLEADO'`, flujo de #12), adjuntar
el escaneo del papel firmado en `propiedad_documento`
(`tipo_documento='inventario_papel'`) y DEBE responder la ficha
reconstruida. La reconstrucción NO crea un inventario nuevo: retoma el
borrador por su ID (R1).

### R3 — (RF-I21) Confirmación electrónica del papel
CUANDO el borrador reconstruido se envía (`POST
/inventarios/:id/confirmar-papel`), el sistema DEBE transicionar a
`ENVIADO` (flujo de #13) para que el inquilino confirme con su OTP (el
flujo de revisión existente); la evidencia de la confirmación es la del
flujo digital (timestamp, IP, OTP — #13/#14) y el escaneo del papel
firmado queda como respaldo. La confirmación es una CONFIRMACIÓN, no una
re-firma (el papel ya vale por sí mismo, Ley 527).

### R4 — (RF-C3, C4/C6) Aislamiento y gobernanza
SI una petición de otro tenant genera el formato o reconstruye ENTONCES
404. Roles: admin/empleado; sin token 401. Sin tablas nuevas: el formato
es PDF calculado, las fotos usan #12 y el escaneo `propiedad_documento`;
`RUTAS_PERMITIDAS` (+3) se actualiza.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-29-1 | El PDF del formato reutiliza `GeneradorPdf` de #14 con una vista «tabla sin fotos»; el QR/ID es el id del inventario (texto y código QR con `qrcode` en el cliente o servidor según tamaño) |
| PA-29-2 | La transcripción de notas es MANUAL por el agente (R2); no hay IA en esta feature |
| PA-29-3 | La confirmación del inquilino usa el flujo existente de #13 (OTP), sin estados nuevos |

Sin preguntas de producto abiertas.
