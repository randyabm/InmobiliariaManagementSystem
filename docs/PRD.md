# PRD — Sistema de Gestión de Clientes, Arrendatarios y Propiedades

**Versión:** 0.2
**Tipo de documento:** Product Requirements Document (PRD)
**Alcance:** Arquitectura general y requerimientos del sistema, modelo modular de paquetes, decisiones de stack tecnológico, y detalle profundo del módulo de Inventarios.

> **Cambios en v0.2** (tras sesión de decisiones técnicas):
> - Se añade la **sección 11 — Decisiones de arquitectura y stack tecnológico** (NestJS, PostgreSQL + RLS, PWA offline, MinIO self-host, etc.).
> - Se añade **RF-I18** (sincronización manual disparable por el usuario, red de seguridad para iOS/Safari).
> - Se reescribe la contingencia de campo: nueva **sección 10.5** con el modelo de **formato en papel co-diligenciado** (RF-I19, RF-I20, RF-I21).
> - Se añade **autogestión de reclamos y reparaciones** para inquilinos y propietarios (nueva **sección 6.5**, RF-M1..RF-M7) y la **integración con WordPress / portales embebibles** (nueva **sección 6.6**, RF-INT1..RF-INT6; decisión de arquitectura **D7** en la sección 11). Ambos previstos para Fase 3-4, con la arquitectura API-first preparada desde el MVP.
> - Se detalla el **modelo de plantillas de inmuebles** (nueva **sección 8.8**, RF-I22..RF-I24): jerarquía zona → ítem → tipo de campo, zonas repetibles, herencia en cascada (sistema → tenant → ad-hoc con libertad total), catálogo base para Apartamento/Casa/Local/Oficina/Bodega/Parqueadero, y 3 entidades nuevas en el modelo de datos.
> - Se amplía el Core a **"hoja de vida" de inmueble y propietario** (secciones 6.1, 6.2 ampliadas: canon, administración, cuenta del canon, datos del inquilino y medio preferido de contacto). Nuevas **sección 12** (ingreso de propiedad, ciclo de vida/dashboard, afianzamiento con captura de póliza — RF-P4/P5, RF-PI1..PI8, entidad `InsurancePolicy`) y **sección 13** (Módulo Gestión de Contratos: template en 3 ámbitos, generación asistida, firma, digitalización de físicos — RF-CT1..CT7, entidades `ContractTemplate`, `ContractDocument`, `BankAccount`).
> - **Decisión de alcance:** la hoja de vida, el dashboard de estados y Contratos se suben al **MVP (Fase 1)** — roadmap (sección 9) actualizado.
> - Se añaden **renovaciones y alertas de vencimiento configurables** (nueva **sección 13.5**, RF-CT8..CT13), incluyendo el marco de la **Ley 820 de 2003** (prórroga automática e incremento por IPC) y la renovación asistida.
> - Se añade la **Estrategia de pruebas y calidad** (nueva **sección 16**, RF-QA1..RF-QA11; decisión **D10**): stack de pruebas self-hosted (Vitest, Testcontainers, Playwright) y evaluación de las funciones de IA con herramientas agnósticas de proveedor (Promptfoo + Langfuse), incluyendo **red-teaming de prompt injection**. Regla dura: los invariantes de seguridad se prueban de forma determinista, nunca con juicio de un modelo.
> - Se añade **Conciliación de Pagos** (nueva **sección 15**, RF-PA1..RF-PA15; decisión **D9**): el sistema **no procesa pagos ni emite recibos** — ingesta por archivo de sistemas externos, con **interpretación asistida por IA** (formato aún desconocido) y confirmación humana obligatoria. Reemplaza al antiguo paquete "Cobranza y Pagos" (se elimina pasarela de pagos y facturación del alcance).
> - Se añade el **Asistente conversacional / Chatbot IA** (nueva **sección 14**, RF-CB1..RF-CB15; decisión de arquitectura **D8**): multi-canal (WhatsApp + web), para asesores, propietarios, inquilinos y prospectos, con acciones de bajo riesgo y notificaciones proactivas. Entrega en **Fase 4+**, con invariantes de seguridad (aislamiento por identidad, defensa ante manipulación) fijados desde el MVP.

---

## 1. Resumen ejecutivo

El objetivo es construir una plataforma SaaS multi-rol para inmobiliarias que centralice la gestión de **propiedades, propietarios, arrendatarios (inquilinos) y clientes**, a través de **workflows configurables**. El producto se vende como una arquitectura **modular por paquetes de funcionalidad**: cada inmobiliaria (tenant) contrata un núcleo base y activa los módulos/paquetes que necesita (por ejemplo, "Inventarios y manejo de inmuebles", "Gestión de contratos", "Cobranza", "Mantenimiento", etc.).

Este documento define:
- La visión y objetivos del producto.
- Los roles y usuarios del sistema.
- La arquitectura modular y el modelo de paquetización/comercialización.
- Los requerimientos funcionales y no funcionales generales.
- El detalle específico del primer módulo prioritario: **Inventarios de Propiedades**.

---

## 2. Objetivos del producto

| Objetivo | Descripción |
|---|---|
| **O1. Multi-tenant SaaS** | Un mismo sistema debe servir a múltiples inmobiliarias (clientes B2B) de forma aislada y segura. |
| **O2. Modularidad comercial** | Cada inmobiliaria contrata solo los paquetes de funcionalidades que necesita; el sistema debe activarlos/desactivarlos por cliente (feature flags / licensing). |
| **O3. Multi-rol** | Soportar Inmobiliaria (admin/empleados), Propietarios y Arrendatarios/Inquilinos como actores con vistas y permisos propios. |
| **O4. Workflows configurables** | Los procesos (entrega de inmueble, firma de contrato, cobranza, mantenimiento) deben modelarse como flujos de estados configurables, no lógica fija en código. |
| **O5. Trazabilidad legal** | Los procesos críticos (como el inventario de entrega) deben generar documentos con validez probatoria, firmados digitalmente por las partes. |
| **O6. Escalabilidad** | Arquitectura preparada para crecer en número de inmobiliarias, propiedades y volumen de documentos/fotos. |

---

## 3. Roles y usuarios (multi-rol)

| Rol | Descripción | Acceso principal |
|---|---|---|
| **Super Admin (Anthropic del producto / proveedor SaaS)** | Administra tenants (inmobiliarias), paquetes contratados, facturación del producto. | Panel de administración global |
| **Admin Inmobiliaria** | Dueño/gerente de la cuenta de la inmobiliaria. Configura workflows, usuarios internos, paquetes activos. | Panel de administración del tenant |
| **Empleado / Agente inmobiliario** | Ejecuta operaciones diarias: crea inventarios, gestiona propiedades, atiende clientes. | App web/móvil operativa |
| **Propietario** | Dueño del inmueble gestionado por la inmobiliaria. Consulta estado de su propiedad, contratos, reportes. | Portal propietario (lectura + aprobaciones) |
| **Arrendatario / Inquilino** | Persona que renta el inmueble. Recibe inventarios, firma documentos, reporta incidencias. | Portal/app inquilino (acceso vía link o cuenta) |
| **Cliente prospecto** | Persona interesada en una propiedad (compra o arriendo), antes de convertirse en inquilino/comprador. | Landing / CRM |

> Nota: un mismo usuario (persona natural) podría tener más de un rol en el tiempo (ej. fue inquilino y luego es propietario), por lo que el modelo de identidad debe permitir múltiples roles asociados a una misma persona, en distintos tenants incluso.

---

## 4. Arquitectura modular y modelo de paquetes

### 4.1 Concepto de "paquete"

Un **paquete de funcionalidad** es una unidad comercial y técnica que agrupa:
- Un conjunto de módulos/funcionalidades.
- Permisos y roles habilitados.
- Entidades de datos asociadas.
- Workflows específicos.

El sistema debe permitir:
1. Definir catálogo de paquetes (Core + Add-ons).
2. Activar/desactivar paquetes por tenant (inmobiliaria).
3. Controlar acceso a funcionalidades vía feature flags ligados al paquete contratado.
4. Medir uso por paquete (para modelos de precio por consumo, si aplica).

### 4.2 Paquetes propuestos (catálogo inicial)

| Paquete | Incluye | Dependencias |
|---|---|---|
| **Core (obligatorio)** | Gestión de usuarios/roles, propiedades (ficha básica), clientes, autenticación, notificaciones | — |
| **Inventarios y Manejo de Inmuebles** | Inventario fotográfico, checklist de estado, firma digital, comparación de entrega/salida | Core |
| **Gestión de Contratos** *(en MVP)* | Templates en 3 ámbitos (común/propiedad/inquilino), generación asistida, firma electrónica, digitalización de contratos físicos, renovaciones, alertas de vencimiento (ver sección 13) | Core |
| **Conciliación de Pagos** | **Carga de archivos de pagos generados por sistemas externos (banco/contabilidad), conciliación asistida, estado de cuenta, alertas de mora y reportes al propietario.** El sistema **no** procesa pagos ni emite recibos (ver sección 15) | Core, Contratos (recomendado) |
| **Mantenimiento e Incidencias** | Tickets de mantenimiento, **autogestión de reclamos/reparaciones por inquilinos y propietarios**, seguimiento de estado, asignación a proveedores, SLA (ver 6.5) | Core |
| **CRM / Prospección** | Pipeline de clientes potenciales, seguimiento comercial, matching propiedad-cliente | Core |
| **Portal de Propietarios** | Reportes financieros, estado de propiedad, aprobaciones, **visibilidad de reclamos de sus inmuebles** | Core |
| **Integración Web / Portales Embebibles** | Embebido del portal de inquilino/propietario en el WordPress de la inmobiliaria (widget + SSO), CORS por dominio, theming white-label (ver 6.6) | Core, Portal de Propietarios y/o Mantenimiento |
| **Asistente Conversacional (Chatbot IA)** | Chatbot multi-canal (WhatsApp + web) para asesores, propietarios, inquilinos y prospectos: consultas, acciones de bajo riesgo, notificaciones proactivas y escalamiento a humano (ver sección 14) | Core (expone solo capacidades de los paquetes activos) |
| **Reportes y Analítica** | Dashboards, KPIs de ocupación, rotación, morosidad | Core (usa datos de otros paquetes activos) |

### 4.3 Requerimientos técnicos de la arquitectura modular

- **RF-A1**: El sistema debe registrar qué paquetes están activos por tenant y validar accesos en backend (no solo ocultar en frontend).
- **RF-A2**: Debe existir un panel de "Marketplace/Configuración de paquetes" donde el Admin Inmobiliaria vea qué tiene activo y qué puede solicitar.
- **RF-A3**: Los módulos deben desarrollarse desacoplados (arquitectura orientada a módulos o microservicios/monolito modular) para poder activarse/desactivarse sin afectar el core.
- **RF-A4**: El motor de workflows debe ser genérico y reutilizable entre módulos (no un workflow hardcodeado por funcionalidad).
- **RF-A5**: Debe soportar versionado de paquetes (ej. Inventarios v1 vs v2) sin romper tenants que usan versiones anteriores.

---

## 5. Motor de Workflows (transversal)

El sistema requiere un **motor de flujos de trabajo configurable**, dado que múltiples módulos (inventarios, contratos, cobranza, mantenimiento) son procesos con estados y actores.

### 5.1 Requerimientos

- **RF-W1**: Modelar procesos como máquinas de estado (estado → transición → estado), con condiciones y responsables por transición.
- **RF-W2**: Permitir que el Admin Inmobiliaria personalice ciertos pasos del workflow dentro de límites definidos por el paquete (ej. agregar un paso de "revisión de mantenimiento" antes de cerrar un inventario).
- **RF-W3**: Cada transición debe poder disparar notificaciones (email, push, WhatsApp/SMS si aplica).
- **RF-W4**: Debe quedar auditoría completa (quién hizo qué, cuándo) de cada transición de estado.
- **RF-W5**: Los workflows deben soportar pasos con intervención humana (aprobaciones, firmas) y pasos automáticos.

### 5.2 Ejemplo de workflow: Entrega de inmueble (ligado al módulo Inventarios)

