# Tasks — inventory_tenant_review

> Feature #13. Pasos discretos en orden. Las tasks de test son de primera
> clase: los invariantes de seguridad (bloque 4) se verifican con asserts
> deterministas contra PostgreSQL real (Testcontainers).
>
> **Prerrequisitos:** #12, #10, #26, #27 y #5 `done`. Es la primera feature
> con rutas de CLIENTE (rol `inquilino`).
>
> **PA-13 aprobadas en la puerta del spec:** PA-13-1 (cuenta con contraseña
> + OTP), PA-13-2 (revisión de una sola ronda), PA-13-3 (OTP entregado por
> #10), PA-13-4 (4ª vía SECURITY DEFINER `invitacion_por_token`).
>
> Cobertura: R1–R13 en 24 tasks (T1–T24), de las cuales 12 son tasks de test.

---

## Bloque 0 — Tipos y esquema Drizzle

- [ ] T1 — Crear `packages/types/src/inventario-revision.ts` con
  `PropositoOtp`, `InvitacionInventario`, `CodigoOtp`,
  `RevisionItemInventario` y `RespuestaRevision`; exportar desde el index.
  **Cubre: R1, R4, R6.**

- [ ] T2 — Crear los tres esquemas Drizzle (invitacion-inventario,
  codigo-otp, inventario-item-revision) con CHECKs/UNIQUEs y exportarlos en
  `schema/index.ts`; añadir `revision_completada_en` a `inventario` y
  `revision_id` a `inventario-item-foto`. **Cubre: R1, R4, R6, R7.**

## Bloque 1 — Migración

- [ ] T3 — Escribir `0017_inventory_tenant_review.sql`: las tres tablas con
  `ENABLE`+`FORCE RLS`, los ALTERs de #12, la función
  `invitacion_por_token(hash)` SECURITY DEFINER con REVOKE PUBLIC.
  **Cubre: R1, R4, R6, R13.**

- [ ] T4 — `_journal.json`, `TABLAS_PERMITIDAS` +3, `GRANT` en
  `rol-aplicacion.ts`, y test en `migrations.db.test.ts` (las tres tablas
  con RLS, la función es SECURITY DEFINER sin PUBLIC, el inventario de
  funciones pasa a CUATRO entradas y la función resuelve por coincidencia
  exacta). **Cubre: R13, PA-13-4.**

## Bloque 2 — Invitación

- [ ] T5 — `invitaciones.repository.ts`: `insertar` (token hash), `usar`,
  `buscarPorHash` (por la función), `buscarActiva` (dentro del RLS) y
  `revisarUso`. Sin contexto → `SinContextoDeTenantError`. **Cubre: R1,
  R3, R12.**

- [ ] T6 — `invitaciones.service.ts`: `generar` (R1: 48 B, hash, 72 h;
  transiciona BORRADOR→ENVIADO y audita, R2/R11), `bootstrap` (R3: la
  función + revalidación dentro del RLS; `InvitacionInvalidaError`
  uniforme) y `consumir` (marca `usada_en`, 409 si ya usada).
  **Cubre: R1, R2, R3, R12.**

- [ ] T7 — `invitaciones.controller.ts`: `POST /inventarios/:id/invitaciones`
  (admin/empleado) y `GET /invitaciones/:token` (pública, bootstrap sin
  datos sensibles: solo nombres y estado). **Cubre: R1, R3, R9.**

## Bloque 3 — Cuenta persistente y OTP

- [ ] T8 — `otp.repository.ts`: `insertar` (hash, propósito, expira),
  `buscarPendiente` (dentro del RLS), `marcarVerificado`. **Cubre: R4, R5,
  R12.**

- [ ] T9 — `otp.service.ts`: `solicitar` (R4: genera 6 dígitos, hash,
  encola por `NotificacionesOutboxService` al canal del perfil) y
  `verificar` (R5: hash+expiración, 401 uniforme, marca usado; propósito
  `FIRMA` listo para #14). **Cubre: R4, R5, R8, R12.**

- [ ] T10 — `registro.service.ts`: `registrarDesdeInvitacion` (R3-R5:
  valida la invitación, crea la identidad con `resolverIdentidad` (#26),
  `password_hash` bcrypt, rol `inquilino`, verifica el OTP de REGISTRO y
  abre la sesión (#27)). **Cubre: R3, R4, R5.**

- [ ] T11 — Controllers de OTP y registro: `POST /invitaciones/:token/
  registro` (pública) y `POST /auth/otp/solicitar` +
  `POST /auth/otp/verificar` (autenticado). Errores `InvitacionInvalidaError`
  y `OtpInvalidoError`. **Cubre: R3-R5, R8.**

## Bloque 4 — Revisión del inquilino

- [ ] T12 — `revision-inventario.repository.ts`: `insertarRevision`
  (UNIQUE por ítem+perfil), `listarRevisiones`, `marcarCompletada` y la
  lectura del inventario por perfil (scoping R9). **Cubre: R6, R7, R9.**

- [ ] T13 — `revision-inventario.service.ts`: `revisar` (R6: 404 si el
  inventario no es del perfil, 400 si objeta sin comentario, sube la foto
  con `autor = 'INQUILINO'` y la vincula a la revisión) y `obtener` (solo
  su inventario). **Cubre: R6, R7, R9.**

- [ ] T14 — `revision-inventario.controller.ts`: `GET /inquilino/
  inventarios/:id` y `POST /inquilino/inventarios/:id/items/:idItem/
  revision` con `@Roles('inquilino')`. **Cubre: R6, R9.**

- [ ] T15 — Registrar módulos, ampliar `RUTAS_PERMITIDAS` (+7) y el fallback
  del `AuditInterceptor` si hace falta (`idItem` ya existe de #11).
  **Cubre: R13.**

## Bloque 5 — Tests de integración

- [ ] T16 — Invitación: generar → 201 con URL, inventario ENVIADO (SELECT),
  token en claro solo en la respuesta (la base guarda hash); repetir con el
  inventario ya ENVIADO → 409. **Cubre: R1, R2, R12.**

- [ ] T17 — Bootstrap: `GET /invitaciones/:token` devuelve el mínimo; token
  inexistente/expirado/usado → 401 uniforme (sin distinguir). **Cubre:
  R3.**

- [ ] T18 — Registro con OTP: solicitar OTP (la fila `codigo_otp` existe
  con hash y el outbox tiene la entrega), verificar (401 con código malo
  sin distinguir), crear la cuenta persistente (SELECT: user con hash,
  rol inquilino, perfil) y login posterior funciona (#27). **Cubre: R4, R5,
  R3.**

- [ ] T19 — Revisión: aceptar (201), objetar sin comentario → 400 sin
  escribir, objetar con comentario y foto (201, `autor = 'INQUILINO'`,
  SELECT), repetir el mismo ítem → 409/400 por UNIQUE, completar todos →
  `revision_completada_en` (SELECT). **Cubre: R6, R7.**

- [ ] T20 — Scoping (R9): un inquilino NO ve ni revisa el inventario de
  otro inquilino del MISMO tenant (404); el empleado de otro tenant →
  404; las rutas de invitación rechazan a `inquilino` (403). **Cubre:
  R9.**

## Bloque 6 — Invariantes y cierre

- [ ] T21 — `apps/api/src/database/__tests__/inventario-revision-rls.test.ts`
  (Testcontainers, rol sin `BYPASSRLS`): `SELECT *` sin `WHERE` sobre las
  tres tablas devuelve solo filas del tenant; conexión virgen → 0 filas;
  la función `invitacion_por_token` devuelve el bootstrap correcto y nada
  más; INSERT de filas del sistema no aplica (no hay). **Cubre: R9, R10,
  R12, PA-13-4.**

- [ ] T22 — Test de PII y auditoría (R11): tokens, códigos OTP y
  comentarios con valores distintivos no aparecen en `audit_log`
  (serializado completo) ni en logs; cada acción crítica tiene su fila de
  auditoría con `entity_id` correcto. **Cubre: R11, R12.**

- [ ] T23 — Escribir el mapa de trazabilidad `R1..R13 → test concreto` en
  `progress/impl_inventory_tenant_review.md`, con las decisiones PA-13 y
  la frontera #14 (OTP de FIRMA) anotada. **Cubre: trazabilidad.**

- [ ] T24 — `npm run lint`, `npm run typecheck`, `npm run test`,
  `npm run test:db` y `npm run build`; después `./init.sh` exit 0.
  **Verificación final y cierre.**
