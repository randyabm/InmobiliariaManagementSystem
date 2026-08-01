# Requirements — ai_assistant

> Feature #33. Asistente conversacional / Chatbot IA (RF-CB1..CB15, §14,
> D8). Fase 4+. Los invariantes de seguridad se fijan desde el MVP aunque
> la entrega sea Fase 4+.

### R1 — (RF-CB1, RF-CB2) Modos autenticado y público con superficies separadas
CUANDO un usuario autenticado (asesor/propietario/inquilino) conversa, el
asistente DEBE responder solo dentro del scope del usuario (RBAC + RLS);
CUANDO un prospecto conversa, DEBE exponer SOLO el catálogo comercial
público del tenant (nunca datos privados). Las superficies DEBEN estar
separadas por construcción.

### R2 — (RF-CB10, RF-CB11, RF-CB14) Herramientas acotadas, nunca acceso directo
CADA capacidad del asistente DEBE implementarse como una herramienta
acotada que recibe la sesión y llama a la API (RBAC + RLS del usuario que
pregunta); el asistente NO DEBE tener credenciales de acceso amplio, y las
herramientas DEBEN ser incapaces por construcción de devolver datos fuera
del scope (defensa ante prompt injection, RF-CB11). NO se expone consulta
libre a la base de datos.

### R3 — (RF-CB4, RF-CB5) Consulta y acciones de bajo riesgo
CUANDO el usuario pregunta por estado de tickets (frontera #31),
vencimientos (#19), pagos (#30), inventarios (#12-14) o datos de su
propiedad, el asistente DEBE responder con la API en vivo; CUANDO la
acción es de bajo riesgo y reversible (crear ticket, agendar visita,
actualizar contacto propio), DEBE ejecutarla con confirmación del usuario
y auditoría (RF-CB12).

### R4 — (RF-CB6) Límite duro: acciones irreversibles escalan
EL asistente NO DEBE ejecutar acciones irreversibles ni legalmente
vinculantes (firmar, aprobar costos, modificar contratos, confirmar pagos,
aceptar inventarios): SIEMPRE DEBE escalar a una persona (RF-CB9,
transferencia con el hilo completo).

### R5 — (RF-CB7, RF-CB8) Notificaciones proactivas
CUANDO existe un evento (vencimiento, mora, inventario pendiente de
revisión), el asistente DEBE poder iniciar conversaciones por el canal
configurado respetando RF-C4, baja voluntaria y Ley 1581 (RF-CB8); en
WhatsApp DEBE usar plantillas pre-aprobadas (restricción de canal).

### R6 — (RF-CB12, RF-CB13, §16.1) Auditoría, PII y evals
TODA consulta y acción del asistente DEBE quedar en la auditoría (quién,
qué datos se devolvieron, qué acción); el asistente NO DEBE exponer PII
más allá de lo necesario (Ley 1581). Los invariantes de seguridad se
prueban DETERMINISTA (§16.1); las capacidades conversacionales se evalúan
con evals (Promptfoo).

### R7 — (RF-CB3, RF-CB15, C4/C6) Leads, feature flag y gobernanza
CUANDO un prospecto agenda visita o deja su contacto, el sistema DEBE
registrarlo como lead (frontera CRM); el asistente DEBE activarse por
tenant vía feature flag y solo exponer capacidades de los paquetes activos
(RF-CB15). Sin migraciones si el flag vive en config del tenant; si se
requiere tabla de configuración del asistente, una única migración con RLS.

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-33-1 | La capa de conversación (orquestador + herramientas) se implementa tras una interfaz `AsistenteConversacional`; el proveedor LLM se enchufa detrás (Promptfoo para evals; el proveedor concreto se decide en implementación, §14.5) |
| PA-33-2 | Las herramientas acotadas reutilizan los SERVICIOS de la API (no nuevas rutas HTTP por herramienta): el orquestador inyecta la sesión y llama a los servicios con el contexto del usuario |
| PA-33-3 | Sin RAG documental en la primera iteración (frontera §14.4): solo tool use sobre datos transaccionales; el índice semántico queda anotado |

Sin preguntas de producto abiertas (los pendientes de §14.5 quedan
anotados).