```
[Programación de visita] 
    → [Generación de inventario por empleado] 
        → [Envío de link al inquilino] 
            → [Revisión del inquilino] 
                → (¿Hay observaciones?)
                    → Sí → [Negociación / ajuste de inventario] → [Revisión del inquilino]
                    → No → [Acuerdo alcanzado]
                        → [Firma digital ambas partes]
                            → [Generación de documento final PDF]
                                → [Almacenamiento como anexo del contrato]
                                    → [Cierre del proceso]
```

---

## 6. Requerimientos funcionales generales del sistema

### 6.1 Gestión de propiedades — "Hoja de vida del inmueble" (Core)

La ficha de propiedad es un **expediente completo** (single source of truth), no un registro básico. Detalle del proceso de ingreso y del ciclo de vida en la **sección 12**.

- **RF-P1**: CRUD de propiedades con **hoja de vida** organizada en grupos de datos:
  - *Identificación*: dirección, tipo, área, matrícula inmobiliaria, estrato, # parqueaderos/depósitos, fotos.
  - *Comercial*: **canon**, **valor de administración**, si el canon incluye o no la administración, incremento anual pactado.
  - *Administración (PH)*: nombre del edificio/conjunto y **datos de contacto de la administración** (persona, teléfono, correo).
  - *Contable*: **cuenta bancaria destino del canon** (por defecto la del propietario, con override por propiedad — ver RF-C5), datos de retención en la fuente si aplica.
  - *Estado del ciclo de vida*: ver RF-P4.
- **RF-P2**: Asociación propiedad ↔ propietario(s) ↔ contratos ↔ inquilino actual.
- **RF-P3**: Historial de ocupación de la propiedad (línea de tiempo de arrendatarios) y **repositorio documental** por propiedad, incluyendo la **digitalización de contratos físicos** existentes (escaneo + metadatos) — ver sección 13.4.
- **RF-P4**: Cada propiedad tiene un **estado de ciclo de vida** gobernado por el motor de workflows (RF-W1): `Disponible/Vacante` → `En checkeo/estudio` → `Con aseguradora/afianzadora` → `Arrendada` → `En desocupación` → (vuelve a checkeo) → `Disponible`, con salida a `Inactiva/Retirada`. Ver detalle en sección 12.2.
- **RF-P5**: **Dashboard de propiedades** que permite ver de un vistazo cuántas están en cada estado (vacantes, en checkeo, con aseguradora, arrendadas, en desocupación), con filtros y tiempos en cada estado. Ver sección 12.3.

### 6.2 Gestión de clientes y usuarios (Core)
- **RF-C1**: Registro de clientes (prospectos, propietarios, inquilinos) con datos de contacto y documentos de identidad.
- **RF-C2**: Un mismo usuario puede tener múltiples roles/relaciones con distintas propiedades a lo largo del tiempo.
- **RF-C3**: Control de acceso basado en roles (RBAC) + scoping por tenant.
- **RF-C4** (datos del inquilino): Al crear un inquilino se capturan, como mínimo: nombre completo, documento de identidad, **correo**, **celular** y **medio preferido de contacto** (correo / SMS / WhatsApp / llamada), este último usado por el motor de notificaciones (RF-N1). Opcionalmente: codeudor/coarrendatario (ligado a la firma) y referencias.
- **RF-C5** (hoja de vida del propietario): Ficha de propietario con datos personales/contacto, **datos bancarios para el giro del canon** (cuenta por defecto a nivel de propietario, **sobrescribible por propiedad**), datos fiscales (retención/certificados) y lista de sus propiedades con el estado de cada una.
- **RF-C6** (crear si no existe): Los flujos de ingreso de propiedad y de arrendamiento deben permitir **crear el propietario o el inquilino en línea** si aún no existen en el sistema, sin salir del flujo (ver sección 12.1).

### 6.3 Autenticación y acceso
- **RF-AU1**: Login para usuarios internos (empleados/admin) vía cuenta con contraseña / SSO opcional.
- **RF-AU2**: Acceso de inquilinos vía **link único seguro con expiración** (para procesos como inventarios) y opcionalmente cuenta propia (portal).
- **RF-AU3**: Verificación de identidad mínima antes de firma digital (ej. OTP por email/SMS).

### 6.4 Notificaciones
- **RF-N1**: Notificaciones automáticas por email/SMS/WhatsApp en cada transición relevante del workflow.
- **RF-N2**: Recordatorios automáticos (ej. inquilino no ha revisado el inventario en X días).

### 6.5 Autogestión de reclamos y reparaciones (paquete Mantenimiento e Incidencias)

Inquilinos y propietarios deben poder gestionar sus propias solicitudes desde su portal, sin depender de llamar a la inmobiliaria. Los tickets se modelan sobre el **motor de workflows** (RF-W1) y usan **object storage** para las fotos.

- **RF-M1**: El inquilino debe poder **crear una solicitud** (reclamo o solicitud de reparación) asociada a la propiedad que ocupa, con categoría, descripción y fotos adjuntas.
- **RF-M2**: El inquilino y el propietario deben poder **consultar el estado** de sus peticiones en tiempo real (ej. Recibida → Asignada → En curso → En espera de repuesto → Resuelta → Cerrada), modelado como máquina de estados configurable.
- **RF-M3**: Cada cambio de estado debe **notificar** al solicitante por los canales configurados (RF-N1) y quedar en la **auditoría** del ticket (RF-W4).
- **RF-M4**: El solicitante debe poder **agregar comentarios y evidencia** a un ticket abierto, y **aceptar o rechazar** una reparación marcada como resuelta (reabriendo el ticket si la rechaza).
- **RF-M5**: El **propietario** debe ver los reclamos/reparaciones de **sus** propiedades y, cuando el flujo lo requiera, **aprobar costos** de una reparación antes de su ejecución (scoping por rol).
- **RF-M6**: El **empleado/admin** debe poder **asignar** el ticket a un proveedor/técnico, registrar avances y cerrar el ticket, con seguimiento de SLA.
- **RF-M7**: Todo el acceso a tickets respeta el **aislamiento por tenant y el scoping por rol** (RF-C3): el inquilino ve solo sus solicitudes; el propietario, solo las de sus inmuebles.

### 6.6 Integración con WordPress / portales embebibles (paquete Integración Web)

Las inmobiliarias suelen tener su sitio en WordPress bajo su propio dominio y marca. El sistema debe permitir que los portales de **inquilino y propietario** (autogestión, inventarios, reclamos, estado de peticiones) se ofrezcan **bajo la marca y el dominio de cada inmobiliaria**. Se adoptan **dos mecanismos complementarios**:

- **RF-INT1** (widget embebible): Se debe distribuir un **plugin de WordPress** que, mediante un *shortcode* (ej. `[portal-inquilino]`, `[portal-propietario]`), inserte el portal en una página de WordPress. El portal se compila como **web component encapsulado** para no colisionar con los estilos del tema de WordPress del tenant.
- **RF-INT2** (SSO / subdominio, fallback): Para inmobiliarias sin WordPress o que no deseen instalar el plugin, se debe ofrecer acceso al mismo portal alojado en un **subdominio** (ej. `portal.inmobiliaria.com`) con inicio de sesión unificado (SSO), evitando doble login.
- **RF-INT3** (SSO): El inquilino/propietario ya autenticado en el contexto de WordPress (o vía el link de invitación, RF-AU5) **no debe tener que volver a iniciar sesión** en el portal embebido; se resuelve con un handshake de token seguro.
- **RF-INT4** (CORS por tenant): La API debe aceptar peticiones **solo desde los dominios registrados de cada tenant** (CORS configurado por inmobiliaria), no desde orígenes arbitrarios.
- **RF-INT5** (white-label): El portal embebido debe aplicar el **theming del tenant** (logo, colores) para integrarse visualmente con el sitio de la inmobiliaria.
- **RF-INT6** (feature flag): La integración se activa/desactiva por tenant según el paquete "Integración Web" contratado (RF-A1), y expone solo los portales de los paquetes que el tenant tenga activos.

> **Nota de arquitectura:** estos requisitos refuerzan el principio **API-first** (el portal es un cliente más de la API, igual que la web interna y la PWA). Aunque la funcionalidad se entrega en Fase 3-4, las decisiones que la habilitan (API pública multi-origen, CORS por tenant, portal como componente embebible, SSO) se fijan desde el MVP para no re-arquitecturar después. Ver decisión **D7** en la sección 11.

---

## 7. Requerimientos no funcionales

| Categoría | Requerimiento |
|---|---|
| **Multi-tenancy** | Aislamiento estricto de datos entre inmobiliarias (a nivel de base de datos o esquema). |
| **Seguridad** | Cifrado en tránsito y reposo; manejo seguro de documentos firmados; cumplimiento de protección de datos personales (ej. normativa local de habeas data / GDPR si aplica a mercados objetivo). |
| **Disponibilidad** | SLA objetivo ≥ 99.5% para el servicio productivo. |
| **Escalabilidad** | Soportar crecimiento en número de tenants, propiedades y volumen de imágenes/documentos (almacenamiento tipo object storage). |
| **Auditoría** | Logs inmutables de acciones críticas (firmas, cambios de estado, accesos a documentos legales). |
| **Accesibilidad de acceso** | El flujo de inventario debe funcionar bien en móvil, dado que el inquilino probablemente lo revisa desde su celular. |
| **Legal / Valor probatorio** | Firma digital con evidencia de trazabilidad (IP, timestamp, identidad verificada) para que el documento tenga soporte legal. |
| **Internacionalización** | Preparado para múltiples países/monedas/idiomas si el producto escala regionalmente. |

---

## 8. Módulo detallado: Inventarios y Manejo de Inmuebles

Este es el módulo priorizado en la conversación inicial. Se detalla en profundidad por ser un diferenciador clave del producto.

### 8.1 Propósito

Permitir que un empleado de la inmobiliaria documente el estado físico de una propiedad (fotos + comentarios) al momento de la entrega (o devolución), y que el inquilino pueda **verificar, aceptar o dar feedback** sobre ese inventario, hasta llegar a un **acuerdo formal firmado digitalmente por ambas partes**, que queda como anexo del contrato.

### 8.2 Actores

- **Empleado/agente**: crea el inventario inicial.
- **Inquilino**: revisa, valida o reporta discrepancias.
- **Admin inmobiliaria**: supervisa, puede mediar en caso de desacuerdo.
- (Opcional) **Propietario**: puede tener visibilidad del resultado final.

### 8.3 Flujo funcional detallado

1. **Creación del inventario**
   - El empleado, desde la app (móvil o web), crea un nuevo inventario asociado a una propiedad y a un evento (entrega o devolución/checkout).
   - Por cada ambiente/zona de la propiedad (ej. "Sala", "Cocina", "Habitación 1", "Baño"), agrega:
     - Fotos (múltiples).
     - Comentarios/observaciones de estado.
     - Checklist de elementos (ej. "Pintura: Buena/Regular/Mala", "Electrodomésticos incluidos: Sí/No + estado").
   - El sistema genera un **link único** (con expiración y token seguro) para compartir con el inquilino.

2. **Envío al inquilino**
   - El link se envía por email/SMS/WhatsApp.
   - El inquilino no necesariamente requiere cuenta previa; el link lo autentica para ese proceso puntual (con verificación adicional tipo OTP).

3. **Revisión por el inquilino**
   - El inquilino visualiza cada zona/ítem con sus fotos y comentarios.
   - Por cada ítem puede: **Aceptar** o **Objetar** (con su propio comentario y opcionalmente su propia foto).
   - Puede hacerlo de forma parcial (ítem por ítem) o revisar todo el inventario y enviar feedback general.

4. **Gestión de discrepancias**
   - Si hay objeciones, el estado del inventario pasa a "En negociación".
   - El empleado ve las objeciones y puede: actualizar el ítem, agregar aclaración, o marcar como "resuelto" tras contacto con el inquilino.
   - Se reenvía al inquilino para nueva validación (iterativo hasta llegar a acuerdo).
   - Debe quedar el **historial completo de versiones** del inventario (no se sobrescribe, se versiona).

5. **Acuerdo y firma digital**
   - Cuando ambas partes están conformes, el sistema bloquea el contenido del inventario (inmutable).
   - Se genera el documento final (PDF) con:
     - Todas las zonas, ítems, fotos y comentarios finales.
     - Constancia de aceptación de ambas partes.
   - Firma digital de ambas partes (empleado/representante inmobiliaria + inquilino).
   - Se registran metadatos de firma: fecha/hora, IP, método de verificación de identidad.

