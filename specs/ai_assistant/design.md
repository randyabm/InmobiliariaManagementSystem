# Design — ai_assistant

## 1. Arquitectura (D8, §14.4)
```
Canal (WhatsApp/web) → Orquestador (interfaz AsistenteConversacional, PA-33-1)
  → Herramientas acotadas (PA-33-2): llaman a SERVICIOS con la sesión
  → Respuesta + auditoría (RF-CB12)
```
El orquestador recibe `{ sesion: ContextoPeticion, mensaje, historial }` y
las herramientas son funciones del dominio que filtran por RBAC+RLS de la
sesión (RF-CB10/CB11): imposible devolver datos fuera de scope por
construcción.

## 2. Herramientas (R3, R4)
- `consultar_tickets` (frontera #31), `consultar_vencimientos` (#19),
  `consultar_pagos` (#30), `consultar_inventario` (#12-14),
  `crear_ticket` (bajo riesgo, confirmación), `agendar_visita` (lead,
  RF-CB3, frontera CRM).
- Límite duro (R4): las herramientas de firma/aprobación NO existen en el
  asistente; el escalamiento transfiere el hilo (RF-CB9).

## 3. Configuración y flags (R5, R7)
`config_asistente` (tenant, activo, canal_habilitado, paquete) en una
migración única con RLS si aplica; las notificaciones proactivas usan el
outbox de #10 con plantillas (WhatsApp pre-aprobadas, RF-CB8).

## 4. Pruebas (§16.1)
- Deterministas: seguridad (aislamiento por identidad, herramientas fuera
  de scope rechazadas, auditoría completa) — sin LLM.
- Evals (Promptfoo): calidad de respuesta, red-teaming de prompt injection.

## 5. Archivos
Migración `0028_ai_assistant.sql` (config_asistente), tipos
`packages/types/src/asistente.ts`, `modules/core/asistente/`
(asistente.{service,controller}.ts + herramientas/), tests deterministas,
evals/ (promptfoo). Fronteras: RAG, proveedor LLM, leads CRM.
