# Requirements — web_admin_panels

> Feature #28. Paneles web de administración (RF-P5 dashboard, RF-I13
> panel de inventarios, RF-AU4 portales, RF-C3 RBAC). Primera feature de
> FRONTEND real de `apps/web` (hasta ahora solo el shell de healthcheck).

### R1 — (RF-AU1, #27) Login con el flujo estándar
CUANDO el usuario abre la app sin sesión, el sistema DEBE mostrar el
login (código de inmobiliaria, correo, contraseña) contra `POST
/auth/login`, guardar el refresh token en IndexedDB (nunca localStorage,
patrón #15) y DEBE rotarlo en cada 401 (refresh → reintento → logout).

### R2 — (RF-P5) Dashboard de propiedades
CUANDO el usuario autenticado entra, el sistema DEBE mostrar el dashboard
de `GET /propiedades/dashboard`: tarjetas por estado del ciclo de vida y
la lista de propiedades con su estado.

### R3 — (RF-I13) Panel de inventarios
CUANDO el usuario navega a Inventarios, el sistema DEBE listar los
inventarios con filtros (estado, tipo_evento) y mostrar la ficha de cada
uno (zonas, ítems, respuestas, fotos) con su estado visible.

### R4 — (RF-CT8..13, #19) Contratos y vencimientos
CUANDO el usuario navega a Contratos, el sistema DEBE listar los
contratos, mostrar el panel de vencimientos y DEBE permitir renovar o
no-renovar un contrato (acciones de #19) y ver sus documentos.

### R5 — (RF-C1, RF-AU4) Clientes y plantillas
CUANDO el usuario navega a Clientes o Plantillas, el sistema DEBE listar
propietarios e inquilinos y las plantillas de inventario con la acción de
clonar (#11).

### R6 — (RF-C3, C7) Seguridad del cliente
EL sistema NO DEBE guardar tokens en localStorage; el access token vive en
memoria; el refresh en IndexedDB. Los errores de la API DEBEN mostrarse
sin detalles técnicos ni datos personales.

### R7 — (D2, conventions.md) Tres estados explícitos
CADA vista que consulta la API DEBE mostrar cargando / error / listo de
forma explícita; la lógica DEBE vivir fuera de los componentes (hooks y
clientes, no fetch en el JSX).

## DECISIONES de la puerta
| Id | Decisión |
|---|---|
| PA-28-1 | Cliente API propio de `apps/web` con transporte inyectable (mismo patrón que la PWA #15); sin router: navegación por estado |
| PA-28-2 | Dependencias: solo las existentes (react, testing-library); sin librerías nuevas de UI — CSS propio mínimo |
| PA-28-3 | Las acciones de negocio (renovar, no-renovar, clonar) se exponen como botones que llaman a la API real; sin lógica de negocio en el frontend |