6. **Cierre y almacenamiento**
   - El PDF firmado se almacena y queda vinculado como **anexo del contrato** de arrendamiento.
   - Se entrega copia descargable a ambas partes (inmobiliaria e inquilino) por email y disponible en su portal.
   - El evento queda disponible para auditoría/histórico (útil también al momento de la devolución del inmueble, para comparar estado inicial vs final).

### 8.4 Caso de uso adicional: comparación entrada vs salida

- **RF-I10**: El sistema debe permitir comparar automáticamente el inventario de entrada contra el de salida/devolución (mismo checklist estructurado), para facilitar la evaluación de daños o deducciones de depósito.

### 8.5 Requerimientos funcionales del módulo

| ID | Requerimiento |
|---|---|
| RF-I1 | Crear inventario asociado a propiedad + tipo de evento (entrega/devolución). |
| RF-I2 | Estructura configurable de zonas e ítems (checklist personalizable por tipo de propiedad). |
| RF-I3 | Carga de múltiples fotos por ítem/zona, con almacenamiento en object storage. |
| RF-I4 | Generar link único, seguro, con expiración, para acceso del inquilino sin necesidad de cuenta previa. |
| RF-I5 | Registrar aceptación/objeción por ítem, con comentario y evidencia fotográfica del inquilino. |
| RF-I6 | Versionado del inventario ante cada ronda de negociación. |
| RF-I7 | Estado del inventario visible (Borrador, Enviado, En revisión, En negociación, Acordado, Firmado, Cerrado). |
| RF-I8 | Generación automática de documento PDF consolidado del inventario final. |
| RF-I9 | Firma digital de ambas partes con evidencia de trazabilidad (timestamp, IP, verificación de identidad). |
| RF-I10 | Comparación entrada vs salida. |
| RF-I11 | Notificaciones automáticas en cada cambio de estado relevante. |
| RF-I12 | Vinculación del documento final como anexo formal del contrato de arrendamiento. |
| RF-I13 | Panel de administración para que la inmobiliaria vea todos los inventarios en curso y su estado. |
| RF-I14 | Creación del inventario en **modo offline** en la app del empleado (ver 10.2). |
| RF-I15 | Sincronización automática al recuperar conexión, con manejo de conflictos (ver 10.2). |
| RF-I16 | Indicador visual permanente de "pendiente de sincronizar" hasta confirmación del backend (ver 10.2). |
| RF-I17 | Compresión/optimización de fotos en el dispositivo antes de subir (ver 10.2). |
| RF-I18 | **Sincronización manual** disparable por el usuario (botón "Sincronizar ahora"), como red de seguridad universal y flujo primario en iOS/Safari (ver 10.2). |
| RF-I19 | Generación de un **formato de inventario en papel** desde la plantilla de la propiedad, sin imágenes, para contingencia (ver 10.5). |
| RF-I20 | Flujo de **reconstrucción digital** de un inventario levantado en papel: transcripción de notas y etiquetado de fotos sueltas a cada ítem (ver 10.5). |
| RF-I21 | **Confirmación electrónica** del inquilino sobre el documento reconstruido, con el papel firmado como evidencia de respaldo (ver 10.5). |
| RF-I22 | **Gestión de plantillas** por tenant: clonar las plantillas base del sistema y editar zonas, ítems y tipos de campo (ver 8.8). |
| RF-I23 | Ítems con **tipo de campo configurable** (estado, sí/no, sí/no+estado, conteo, selección, texto) y zonas **repetibles** e instanciables N veces (ver 8.8). |
| RF-I24 | **Libertad total del empleado en campo** para agregar, eliminar, reordenar y crear zonas/ítems al levantar un inventario; los cambios ad-hoc se guardan como snapshot del inventario y **no** alteran la plantilla del tenant (ver 8.8). |

### 8.6 User Stories del módulo de Inventarios

**Épica 1: Creación del inventario (Empleado)**

- **US-01**: Como empleado, quiero crear un inventario asociado a una propiedad y un tipo de evento (entrega/devolución), para iniciar el proceso de documentación del estado del inmueble.
  - *Criterios de aceptación*: puedo seleccionar la propiedad, el tipo de evento y la fecha; el inventario queda en estado "Borrador".
- **US-02**: Como empleado, quiero definir zonas del inmueble (sala, cocina, habitaciones, baños, etc.) usando una plantilla predefinida o creando zonas nuevas, para estructurar el inventario.
  - *Criterios de aceptación*: puedo agregar/eliminar/reordenar zonas; existe una plantilla por tipo de propiedad (apartamento, casa, local).
- **US-03**: Como empleado, quiero agregar fotos y comentarios a cada ítem/zona, para documentar el estado real del inmueble.
  - *Criterios de aceptación*: puedo subir múltiples fotos por ítem; puedo escribir observaciones de texto libre; puedo marcar un estado (Bueno/Regular/Malo) por ítem.
- **US-04**: Como empleado, quiero trabajar sin conexión a internet y que mis cambios se sincronicen después, para no depender de la señal en la propiedad.
  - *Criterios de aceptación*: la app funciona offline; veo un indicador de "pendiente de sincronizar"; al recuperar conexión se sube automáticamente.
- **US-05**: Como empleado, quiero generar y enviar un link de invitación al inquilino, para que revise el inventario.
  - *Criterios de aceptación*: si el inquilino no tiene cuenta, el link lo lleva a crear una; si ya tiene cuenta, lo lleva a iniciar sesión y ver el inventario directamente.

**Épica 2: Revisión del inquilino**

- **US-06**: Como inquilino, quiero ver cada zona e ítem del inventario con sus fotos y comentarios, para verificar que corresponden al estado real del inmueble.
  - *Criterios de aceptación*: veo todas las zonas/ítems con fotos en buena resolución (zoom disponible); veo el estado y comentario que dejó el empleado.
- **US-07**: Como inquilino, quiero aceptar u objetar cada ítem individualmente, adjuntando mi propia foto/comentario si objeto, para reportar discrepancias específicas.
  - *Criterios de aceptación*: cada ítem tiene botones "Aceptar"/"Objetar"; al objetar es obligatorio dejar un comentario; puedo adjuntar foto opcionalmente.
- **US-08**: Como inquilino, quiero recibir recordatorios si no he revisado el inventario después de cierto tiempo, para no olvidar completar el proceso.
  - *Criterios de aceptación*: recibo notificación a las 24h y 48h de inactividad (configurable).

**Épica 3: Negociación y acuerdo**

- **US-09**: Como empleado, quiero ver todas las objeciones del inquilino en un solo panel, para responder o corregir el inventario.
  - *Criterios de aceptación*: veo un listado de ítems objetados con el detalle del inquilino; puedo editar el ítem o dejar una aclaración.
- **US-10**: Como empleado o inquilino, quiero que cada ronda de cambios quede versionada, para tener trazabilidad de qué se modificó y cuándo.
  - *Criterios de aceptación*: existe un historial de versiones consultable; cada versión muestra qué cambió respecto a la anterior.
- **US-11**: Como admin de la inmobiliaria, quiero ver los inventarios que llevan mucho tiempo "en negociación", para intervenir si es necesario.
  - *Criterios de aceptación*: dashboard con inventarios filtrados por estado y tiempo transcurrido.

**Épica 4: Firma y cierre**

- **US-12**: Como inquilino, quiero firmar electrónicamente el inventario una vez estoy de acuerdo, para formalizar mi aceptación.
  - *Criterios de aceptación*: se solicita verificación (OTP); tras firmar, el inventario queda bloqueado (inmutable).
- **US-13**: Como empleado/representante de la inmobiliaria, quiero firmar también el documento final, para formalizar el acuerdo desde el lado de la inmobiliaria.
  - *Criterios de aceptación*: mi firma queda registrada con timestamp e IP; el documento pasa a estado "Firmado".
- **US-14**: Como inquilino o inmobiliaria, quiero recibir el PDF final firmado por email y verlo disponible en mi cuenta, para tener respaldo del acuerdo.
  - *Criterios de aceptación*: el PDF incluye todas las zonas, fotos, comentarios finales y evidencias de firma de ambas partes.
- **US-15**: Como admin de la inmobiliaria, quiero que el inventario firmado quede vinculado automáticamente como anexo del contrato, para tener todo centralizado.
  - *Criterios de aceptación*: desde la ficha del contrato puedo ver y descargar el inventario asociado.

**Épica 5: Comparación entrada/salida**

- **US-16**: Como empleado, quiero comparar el inventario de entrada con el de salida ítem por ítem, para identificar diferencias/daños al finalizar el arriendo.
  - *Criterios de aceptación*: vista lado a lado (o superpuesta) de fotos y estados entrada vs. salida, con diferencias resaltadas.

### 8.7 Modelo de datos preliminar (alto nivel)

**Entidades principales (transversales al sistema, contexto del módulo):**

| Entidad | Campos clave | Notas |
|---|---|---|
| **Tenant** | id, nombre_inmobiliaria, nit, plan, paquetes_activos[], fecha_creación | Raíz del aislamiento multi-tenant |
| **Property** | id, tenant_id, dirección, tipo, área, propietario_id, estado_ocupación | Ya definida en Core (sección 6.1) |
| **User** | id, nombre, email, teléfono, documento_identidad, tipo_verificación | Identidad única, puede tener varios roles |
| **UserRole** | id, user_id, tenant_id, rol [empleado/propietario/inquilino/admin], activo | Permite multi-rol y multi-tenant (RF-AU6) |
| **Contract** | id, property_id, tenant_id, inquilino_id, propietario_id, fecha_inicio, fecha_fin, estado | El inventario final se ancla aquí |

**Entidades específicas del módulo de Inventarios:**

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **Inventory** | id, property_id, tenant_id, contract_id (opcional hasta cierre), tipo_evento [entrega/devolución], estado [Borrador, Enviado, En_revisión, En_negociación, Acordado, Firmado, Cerrado], creado_por (user_id), fecha_creación, fecha_cierre | 1 propiedad → N inventarios (uno por evento/ciclo) |
| **InventoryZone** | id, inventory_id, nombre_zona, orden, plantilla_origen_id (opcional) | 1 inventario → N zonas |
| **InventoryItem** | id, zone_id, nombre_item, descripcion_empleado, estado_checklist [Bueno/Regular/Malo], creado_offline (bool), sincronizado_en | 1 zona → N ítems |
| **InventoryItemPhoto** | id, item_id, url_storage, autor [empleado/inquilino], fecha_captura, hash_archivo | Fotos como entidad propia (permite múltiples por autor) |
| **InventoryItemReview** | id, item_id, user_id (inquilino), respuesta [aceptado/objetado], comentario, fecha | Respuesta puntual del inquilino a un ítem |
| **InventoryVersion** | id, inventory_id, número_versión, snapshot_json, motivo_cambio, creado_por, fecha | Snapshot inmutable de cada ronda de negociación (US-10) |
| **InventorySignature** | id, inventory_id, firmante_user_id, rol_firmante, timestamp, ip_origen, método_verificación [OTP/otro], hash_documento_firmado | Una fila por firmante (mínimo 2: empleado + inquilino) |
| **InventoryDocument** | id, inventory_id, url_pdf, versión_documento, fecha_generación, hash_sha256 | PDF final consolidado, inmutable tras generación |
| **InventoryComparison** | id, inventory_entrada_id, inventory_salida_id, resumen_diferencias_json, generado_en | Soporta US-16 (comparación entrada/salida) |
| **OfflineSyncLog** | id, device_id, inventory_id, estado [pendiente/sincronizado/conflicto], fecha_creación_local, fecha_sync | Soporta RF-I14–RF-I17 |

**Entidades de plantilla (capa de configuración, ver 8.8):**

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **PropertyTypeTemplate** | id, tenant_id (null = plantilla base del sistema), tipo_inmueble [apartamento/casa/local/oficina/bodega/parqueadero], nombre, version, activa | 1 tenant → N plantillas; el tenant clona la base del sistema |
| **TemplateZone** | id, template_id, nombre, orden, repetible (bool), obligatoria (bool) | 1 plantilla → N zonas |
| **TemplateItem** | id, zone_id, nombre, field_type [estado/si_no/si_no_estado/conteo/seleccion/texto], opciones_json, obligatorio (bool), foto_obligatoria (bool), orden | 1 zona → N ítems |

> Al crear un inventario, la plantilla resuelta se **materializa** (copia) en `InventoryZone`/`InventoryItem` (el campo `InventoryZone.plantilla_origen_id` referencia la `TemplateZone` de origen). Cambios posteriores a la plantilla **no** afectan inventarios ya creados.

**Relaciones clave:**
- `Property (1) → (N) Inventory` — una propiedad puede tener varios inventarios a lo largo del tiempo (cada entrega/devolución).
- `Inventory (1) → (N) InventoryZone → (N) InventoryItem → (N) InventoryItemPhoto` — jerarquía de documentación.
- `InventoryItem (1) → (N) InventoryItemReview` — puede haber más de una revisión si hay rondas de negociación.
- `Inventory (1) → (N) InventoryVersion` — historial completo, nunca se sobrescribe.
- `Inventory (1) → (N) InventorySignature` — típicamente 2 (inquilino + representante inmobiliaria), extensible a más firmantes (ej. codeudor).
- `Inventory (1) → (1) InventoryDocument` (al cerrar) → se vincula a `Contract` como anexo.

### 8.8 Modelo de plantillas de inmuebles (estructura de zonas e ítems)

La plantilla es la estructura reutilizable de **zonas e ítems** que define cómo se documenta cada tipo de inmueble (RF-I2, US-02). Se reutiliza tanto en el flujo digital como en el formato de contingencia en papel (RF-I19).

> **Distinción fundamental — Plantilla ≠ Inventario.** La plantilla es el *molde*; el inventario es una *instancia* rellena de ese molde. Al crear un inventario se **copia** (materializa) la plantilla vigente a sus zonas/ítems, de modo que editar la plantilla después no altera inventarios ya en curso.

#### 8.8.1 Jerarquía

```
PropertyTypeTemplate  (una por tipo de inmueble: Apartamento, Casa, Local, Oficina/Bodega/Parqueadero)
 └─ TemplateZone       (Sala, Cocina, Habitación, Baño, Zona de ropas…)
     └─ TemplateItem   (lo que se inspecciona: Paredes, Piso, Estufa…)
         └─ field_type (cómo se evalúa) + fotos + comentario
```

Dos niveles de contenedor (zona → ítem). El ítem es la unidad mínima que el inquilino acepta u objeta (RF-I5).

#### 8.8.2 Tipos de campo del ítem (`field_type`)

| `field_type` | Uso | Ejemplo |
|---|---|---|
| **estado** | Estado cualitativo (default) | Paredes → Bueno / Regular / Malo |
| **si_no** | Presencia/inclusión | ¿Incluye cortinas? → Sí / No |
| **si_no_estado** | Presencia **+** estado si aplica | Estufa → Sí + Regular |
| **conteo** | Cantidad entregada | Juego de llaves → 3 |
| **seleccion** | Lista configurable (`opciones_json`) | Tipo de piso → Cerámica / Madera / Porcelanato |
| **texto** | Solo observación libre | Observaciones generales |

Todo ítem admite, con independencia del tipo: **fotos (0..N)**, **comentario libre**, y dos banderas configurables → `obligatorio` (exige respuesta antes de enviar) y `foto_obligatoria`.

#### 8.8.3 Atributos de zona

- **`repetible`**: la zona puede instanciarse varias veces en el inventario real (ej. "Habitación" → Habitación 1, 2, 3 según la propiedad). Evita mantener plantillas distintas por número de alcobas.
- **`obligatoria`**: zonas que siempre deben estar presentes.
- **`orden`**: orden de presentación.

#### 8.8.4 Niveles de personalización (herencia en cascada)

```
1. Plantillas base del SISTEMA  → semilla mantenida por el proveedor SaaS
        ↓ el tenant las clona
2. Plantillas del TENANT         → la inmobiliaria ajusta (añade/quita zonas e ítems)
        ↓ al crear un inventario
3. Ajuste AD-HOC por inventario  → el empleado modifica la estructura en el momento (US-02)
```

**Decisión de producto:** en el nivel 3 el empleado tiene **libertad total** en campo — puede agregar, eliminar, reordenar y crear zonas/ítems nuevos libremente (RF-I24). Estos cambios se guardan como snapshot del inventario y **no** modifican la plantilla del tenant.

#### 8.8.5 Catálogo inicial de plantillas base (semilla del sistema)

Se proveen plantillas base para: **Apartamento, Casa, Local comercial, Oficina, Bodega y Parqueadero/Garaje.** Cada tenant las clona y personaliza. Ejemplo (Apartamento):

```
Apartamento
├─ Sala (obligatoria)
│   ├─ Paredes ............... estado + foto
│   ├─ Piso .................. estado + seleccion(tipo) + foto
│   ├─ Techo ................. estado
│   ├─ Ventanas .............. si_no_estado + foto
│   └─ Iluminación ........... conteo (# lámparas) + estado
├─ Cocina (obligatoria)
│   ├─ Mesón ................. estado + foto
│   ├─ Estufa ................ si_no_estado + foto (obligatoria)
│   ├─ Lavaplatos ............ estado
│   └─ Electrodomésticos ..... texto + fotos
├─ Habitación (repetible) ← se instancia 1..N según alcobas
│   ├─ Paredes ............... estado + foto
│   ├─ Clóset ................ si_no_estado + foto
│   └─ Piso .................. estado
├─ Baño (repetible)
│   ├─ Sanitario ............. estado + foto
│   ├─ Ducha/Regadera ........ estado
│   └─ Grifería ............. estado
└─ Entrega de llaves (obligatoria)
    ├─ Llaves puerta principal ... conteo
    ├─ Control(es) parqueadero ... conteo
    └─ Tarjeta(s) acceso ......... conteo
```

Las plantillas de **Casa** (añade patio, garaje, antejardín, posibles varios pisos), **Local comercial** (área de ventas, bodega, vitrina/fachada, instalaciones eléctricas), **Oficina**, **Bodega** y **Parqueadero** siguen el mismo modelo con sus zonas propias.

### 8.9 Métricas de éxito del módulo

- Tiempo promedio desde creación de inventario hasta firma (objetivo: reducir tiempo vs proceso manual/papel).
- % de inventarios cerrados sin disputas posteriores (indicador de calidad del proceso).
- % de adopción del módulo entre inmobiliarias que tienen el paquete activo.
- Reducción de reclamos de depósito post-entrega (comparado con proceso anterior de la inmobiliaria, si hay dato baseline).

---

## 9. Roadmap sugerido (alto nivel)

| Fase | Contenido |
|---|---|
| **Fase 0** | Core: propiedades, usuarios, roles, autenticación, arquitectura multi-tenant y de paquetes |
| **Fase 1 (MVP)** | **Hoja de vida de propiedad/propietario/inquilino (secciones 6.1, 6.2, 12), dashboard de ciclo de vida de propiedades (12.3), afianzamiento con captura de póliza (12.4), Gestión de Contratos (templates + merge + firma + digitalización de físicos, sección 13)** y **Módulo Inventarios**: creación, link inquilino, aceptación/objeción simple, firma electrónica, PDF final |
| **Fase 2** | Iteración de negociación (versionado), comparación entrada/salida, contingencia en papel (10.5), notificaciones avanzadas |
| **Fase 3** | **Conciliación de Pagos (RF-PA1..PA15, sección 15)** y **Mantenimiento e Incidencias con autogestión de reclamos/reparaciones para inquilinos y propietarios (RF-M1..M7)** |
| **Fase 4** | Portal de propietarios, **integración WordPress / portales embebibles (RF-INT1..INT6)**, CRM/Prospección, Reportes y Analítica |
| **Fase 4+** | **Asistente conversacional / Chatbot IA (RF-CB1..CB15, sección 14)** — multi-canal WhatsApp + web, para asesores, propietarios, inquilinos y prospectos |

> **Nota:** aunque Mantenimiento y la integración WordPress se entregan en Fase 3-4, las bases de arquitectura que las habilitan (motor de workflows genérico, API-first multi-origen, CORS por tenant, portal como componente embebible — ver sección 11, D3 y D7) se establecen desde el MVP para no re-arquitecturar más adelante.
>
> **Nota sobre el MVP ampliado:** por decisión de producto, la Fase 1 incluye ahora hoja de vida, dashboard de estados y Gestión de Contratos además de Inventarios. Es un MVP más grande; se recomienda **secuenciar internamente** la Fase 1 (p. ej. 1a: Core + hoja de vida + dashboard; 1b: Inventarios; 1c: Contratos + firma) para poder entregar valor incremental y validar con inmobiliarias piloto sin esperar a todo el bloque.

---

## 10. Decisiones de producto (actualizado tras revisión con stakeholders)

| # | Tema | Decisión |
|---|---|---|
| 1 | Marco legal de firma | **Colombia**, ver sección 10.1 — se usará firma electrónica amparada en la Ley 527 de 1999, no firma digital certificada. |
| 2 | Modelo de precios de paquetes | **Por definir.** Queda abierto (fijo por módulo / por número de propiedades / híbrido) — pendiente de análisis comercial. |
| 3 | Soporte offline para el empleado en campo | **Aprobado.** Se incluye como requerimiento (ver 10.2). |
| 4 | Jurisdicción objetivo | **Colombia, único mercado inicial.** El sistema no necesita, por ahora, soportar múltiples marcos legales/jurisdicciones. |
| 5 | Acceso del inquilino | **Cuenta persistente**, no solo link temporal por evento (ver 10.3). |

### 10.1 Marco legal en Colombia para firma electrónica de inventarios y documentos

La normativa colombiana relevante para que el documento de inventario (y otros documentos del sistema, como contratos) tenga validez jurídica y valor probatorio es:

- **Ley 527 de 1999**: norma base que regula mensajes de datos, comercio electrónico y firmas electrónicas/digitales en Colombia, recogiendo los principios de la Ley Modelo de Comercio Electrónico de la CNUDMI/UNCITRAL. Establece las condiciones para que los documentos electrónicos sean válidos jurídicamente y tengan eficacia probatoria.
- **Decreto 2364 de 2012**: reglamenta el uso de la firma electrónica en Colombia y establece los criterios para determinar la confiabilidad de un mecanismo de firma electrónica, incluyendo mecanismos como códigos, contraseñas, datos biométricos o claves criptográficas.
- **Sentencia C-662/2000**: la Corte Constitucional declaró exequible (constitucional) la Ley 527 de 1999, dando respaldo jurisprudencial sólido al marco de firma electrónica.
- **Sentencia del 1 de octubre de 2020, Tribunal Superior de Bogotá D.C.**: sostiene la validez probatoria de documentos/títulos electrónicos, reforzando que documentos electrónicos pueden tener plena fuerza probatoria si cumplen los requisitos de la ley.
- **Ley 1581 de 2012 y Decreto 1377 de 2013** (protección de datos personales): aplican de forma transversal porque el sistema maneja datos personales de inquilinos, propietarios y clientes (nombre, identificación, fotos, contacto). Se requiere autorización expresa de tratamiento de datos y política de privacidad conforme a esta ley.

**Distinción clave — Firma electrónica vs. Firma digital (relevante para arquitectura):**
- **Firma electrónica** (la que aplica a nuestro caso de uso): cualquier mecanismo confiable de identificación (contraseña, OTP, biometría, clic de aceptación con evidencia) asociado a un mensaje de datos. No requiere una Entidad de Certificación Digital acreditada. Es suficiente para la mayoría de contratos civiles/comerciales como arrendamiento e inventarios, si el mecanismo es "confiable y apropiado" para el propósito (criterio de la Ley 527 y el Decreto 2364/2012).
- **Firma digital** (más exigente): basada en criptografía asimétrica y emitida por una Entidad de Certificación Digital acreditada por el Organismo Nacional de Acreditación de Colombia (regulada también por el Decreto 333 de 2014). Da mayor fuerza probatoria (presunción de autenticidad más fuerte), pero implica costo/integración con un proveedor certificado (ej. Camerfirma, DigiCert vía un partner local, Certicámara).

**Recomendación para el módulo de Inventarios:**
- Para el MVP, una **firma electrónica simple con buena trazabilidad** (verificación de identidad vía OTP, registro de IP, timestamp, hash del documento, aceptación explícita) debería ser jurídicamente suficiente en Colombia para el caso de uso de inventarios de entrega, dado que no es un título valor ni requiere las formalidades más estrictas.
- Para el **contrato de arrendamiento en sí** (no solo el inventario), es recomendable evaluar con un abogado si conviene subir el estándar a **firma digital certificada** (mayor fuerza probatoria ante eventuales disputas o procesos judiciales/de restitución de inmueble), dado el mayor valor económico y legal en juego.
- En cualquier caso, el sistema debe:
  - Guardar el **hash del documento** en el momento de la firma (integridad).
  - Registrar **evidencia de identidad** (mínimo OTP por email/SMS; idealmente validación contra un documento de identidad).
  - Dejar **constancia de consentimiento expreso** de ambas partes para usar medios electrónicos (aceptación de términos al inicio del proceso), conforme al principio de equivalencia funcional.
  - Cumplir con **Ley 1581 de 2012** en cuanto a autorización de tratamiento de datos personales (especialmente fotos y documentos de identidad).

> Nota: este análisis es una guía de producto, no un concepto legal formal. Se recomienda validación final con un abogado especializado en derecho digital/TIC en Colombia antes de lanzar el módulo a producción, especialmente para definir si se requiere o no upgrade a firma digital certificada para el contrato principal.

### 10.2 Requerimiento de soporte offline (empleado en campo)

Dado que el levantamiento del inventario ocurre físicamente en la propiedad (que puede tener mala conectividad), se aprueba como requerimiento:

- **RF-I14**: La app del empleado debe permitir crear el inventario (fotos, comentarios, checklist) en **modo offline**, almacenando localmente en el dispositivo.
- **RF-I15**: Sincronización automática con el backend cuando se recupere la conexión, con manejo de conflictos (ej. si se editó el mismo inventario desde otro dispositivo).
- **RF-I16**: Indicador visual claro de "pendiente de sincronizar" para que el empleado sepa que el inventario aún no quedó respaldado en la nube.
- **RF-I17**: Las fotos deben comprimirse/optimizarse localmente antes de subir, para minimizar consumo de datos en zonas de baja conectividad.
- **RF-I18**: La app debe ofrecer un botón de **sincronización manual** ("Sincronizar ahora") siempre visible mientras haya inventarios pendientes. La misma función de sync se dispara desde tres gatillos: (1) evento de reconexión, (2) apertura de la app, (3) el botón manual.

**Nota técnica sobre offline en PWA (ver decisión de stack, sección 11).** La capa offline se implementa con **Service Worker + IndexedDB + Background Sync**:

- En **Android**, el Background Sync sube automáticamente al recuperar señal, incluso con la app cerrada.
- En **iOS/Safari**, el Background Sync es poco confiable y el navegador puede purgar IndexedDB por espacio. Por eso la **sincronización manual (RF-I18) es el mecanismo primario en iOS**: mientras la app está abierta y en primer plano, la subida funciona sin restricciones. El botón manual convierte una operación de segundo plano (frágil en iOS) en una de primer plano (robusta en todas las plataformas).
- Salvaguardas de UX obligatorias: un inventario solo se marca "sincronizado" cuando el backend **responde OK** (nunca antes); indicador permanente de pendientes; aviso al intentar cerrar la app con inventarios sin respaldar; solicitud de `navigator.storage.persist()` para reducir el riesgo de purga.
- La lógica de la capa offline (cola local + resolución de conflictos) se diseña de forma **portable**, de modo que una eventual migración a app nativa (React Native) reutilice el mismo modelo de sincronización.

### 10.3 Requerimiento de cuenta persistente para el inquilino

Se actualiza el módulo de acceso (sección 6.3) con la siguiente decisión:

- **RF-AU2 (actualizado)**: El inquilino debe **crear/tener una cuenta persistente** en el sistema (registro con email/teléfono + verificación), en lugar de acceder únicamente vía link temporal por evento.
- **RF-AU4**: Desde su cuenta, el inquilino debe poder ver el histórico completo de: inventarios (entrega y devolución), contratos firmados, notificaciones y (si el paquete correspondiente está activo) estado de pagos y tickets de mantenimiento.
- **RF-AU5**: El primer acceso puede iniciar mediante un link de invitación (enviado por el empleado al crear el inventario), pero ese link debe llevar a un flujo de **creación de cuenta**, no a un acceso anónimo de una sola vez.
- **RF-AU6**: Debe soportarse el caso de un inquilino que tiene relación con **más de una inmobiliaria** (distintos tenants) — su cuenta de identidad puede ser única, pero con acceso segmentado por tenant.

### 10.5 Modelo de contingencia de campo: formato en papel co-diligenciado

Como respaldo ante fallos totales del dispositivo (batería agotada, app no carga, cero conectividad prolongada) y como **modo de operación primario opcional** para inmobiliarias que prefieren el levantamiento presencial en papel, se define el siguiente flujo:

**Concepto.** Un **formato de inventario en papel** (una tabla estructurada, **sin imágenes**), generado desde la misma plantilla de zonas/ítems que usa el flujo digital (RF-I2). El agente que entrega el inmueble y el inquilino que lo recibe lo diligencian **juntos, en el sitio**, cada uno con su columna de notas, y lo firman a mano. Las fotos las toma el agente con el celular en modo *best effort* (sueltas, si puede). Posteriormente, en oficina, se reconstruye el reporte digital completo asociando esas fotos y transcribiendo las notas, y se envía al inquilino/propietario para confirmación electrónica.

**Flujo:**

```
FORMATO BACKUP (pre-generado, con señal, antes de ir a campo)
  El sistema genera un PDF de inventario en blanco desde la plantilla del inmueble:
    - datos de la propiedad y contrato pre-impresos
    - tabla zonas → ítems → estado (Bueno/Regular/Malo)
    - columnas separadas para NOTAS DEL AGENTE y NOTAS DEL INQUILINO
    - espacios para firma manuscrita de ambas partes
    - un ID/QR que vincula el papel con un inventario ya creado en estado "Borrador"

EN CAMPO (agente + inquilino presentes)
  Ambos diligencian la tabla a mano; cada parte deja sus observaciones.
  Firman el papel en el sitio (acuerdo presencial).
  El agente toma fotos con el celular si puede (no bloquea el cierre del acuerdo).

DESPUÉS (en oficina, con las fotos ya en el celular)
  Se retoma el borrador por su ID/QR (no se crea uno nuevo).
  Se transcriben las notas de ambas partes y se etiquetan las fotos sueltas a cada ítem.
  Se adjunta el escaneo del papel firmado como evidencia.
  Se genera el documento digital final y se envía al inquilino para CONFIRMACIÓN electrónica.
```

**Ventajas de este modelo (por qué es preferible al 100% digital en sitio):**
- **Colapsa la negociación en una sola sesión presencial:** ambas partes dejan sus notas al mismo tiempo, cara a cara, en lugar de rondas asíncronas (`En_revisión` → `En_negociación` → reenvío). El paso digital posterior pasa de ser negociación a ser **confirmación**.
- **El papel co-firmado ya es evidencia con peso probatorio** (Ley 527 no exige medio electrónico; un documento firmado por ambas partes vale). La firma/confirmación electrónica posterior **formaliza y digitaliza** un acuerdo que ya existe, no lo sustituye.
- **Desacopla las fotos del acto legal:** el acuerdo (tabla + firmas) se completa aunque el celular falle; las fotos entran después como soporte visual, no como condición para cerrar.

**Requerimientos derivados:**
- **RF-I19**: El sistema debe generar un **formato de inventario en papel** (PDF imprimible) desde la plantilla del tipo de inmueble, pre-poblado con datos de la propiedad/contrato, con columnas de notas para agente e inquilino, espacio de firma manuscrita y un ID/QR de vínculo con un borrador ya creado en el sistema. Sin imágenes.
- **RF-I20**: El sistema debe ofrecer un flujo de **reconstrucción digital**: escanear el QR (o buscar por ID) para retomar el borrador, transcribir las notas de ambas partes, **etiquetar las fotos sueltas del celular a cada zona/ítem**, y adjuntar el escaneo del papel firmado como evidencia.
- **RF-I21**: El documento digital reconstruido se envía al inquilino para una **confirmación electrónica** (no una re-firma completa): el inquilino confirma con OTP que el reporte digital corresponde al inventario que firmó en papel. Se registran timestamp, IP y método de verificación; el escaneo del papel firmado queda como evidencia de respaldo.

**Restricciones de diseño:**
- El formato en papel **no** es un documento aparte: se genera desde el **mismo modelo de datos y la misma plantilla de zonas/ítems** (RF-I2) que el flujo digital, para que la transcripción posterior sea campo-a-campo. Un solo modelo, dos representaciones (papel sin fotos / digital con fotos).
- El etiquetado de fotos → ítem es un **paso manual de oficina** que debe existir en la app (las fotos nacen sueltas, no dentro del ítem como en el flujo ideal).

**Alcance:** RF-I19–RF-I21 se contemplan para **Fase 2**. En Fase 1 (MVP) la red de seguridad de campo es la capa offline (IndexedDB + sincronización manual RF-I18), que cubre la mayoría de los fallos. El formato en papel atiende el fallo catastrófico del dispositivo y habilita el modo presencial para inmobiliarias que lo prefieran.

### 10.4 Pendiente

- Modelo de precios de los paquetes (punto 2) sigue **por definir** — requiere análisis comercial/financiero separado antes de cerrarse.
- Relación jurídica exacta entre la firma manuscrita en papel y la confirmación electrónica posterior (RF-I21) — validar con abogado especializado (ver 10.1).

---

## 11. Decisiones de arquitectura y stack tecnológico

Esta sección fija las decisiones técnicas transversales tomadas para el MVP. El criterio rector es: **TypeScript de punta a punta**, **self-host en infraestructura propia (ZimaOS)** sin dependencias cloud de pago, y aislamiento multi-tenant forzado por el motor de base de datos.

### 11.1 Decisiones estructurales

| # | Decisión | Elección | Justificación |
|---|---|---|---|
| **D1** | Estilo de arquitectura | **Monolito modular** (no microservicios) | Un solo deploy, fronteras de módulo claras. Los "paquetes" comerciales (sección 4) se implementan como **módulos con feature flags**, no como servicios separados. Evita el costo operativo de microservicios en Fase 0–1. |
| **D2** | Multi-tenancy | **BD compartida + Row-Level Security (RLS) de PostgreSQL por `tenant_id`** | El aislamiento lo fuerza el motor, no el ORM (RF-A1, NFR de aislamiento). Escala a miles de tenants sin migraciones N veces. |
| **D3** | Motor de workflows | **Máquina de estados dirigida por datos** (tablas de definición + instancias + log de transiciones) | Estados/transiciones/responsables son datos configurables por tenant/paquete (RF-W1..W5). Para el MVP se construye propio y simple; se evita adoptar motores pesados (Temporal/Camunda) hasta que la complejidad lo justifique. |
| **D4** | Firma electrónica | **Implementación propia** (OTP + IP + timestamp + hash SHA-256 + consentimiento), Ley 527 | Sin dependencia de un tercero certificado en Fase 1 (ver 10.1). Se deja una **interfaz de firma abstracta** para enchufar un proveedor certificado (Certicámara/similar) para el contrato principal más adelante. |
| **D5** | App de campo del empleado | **PWA offline** (Service Worker + IndexedDB + Background Sync + sync manual RF-I18) | Un solo código base con la web, sin app store. Cubre offline en Android nativamente y en iOS vía sincronización manual (ver 10.2). Capa de sync portable a React Native si el piloto lo exige. |
| **D6** | Almacenamiento de fotos/PDF | **Object storage S3-compatible** | Fotos y documentos **nunca** en la BD (RF-I3, NFR escalabilidad). URLs firmadas con expiración para el acceso del inquilino. |
| **D7** | Distribución de portales / integración WordPress | **API-first + widget embebible (web component) *y* SSO a subdominio** | Los portales de inquilino/propietario se embeben en el WordPress del tenant vía plugin/shortcode (RF-INT1) y, como fallback, se sirven en un subdominio con SSO (RF-INT2). Exige API pública multi-origen con **CORS por dominio de tenant** (RF-INT4) y theming white-label (RF-INT5). Estas bases se fijan desde el MVP aunque la entrega sea Fase 3-4. |
| **D8** | Asistente conversacional (chatbot) | **Cliente de la API con herramientas acotadas (tool use) + RAG documental; nunca acceso directo a BD** | El asistente consulta estado en vivo llamando a la API con la **identidad y permisos del usuario** (RBAC + RLS), no con credenciales amplias (RF-CB10). Las salvaguardas son arquitectónicas, no basadas en el prompt (RF-CB11). Entrega en Fase 4+, pero la API-first con scope por usuario y la auditoría se fijan desde el MVP. Ver sección 14. |
| **D9** | Pagos y conciliación | **El sistema NO procesa pagos — los refleja.** Ingesta por archivo, con interpretación asistida por IA y confirmación humana | La facturación y el recaudo viven en herramientas externas. Se diseña **agnóstico al formato** (modelo canónico + motor de conciliación estables; solo la capa de interpretación depende del formato). La IA infiere la estructura del archivo pero **no transcribe importes** — el código los parsea de forma determinista — y ningún pago se concilia sin confirmación humana. Ver sección 15. |
| **D10** | Estrategia de pruebas | **Determinista para el sistema; evals para la IA — nunca al revés** | Los invariantes de seguridad (aislamiento, RBAC) se prueban con tests deterministas contra una BD real (Testcontainers), **nunca** con juicio de un modelo. Las funciones de IA se evalúan con herramientas self-hosted y agnósticas de proveedor (Promptfoo + Langfuse), incluyendo red-teaming de *prompt injection* (RF-CB11). Ver sección 16. |

### 11.2 Stack tecnológico

| Capa | Tecnología | Notas |
|---|---|---|
| **Backend** | **NestJS (TypeScript)** | Monolito modular; cada paquete comercial = módulo con feature flag validado en backend (RF-A1). |
| **Base de datos** | **PostgreSQL + Row-Level Security** | Aislamiento por `tenant_id`; JSONB para `snapshot_json` de versiones (RF-I6) y definiciones de workflow configurables (RF-W2). |
| **ORM / migraciones** | Prisma o Drizzle *(a confirmar)* | Migraciones versionadas obligatorias; validadas por el proceso de revisión. |
| **Frontend web** | **React + TypeScript** | Paneles: super admin, admin inmobiliaria, empleado, portal propietario, portal inquilino. |
| **App de campo** | **PWA** (misma base React) | Offline-first; ver D5 y sección 10.2. |
| **Object storage** | **MinIO** (self-host en ZimaOS) | S3-compatible; sustituible por S3/GCS si se migra a cloud. |
| **Generación de PDF** | **Puppeteer** (server-side, HTML→PDF) | Documento final inmutable con hash SHA-256 (RF-I8, RF-I9). Mismo generador para el formato en papel de contingencia (RF-I19). |
| **Cola / jobs** | **BullMQ (Redis)** | Notificaciones asíncronas (RF-N1), procesamiento de sync, generación de PDF fuera del request. |
| **Notificaciones** | Proveedores email / SMS / WhatsApp *(a integrar)* | Desacoplados vía cola. |
| **Auth** | **JWT + RBAC propio** con scoping por tenant | Identidad única multi-tenant (RF-AU6); primer acceso del inquilino vía link de invitación → creación de cuenta persistente (RF-AU2, RF-AU5). |
| **Orquestación** | **Docker Compose** en ZimaOS | Todo self-hostable, sin costos cloud recurrentes. |
| **Pruebas** | **Vitest, Supertest, Testcontainers, Playwright** | Testcontainers es obligatorio para probar RLS contra un Postgres real; Playwright valida el flujo offline de la PWA. Ver sección 16. |
| **Evals de IA** | **Promptfoo** (+ **Langfuse**) | Self-hosted y agnósticos de proveedor; incluyen red-teaming de *prompt injection* (RF-CB11). |
| **CI** | **Gitea Actions / Forgejo** (self-hosted) | Coherente con la infraestructura propia; sin dependencias externas. |

### 11.3 Invariantes de seguridad (no negociables, validados en cada entrega)

Estos no son features sueltas sino **invariantes** que deben verificarse al cerrar cualquier funcionalidad:

- **Aislamiento de tenant**: todo acceso a datos filtra por `tenant_id` vía RLS; ningún endpoint expone datos de otro tenant (RF-A1, RF-C3).
- **RBAC validado en backend**, no solo ocultado en frontend (RF-A1).
- **Auditoría inmutable** de acciones críticas: firmas, cambios de estado de workflow, accesos a documentos legales (RF-W4, NFR auditoría).
- **Integridad de documentos**: hash SHA-256 registrado en el momento de firma; los inventarios firmados quedan inmutables (RF-I8, RF-I9).
- **Protección de datos personales** (Ley 1581 de 2012): consentimiento expreso de tratamiento; manejo seguro de fotos y documentos de identidad.

### 11.4 Pendientes técnicos de esta sección

- ORM definitivo: **Prisma vs Drizzle** (D2/11.2).
- Proveedores concretos de email/SMS/WhatsApp.
- Estrategia de resolución de conflictos de sync offline (last-write-wins vs merge por ítem).

---

## 12. Ingreso de propiedad y ciclo de vida (dashboard)

Esta sección modela cómo entra una propiedad al sistema y cómo se sigue su estado. Es un objetivo central del producto: que la propiedad y el propietario tengan una **"hoja de vida"** en un **único sistema de verdad**, y que arrendar sea después un proceso muy simple.

### 12.1 Workflow de ingreso de una propiedad

```
INGRESO DE PROPIEDAD
  ¿El propietario ya existe? → No: crear ficha de propietario (RF-C5, RF-C6) · Sí: asociar
  Registrar hoja de vida del inmueble (RF-P1: canon, administración, cuenta, etc.)
  Generar y validar el TEMPLATE de contrato de la propiedad (sección 13)
  │
  ├─ ESCENARIO A — Propiedad VACANTE (nueva al sistema)
  │     → estado "Disponible", lista para arrendar
  │
  └─ ESCENARIO B — Propiedad YA ARRENDADA (migración de contrato físico)
        ¿El inquilino actual existe? → No: crearlo (RF-C4, RF-C6)
        Digitalizar el contrato físico vigente (sección 13.4)
        Asociar inquilino + contrato → estado "Arrendada"
```

- **RF-PI1**: El sistema debe soportar ambos escenarios de ingreso (propiedad vacante / propiedad ya arrendada en migración).
- **RF-PI2**: El sub-flujo "crear propietario/inquilino si no existe" debe poder ejecutarse en línea, sin abandonar el ingreso (RF-C6).
- **RF-PI3**: Al terminar el ingreso de una propiedad vacante, debe quedar su **template de contrato validado y guardado** (sección 13), de modo que arrendar después sea solo "asociar inquilino → merge → firma".

### 12.2 Ciclo de vida de la propiedad (máquina de estados)

Modelado sobre el motor de workflows (RF-W1), con auditoría de cada transición (RF-W4):

```
Disponible/Vacante → En checkeo/estudio → Con aseguradora/afianzadora → Arrendada
       ↑                                                                    │
       └──────────────── En checkeo ←────────── En desocupación ←──────────┘
                                                                     ↘ Inactiva/Retirada
```

| Estado | Significado |
|---|---|
| **Disponible / Vacante** | Ingresada, con template validado, lista para arrendar. |
| **En checkeo / estudio** | Debida diligencia: inventario de entrada (sección 8), estudio del inquilino candidato. |
| **Con aseguradora / afianzadora** | Candidato en manos de la compañía de seguro de arrendamiento (ver 12.4). |
| **Arrendada** | Ocupada con contrato vigente y firmado. |
| **En desocupación** | Proceso de entrega/checkout (inventario de salida, comparación entrada/salida RF-I10). |
| **Inactiva / Retirada** | Fuera de gestión de la inmobiliaria. |

- **RF-PI4**: Cada transición de estado queda auditada (quién, cuándo) y puede disparar notificaciones (RF-W3).

### 12.3 Dashboard de gestión

- **RF-PI5**: Dashboard que muestra las propiedades agrupadas por estado del ciclo de vida, con **conteos por estado** (cuántas vacantes, en checkeo, con aseguradora, arrendadas, en desocupación), filtros y **tiempo transcurrido** en el estado actual (para detectar propiedades estancadas).
- **RF-PI6**: Desde el dashboard se debe poder abrir la hoja de vida de cada propiedad y ejecutar la acción que corresponda a su estado (p. ej. "enviar a aseguradora", "arrendar", "iniciar desocupación").

### 12.4 Afianzamiento / seguro de arrendamiento

El estado "Con aseguradora" se modela como **paso formal** del workflow, y al resolverse se **captura la póliza** en el sistema (queda como información permanente de la propiedad/contrato).

- **RF-PI7**: Se debe registrar el envío del candidato a la aseguradora/afianzadora y el resultado (aprobado/rechazado), con fechas.
- **RF-PI8**: Cuando la aseguradora aprueba, se debe poder **subir y guardar la póliza**: aseguradora, **número de póliza**, vigencia (desde/hasta), valor/cobertura, **documento PDF de la póliza** y observaciones. Queda vinculada a la propiedad y al contrato.

**Entidad nueva:**

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **InsurancePolicy** (Póliza) | id, tenant_id, property_id, contract_id, aseguradora, numero_poliza, vigencia_desde, vigencia_hasta, valor_cobertura, url_documento_pdf, estado [en_estudio/aprobada/rechazada], observaciones | 1 propiedad/contrato → N pólizas a lo largo del tiempo |

---

## 13. Módulo: Gestión de Contratos

Paquete que digitaliza el ciclo de vida del contrato de arrendamiento. Reutiliza el **generador de PDF** (Puppeteer) y la **firma electrónica** (Ley 527) descritos para Inventarios (secciones 8 y 10.1).

### 13.1 Objetivo

Que el trabajo pesado (revisar y validar el clausulado) se haga **una sola vez al ingresar la propiedad**, dejando un template listo; y que **arrendar después sea casi un clic**: se asocia el inquilino, el sistema hace el merge y genera el contrato para firma.

### 13.2 Modelo de template en tres ámbitos

| Ámbito | Quién lo define | Cuándo | Ejemplos |
|---|---|---|---|
| **Cláusulas comunes** | La inmobiliaria (una vez) | Configuración del tenant | Clausulado legal estándar, políticas de mora, obligaciones |
| **Campos de la propiedad** | Al ingresar el inmueble | Ingreso de propiedad (sección 12.1) | Dirección, canon, administración, cuenta destino |
| **Campos del inquilino** | Al arrendar (merge final) | Momento de arrendar | Nombre, cédula, fecha inicio/fin, codeudor |

- **RF-CT1**: La inmobiliaria debe poder definir un **clausulado común** (plantilla base del tenant) con **campos variables** (merge fields) para propiedad e inquilino.
- **RF-CT2**: Al ingresar una propiedad, el sistema **propone un borrador de contrato** (clausulado común + campos de propiedad ya rellenos). El admin/agente lo **valida, ajusta y guarda** como el template de esa propiedad (RF-PI3).
- **RF-CT3** (arrendar): Al asociar un inquilino a la propiedad, el sistema hace el **merge** (template de la propiedad + datos del inquilino) y genera el **PDF del contrato** listo para firma.

### 13.3 Firma y almacenamiento

- **RF-CT4**: El contrato generado se envía a **firma electrónica** de las partes (arrendador/inmobiliaria + inquilino, y codeudor si aplica), con la misma evidencia de trazabilidad que los inventarios (OTP, IP, timestamp, hash SHA-256) — Ley 527 (sección 10.1).
- **RF-CT5**: El contrato firmado se almacena vinculado a la propiedad, al propietario y al inquilino, y queda disponible en los portales respectivos (RF-AU4).

### 13.4 Digitalización de contratos físicos existentes

Para inmobiliarias que migran su operación al sistema (Escenario B, sección 12.1):

- **RF-CT6**: Se debe poder **subir y archivar un contrato físico escaneado** con sus metadatos (partes, fechas de inicio/fin, canon, propiedad asociada), para que quede en la hoja de vida de la propiedad aunque no se haya generado dentro del sistema.
- **RF-CT7**: Un contrato digitalizado debe poder **vincularse a la propiedad, al propietario y al inquilino** igual que uno generado por el sistema, para mantener el "único sistema de verdad".

**Entidades (además de `Contract` ya definida en 8.7):**

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **ContractTemplate** | id, tenant_id, property_id (null = plantilla base del tenant), nombre, cuerpo/clausulado, merge_fields_json, version, validado_por, estado [borrador/validado] | 1 tenant → 1 base; 1 propiedad → 1 template validado |
| **ContractDocument** | id, contract_id, url_pdf, origen [generado/digitalizado], hash_sha256, fecha | 1 contrato → N documentos (versión generada, escaneo físico) |

> El campo bancario del canon (RF-P1 / RF-C5) se modela como una entidad **BankAccount** asociada por defecto al propietario y sobrescribible por propiedad.

### 13.5 Renovaciones y alertas de vencimiento

Un vencimiento no atendido a tiempo tiene consecuencias legales en Colombia, por lo que este sub-módulo es operativamente crítico.

**Marco legal aplicable (Ley 820 de 2003 — arrendamiento de vivienda urbana):**
- El contrato **se prorroga automáticamente** por un término igual si ninguna de las partes avisa en los plazos de ley. El silencio no termina el contrato.
- El canon puede incrementarse en la renovación **hasta el IPC** del año inmediatamente anterior.

Esto implica que el sistema no solo debe avisar: debe poder **calcular el nuevo canon** y dejar constancia de la gestión (o de la falta de ella).

- **RF-CT8** (alertas configurables): El **Admin Inmobiliaria** debe poder parametrizar, por tenant, **con cuántos días de antelación** desea recibir alertas de vencimiento de contrato. Debe soportar **múltiples umbrales** (ej. 90 / 60 / 30 días).
- **RF-CT9** (destinatarios y canales): Cada alerta debe poder dirigirse al **asesor asignado**, al **admin**, y opcionalmente al **propietario** y/o **inquilino**, por los canales configurados (RF-N1) y respetando el medio preferido de contacto (RF-C4).
- **RF-CT10** (panel de vencimientos): Debe existir un **panel de contratos próximos a vencer**, filtrable por rango de días y por estado de gestión (sin gestionar / en negociación / renovado / en desocupación), con el tiempo transcurrido desde la primera alerta.
- **RF-CT11** (renovación asistida): Al renovar, el sistema debe **proponer el nuevo canon** aplicando el IPC vigente (o el incremento pactado registrado en la ficha de la propiedad, RF-P1), permitir su ajuste manual, generar el **documento de prórroga** desde el template de la propiedad (RF-CT2) y enviarlo a firma electrónica (RF-CT4).
- **RF-CT12** (trazabilidad): Toda alerta emitida y toda decisión de renovación / no renovación debe quedar en la **auditoría** del contrato (quién, cuándo, qué se decidió), dado el valor probatorio del silencio bajo la Ley 820.
- **RF-CT13** (no renovación): Debe soportarse el flujo de **preaviso de terminación** en los plazos de ley, que transiciona la propiedad a `En desocupación` (sección 12.2) y dispara el inventario de salida (RF-I1).

> **Pendiente técnico:** definir la fuente del IPC (carga manual anual por el admin vs. integración con una fuente de datos del DANE). Para el MVP se recomienda carga manual con valor por defecto configurable.

### 13.6 Alcance

Por decisión de producto, la hoja de vida (Core), el dashboard de estados (sección 12), la generación de templates de contrato, la firma y la digitalización de físicos se incluyen en el **MVP (Fase 1)** — ver roadmap actualizado (sección 9).

---

## 14. Módulo: Asistente conversacional (Chatbot con IA)

Asistente conversacional multi-canal (**WhatsApp** y **web**) con acceso a la información del sistema, que sirve a **clientes internos** (asesores) y **externos** (propietarios, inquilinos y prospectos).

> **Entrega prevista: Fase 4+.** Las decisiones de arquitectura que lo habilitan (API-first, scope por usuario, auditoría) se fijan desde el MVP para no re-arquitecturar — ver **D8** en la sección 11.

### 14.1 Públicos y modos de operación

| Modo | Quién | Qué puede consultar |
|---|---|---|
| **Autenticado — asesor** | Empleado / admin | Datos operativos de su tenant, según su rol (RBAC) |
| **Autenticado — propietario** | Propietario | Solo **sus** propiedades: estado, contratos, reclamos, reportes |
| **Autenticado — inquilino** | Arrendatario | Solo **su** contrato, inventarios, pagos, tickets |
| **Público — prospecto** | Interesado sin cuenta | **Solo información pública**: disponibilidad, precios, características; puede agendar visita y alimentar el CRM |

- **RF-CB1**: El asistente debe operar en **modo autenticado** (identidad y permisos verificados) y en **modo público** (prospectos), con superficies de datos estrictamente separadas.
- **RF-CB2** (modo público): Un prospecto **nunca** debe poder acceder a datos privados de propiedades, propietarios, inquilinos o contratos. El modo público solo expone el catálogo comercial publicado por el tenant.
- **RF-CB3**: Las interacciones de prospectos deben poder registrarse como **leads en el CRM** (paquete CRM / Prospección).

### 14.2 Capacidades

**Consulta (lectura).**
- **RF-CB4**: Responder sobre estado de solicitudes de mantenimiento (RF-M2), fechas de vencimiento de contrato (13.5), historial de pagos, inventarios (sección 8), y datos de la propiedad — siempre dentro del scope del usuario.

**Acciones transaccionales (bajo riesgo, reversibles).**
- **RF-CB5**: Crear tickets de mantenimiento (RF-M1), agendar visitas, actualizar datos de contacto propios.
- **RF-CB6** (límite duro): El asistente **no puede ejecutar acciones irreversibles ni legalmente vinculantes** — firmar documentos, aprobar costos, modificar contratos, confirmar pagos o aceptar inventarios. Estas acciones **siempre** escalan a una persona.

**Notificaciones proactivas.**
- **RF-CB7**: El asistente debe poder **iniciar conversaciones** para recordar vencimientos de contrato (RF-CT8), avisar de pagos pendientes, o solicitar la revisión de un inventario pendiente (RF-I11 / US-08).
- **RF-CB8**: Las notificaciones proactivas deben respetar el **medio preferido de contacto** (RF-C4), permitir que el usuario se dé de baja, y cumplir la **Ley 1581 de 2012** en cuanto a autorización de tratamiento y comunicaciones.

> ⚠️ **Restricción de canal (WhatsApp):** la API de WhatsApp Business solo permite iniciar conversaciones mediante **plantillas pre-aprobadas** y fuera de la ventana de 24h de interacción del usuario. El diseño de RF-CB7 debe contemplar el catálogo de plantillas y sus tiempos de aprobación.

**Escalamiento.**
- **RF-CB9**: Cuando el asistente no pueda resolver, o el usuario lo solicite, debe **transferir la conversación a un asesor humano** entregando el contexto completo del hilo.

### 14.3 Invariantes de seguridad (no negociables)

Estos son los requisitos más críticos del módulo. Un asistente conversacional amplía la superficie de exposición de datos, y las salvaguardas deben ser **arquitectónicas, no basadas en el prompt**.

- **RF-CB10 (aislamiento por identidad)**: El asistente **no debe tener credenciales de acceso amplio a la base de datos**. Cada consulta se ejecuta **con la identidad y los permisos del usuario que pregunta**, atravesando el mismo RBAC y el mismo Row-Level Security por `tenant_id` que el resto del sistema (invariantes de la sección 11.3).
- **RF-CB11 (defensa por diseño ante manipulación)**: Debe asumirse que un usuario intentará manipular al asistente para obtener datos fuera de su alcance (*prompt injection*: "ignora tus instrucciones", "actúa como administrador"). **La defensa no puede ser el prompt del sistema**: las herramientas expuestas al modelo deben ser incapaces, por construcción, de devolver datos fuera del scope de la sesión autenticada.
- **RF-CB12 (auditoría)**: Toda consulta y toda acción ejecutada por el asistente debe quedar registrada en la auditoría (quién preguntó, qué datos se devolvieron, qué acción se ejecutó), igual que cualquier otro acceso a datos.
- **RF-CB13 (datos personales)**: El asistente no debe exponer ni compilar datos personales más allá de lo necesario para responder, conforme a la Ley 1581 de 2012.

### 14.4 Arquitectura

El asistente es **un cliente más de la API** (mismo principio API-first de D7) — no accede a la base de datos directamente.

- **Mecanismo principal — herramientas (tool use):** el modelo consulta el estado en vivo llamando a endpoints de la API NestJS, que aplican RBAC + RLS con la sesión del usuario. Esto cubre la mayoría de las preguntas (estado de tickets, vencimientos, pagos, inventarios), que son **datos transaccionales**, no documentales.
- **Mecanismo complementario — RAG:** búsqueda semántica sobre **documentos** (contratos, políticas, reglamentos de propiedad horizontal) para preguntas del tipo "¿qué dice mi contrato sobre X?". El índice debe respetar el mismo scope por usuario.
- **Canales:** WhatsApp Business API y widget web (reutilizable dentro del portal embebible, RF-INT1).
- **Escalamiento:** integración con la bandeja del asesor, entregando el hilo completo.

**Requerimientos derivados:**
- **RF-CB14**: Cada capacidad del asistente se implementa como una **herramienta acotada** que recibe el contexto de sesión y filtra en el backend; no se expone consulta libre a la base de datos.
- **RF-CB15**: El asistente se activa/desactiva por tenant vía feature flag del paquete contratado (RF-A1) y solo expone capacidades de los paquetes activos del tenant.

### 14.5 Pendientes técnicos

- Selección de modelo y proveedor de LLM (evaluar capacidad vs. costo por conversación; el volumen conversacional alto favorece un modelo de gama media).
- Estrategia de costos por conversación y límites de uso por tenant.
- Catálogo de plantillas de WhatsApp Business y su aprobación.
- Residencia de datos: verificar que el envío de datos personales a un proveedor de LLM externo sea compatible con la Ley 1581 de 2012 y con las autorizaciones de tratamiento obtenidas (evaluar anonimización o minimización de datos en los prompts).

---

## 15. Módulo: Conciliación de Pagos

### 15.1 Premisa y alcance

**El sistema NO gestiona pagos.** La facturación, el recaudo, la generación de recibos y la relación con el banco ocurren **fuera del sistema**, en las herramientas que ya usa cada inmobiliaria. El rol del sistema es **reflejar y conciliar** esa información para que exista un único lugar donde consultar el estado de cuenta.

Queda **explícitamente fuera de alcance**: pasarela de pagos, procesamiento de transacciones, emisión de facturas o recibos, y cualquier movimiento de dinero.

> ⚠️ **El formato del archivo de pagos es desconocido a la fecha.** Cada inmobiliaria (y cada banco) puede reportar de forma distinta. Por eso este módulo se diseña **agnóstico al formato**: la arquitectura y el flujo se definen ahora, y la interpretación del archivo se resuelve con asistencia de IA (15.3) hasta que se conozcan los formatos reales y se puedan construir adaptadores deterministas.

### 15.2 Arquitectura en tres capas

La clave del diseño es **no acoplar nada al formato del archivo**:

```
┌─ 1. INTERPRETACIÓN (asistida por IA — ver 15.3) ─────────┐
│  Recibe el archivo (CSV/Excel/TXT), infiere su           │
│  estructura y propone el mapeo de columnas               │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ 2. MODELO CANÓNICO (definido, estable) ─────────────────┐
│  PaymentRecord: fecha, valor, referencia, pagador,       │
│  cuenta destino, medio de pago                           │
└──────────────────────┬───────────────────────────────────┘
                       ▼
┌─ 3. CONCILIACIÓN (definido, estable) ────────────────────┐
│  Empareja cada registro con contrato/propiedad/inquilino │
│  Bandeja de revisión → confirmación humana → estado      │
└──────────────────────────────────────────────────────────┘
```

Las capas 2 y 3 son estables y no cambian cuando aparezca el formato real; solo se sustituye o refuerza la capa 1.

- **RF-PA1**: El sistema debe permitir la **carga de un archivo de pagos** (CSV, Excel o texto plano) generado por un sistema externo, por parte de un usuario autorizado del tenant.
- **RF-PA2**: Debe existir un **modelo canónico de registro de pago** independiente del formato de origen, con al menos: fecha del movimiento, valor, referencia/descripción, identificación del pagador, cuenta destino y medio de pago.
- **RF-PA3**: Debe soportarse que **distintos tenants usen formatos distintos** (bancos diferentes), sin cambios en el código del motor de conciliación.
- **RF-PA4** (idempotencia): La recarga del mismo archivo, o de archivos con períodos solapados, **no debe duplicar pagos**. El sistema detecta y marca duplicados.

### 15.3 Interpretación asistida por IA

Mientras no exista un formato conocido, la interpretación del archivo se apoya en IA. Esto convierte un bloqueo ("no podemos implementar hasta conocer el formato") en un flujo operativo desde el día uno.

- **RF-PA5** (inferencia de estructura): Al cargar un archivo, el sistema debe **analizar su estructura con IA** e inferir qué representa cada columna (fecha, valor, referencia, pagador, cuenta), proponiendo un mapeo al modelo canónico.
- **RF-PA6** (mapeo confirmable y reutilizable): El mapeo propuesto debe **mostrarse al asesor para su confirmación o corrección**, y poder **guardarse por tenant** para reutilizarse en cargas posteriores del mismo origen — de modo que la asistencia de IA se necesite solo la primera vez.
- **RF-PA7** (emparejamiento sugerido): Para cada registro, el sistema debe proponer el contrato/inquilino correspondiente combinando las estrategias de 15.4, e indicar **por qué** lo sugiere (referencia coincidente, nombre similar, cuenta y monto compatibles) y con **qué nivel de confianza**.
- **RF-PA8** (tabla de resultados): El resultado de cada carga debe presentarse como una tabla en tres grupos: **(a) sugeridos** — con la evidencia del emparejamiento para que el asesor verifique; **(b) sin identificar** — los que la IA no pudo asociar; **(c) pendientes** — los que requieren una decisión del asesor.

> 🔒 **Salvaguardas obligatorias (manejo de dinero):**
> - **La IA identifica la estructura; el código extrae los valores.** El modelo determina *qué columna es qué*, pero los importes y fechas se parsean de forma **determinista** desde el archivo original. El modelo **nunca** transcribe ni reescribe un valor monetario — un error de transcripción sería invisible y de alto impacto.
> - **Ningún pago se marca como conciliado sin confirmación humana.** Las sugerencias de la IA son propuestas, nunca decisiones automáticas.
> - Toda sugerencia aceptada o rechazada queda **auditada** (quién confirmó, cuándo, con qué evidencia).
> - Aplican los mismos invariantes de aislamiento por tenant y RBAC del resto del sistema (sección 11.3).

### 15.4 Estrategias de emparejamiento

Se implementan de forma combinada; ninguna concilia el 100% por sí sola.

| Estrategia | Cómo funciona | Fiabilidad |
|---|---|---|
| **Referencia única por contrato** | El sistema genera un código por contrato (ej. `ARR-00123`) que el inquilino usa al pagar | Alta — requiere que la inmobiliaria lo adopte en su proceso |
| **Cuenta destino + valor + ventana de fecha** | Usa la cuenta bancaria de la propiedad/propietario (RF-P1 / RF-C5) más monto y rango de fechas | Media |
| **Nombre del pagador (difuso)** | Compara el nombre del extracto con el inquilino registrado | Baja por sí sola; útil como señal de apoyo |
| **Manual** | El asesor asocia el registro a mano desde la bandeja | Siempre disponible como respaldo |

- **RF-PA9**: El sistema debe generar y exponer una **referencia única de pago por contrato**, para habilitar progresivamente la conciliación automática de alta fiabilidad.
- **RF-PA10** (bandeja de excepciones): Debe existir una vista donde el asesor **resuelva manualmente** los registros no emparejados, con búsqueda por inquilino, propiedad o contrato, y asociación en pocos clics.
- **RF-PA11**: El sistema debe registrar, por cada conciliación, **qué estrategia la resolvió**, para poder medir la efectividad de cada una y afinar el proceso con las inmobiliarias.

**Estados del registro de pago:** `Cargado` → `Sugerido` → `Conciliado` | `Sin identificar` | `Duplicado` | `Descartado`.

### 15.5 Uso de la información conciliada

- **RF-PA12** (estado de cuenta): El **inquilino** debe poder consultar en su portal los pagos registrados a su contrato y su estado de cuenta.
- **RF-PA13** (alertas de mora): El sistema debe identificar contratos **en mora** (canon esperado sin pago conciliado dentro del plazo) y disparar alertas al asesor, al admin y —si está configurado— al inquilino, por los canales y el medio preferido de contacto (RF-N1, RF-C4).
- **RF-PA14** (reportes al propietario): El **propietario** debe poder consultar reportes de lo recaudado en sus inmuebles (qué se pagó, cuándo, por qué contrato), integrados con el Portal de Propietarios.
- **RF-PA15**: Los datos conciliados alimentan los KPIs de **morosidad** del paquete de Reportes y Analítica.

> **Fuente de verdad:** el sistema es un **espejo** de la información de pagos, no su origen. Ante una discrepancia, prevalece el sistema contable/bancario externo. Esto debe ser explícito en la UI para evitar que un propietario o inquilino tome el dato del sistema como comprobante.

### 15.6 Entidades

| Entidad | Campos clave | Relaciones |
|---|---|---|
| **PaymentImport** | id, tenant_id, nombre_archivo, hash_archivo, formato_detectado, mapeo_aplicado_json, cargado_por, fecha_carga, total_registros, conciliados, sin_identificar | 1 tenant → N cargas |
| **PaymentRecord** | id, tenant_id, import_id, fecha_movimiento, valor, referencia_texto, pagador_texto, cuenta_destino, medio_pago, estado, contract_id (nullable), estrategia_conciliacion, confianza, conciliado_por, fecha_conciliacion | 1 carga → N registros; 1 contrato → N pagos |
| **PaymentMappingProfile** | id, tenant_id, nombre_origen, mapeo_columnas_json, activo | Mapeo reutilizable por tenant/banco (RF-PA6) |

### 15.7 Pendientes

- **Formato(s) real(es) de archivo** de las inmobiliarias piloto y sus bancos — **bloquea** la construcción de adaptadores deterministas (que sustituirían o respaldarían la inferencia por IA).
- Definir si la **referencia única de pago** (RF-PA9) es viable operativamente con las inmobiliarias, ya que exige un cambio en su proceso de recaudo.
- Reglas de negocio de mora: días de gracia, cálculo de intereses (si aplica), y si el sistema los muestra o solo señala el estado.

---

## 16. Estrategia de pruebas y calidad

Todas las herramientas son **open source y self-hosted**, coherentes con la decisión de infraestructura propia (sección 11).

### 16.1 Principio rector: dos problemas distintos

| | Qué se prueba | Cómo |
|---|---|---|
| **A. El sistema** | Aislamiento multi-tenant, RBAC, workflows, offline, firma, conciliación | **Determinista** — sin IA |
| **B. Las funciones de IA** | Chatbot (sección 14), interpretación de archivos de pago (RF-PA5) | **Evaluaciones (evals)** — con LLM |

> 🔒 **Regla dura:** los **invariantes de seguridad** (sección 11.3) — aislamiento por tenant, RBAC, auditoría, integridad de documentos — se prueban **siempre de forma determinista**. Un test que valide que un inquilino no puede ver datos de otro tenant **no puede** depender del juicio de un modelo: si el resultado es probabilístico, no es un control de seguridad. La IA se evalúa; la seguridad se prueba.

### 16.2 Pruebas del sistema (capa determinista)

| Capa | Herramienta | Justificación específica del proyecto |
|---|---|---|
| **Unitarias e integración (backend)** | **Vitest** + **Supertest** | Nativo del stack TypeScript/NestJS |
| **Base de datos real** | **Testcontainers** | **Crítico:** el Row-Level Security de PostgreSQL (D2) **no puede probarse con mocks ni con SQLite**. Se levanta un Postgres real en Docker por cada corrida |
| **E2E web y PWA** | **Playwright** | Además de E2E: simula **modo offline** y viewports móviles, validando directamente RF-I14..RF-I18 (offline, sync manual, indicador de pendientes) |
| **Frontend (componentes)** | **Vitest** + **Testing Library** | Coherente con React/TS |
| **Carga y volumen** | **k6** (opcional) | Volumen de fotos y documentos (NFR escalabilidad) |

- **RF-QA1**: Debe existir una suite de pruebas automatizadas que se ejecute en **CI self-hosted (Gitea Actions / Forgejo)** en cada cambio, y que bloquee la integración si falla.
- **RF-QA2** (aislamiento): Deben existir pruebas específicas que verifiquen, contra una base de datos real, que **ningún endpoint devuelve datos de otro tenant** y que el RLS está activo (RF-A1, RF-C3).
- **RF-QA3** (RBAC): Deben existir pruebas que verifiquen los límites de cada rol — que un inquilino no accede a datos de propietario, que un propietario solo ve sus inmuebles, etc.
- **RF-QA4** (offline): Deben existir pruebas E2E que ejerciten el flujo de campo sin conexión: crear inventario offline, verificar el indicador de pendientes, restaurar conexión y validar la sincronización (automática y manual).
- **RF-QA5** (trazabilidad): Cada requerimiento funcional debe poder mapearse a al menos una prueba que lo verifique.

### 16.3 Evaluación de las funciones de IA

Herramientas **self-hosted y agnósticas de proveedor** — se configura el endpoint y la API key del proveedor de LLM que se elija, sin acoplar el sistema a uno concreto.

**Promptfoo** — evaluación pre-despliegue, definida en YAML e integrada en CI.
- **RF-QA6**: Deben existir evaluaciones automatizadas del **asistente conversacional** que verifiquen tanto las respuestas correctas como, sobre todo, **las negativas correctas**: que no revele datos fuera del scope del usuario, que no ejecute acciones irreversibles (RF-CB6) y que el modo público no acceda a datos privados (RF-CB2).
- **RF-QA7** (red-teaming): Deben ejecutarse pruebas automáticas de **prompt injection y fuga de datos** contra el asistente, verificando **RF-CB11**. Estas pruebas se ejecutan en CI y su fallo bloquea el despliegue.
- **RF-QA8**: Deben existir evaluaciones de la **interpretación de archivos de pago** (RF-PA5): dado un archivo, verificar con **aserciones deterministas** que el mapeo de columnas inferido coincide con el esperado — no mediante juicio difuso, ya que el resultado es verificable exactamente.

**Langfuse** — observabilidad y datasets en producción.
- **RF-QA9**: Las interacciones del asistente deben poder **trazarse** (entrada, herramientas invocadas, salida, costo) para diagnóstico y control de gasto.
- **RF-QA10**: Debe ser posible **convertir conversaciones reales en casos de prueba**, alimentando un dataset de regresión que se re-ejecute al cambiar el prompt o el modelo.
- **RF-QA11**: La captura de trazas debe respetar la **Ley 1581 de 2012** — minimizar o anonimizar datos personales antes de persistirlos.

> **Nota sobre conciliación:** al no existir aún formatos reales de banco (pendiente 15.7), las evaluaciones de RF-PA5 arrancan con **archivos sintéticos** de estructuras variadas, y se enriquecen con casos reales cuando las inmobiliarias piloto los aporten.

### 16.4 Stack de pruebas — resumen

| Propósito | Herramienta | Self-hosted |
|---|---|---|
| Unitarias / integración / componentes | Vitest, Supertest, Testing Library | ✅ |
| Base de datos real (RLS) | Testcontainers | ✅ |
| E2E + PWA offline | Playwright | ✅ |
| Carga (opcional) | k6 | ✅ |
| Evals de IA + red-teaming | **Promptfoo** | ✅ (agnóstico de proveedor) |
| Observabilidad y datasets de IA | **Langfuse** | ✅ (Docker) |
| CI | **Gitea Actions / Forgejo** | ✅ |

---

*Documento generado como punto de partida para revisión con stakeholders. Se recomienda validar el modelo de paquetización y el módulo de Inventarios con usuarios reales (inmobiliarias piloto) antes de congelar el alcance del MVP.*
