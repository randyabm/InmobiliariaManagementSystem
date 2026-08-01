# Review — feature #27 (`sesion_y_revocacion`)

**Veredicto:** APPROVED

Revisor: agente `reviewer`. Fecha: 2026-08-01. HEAD revisado: `82dadbc`.
Árbol de trabajo limpio antes y después de la revisión (las mutaciones se
aplicaron y revirtieron con `git checkout`; `git status --short` final vacío).

Línea base ejecutada por el leader: `./init.sh` exit 0, `test` **524** (50
archivos), `test:db` **88** (3 archivos), lint y typecheck verdes. Además
ejecuté la línea base de los archivos nuevos + los de riesgo (63 tests):
**63/63 verdes**.

---

## 1. Verificación por mutación

Ejecuté **seis** mutaciones, correspondientes a los puntos de riesgo del
informe del implementer.

| # | Mutación | Suite | Rojos | ¿Coincide con el informe? |
|---|---|---|---|---|
| 1 | quitar el chequeo de `ver` en `SesionesService.validarAcceso` | `sesiones.api.test.ts` | **1 / 16** | ✅ (R12: «la siguiente petición… es 401 tras revocar el rol») |
| 2 | `rotarRefresh` sin mover el hash a `refresh_token_hash_anterior` | `sesiones.api.test.ts` | **2 / 16** | ✅ (T17 reuso + T23 PII, que exige la huella 64-hex) |
| 3 | reuso de refresh → solo 401, sin revocar la sesión | `sesiones.api.test.ts` | **1 / 16** | ✅ (T17: SELECT `revocada_at` + auditoría) |
| 4 | `JwtStrategy` sin `passReqToCallback` (tenant = `roles[0]`) | `seguridad.api.test.ts` | **3 / 15** | ✅ (los tres R33/R35 de #5) |
| 5 | logout sin revocar (`cerrarSesion` sin `revocar`) | `sesiones.api.test.ts` | **3 / 16** | ✅ (R11 + R9: revocada, indistinguibles) |
| 6 | *(propia)* eliminar las políticas RLS de la migración `0011` | `sesiones-rls.test.ts` | **1 / 5** | — (SELECT* por tenant) |

Rojos concretos:

- **(1)** → el test que revoca el rol con `UPDATE user_role` +
  `token_version++` y exige 401 en la petición siguiente: **exactamente** la
  aceptación PA-3. Sin el chequeo de `ver`, el token viejo seguiría
  sirviendo hasta expirar.
- **(2)** → T17 (reuso) y T23 (PII). La huella del refresh rotado no es
  cosmética: es lo que hace detectable el reuso y lo que el test de PII
  verifica en la base.
- **(3)** → T17: el 401 de reuso debe dejar la sesión `revocada_at` + la
  entrada `auth.sesion_revocada_por_reuso`. Solo-401 sin revocar sería la
  puerta del atacante reenviando el token hasta acertar.
- **(4)** → los tres tests R33/R35 de #5. La resolución del tenant de la
  sesión debe ser la MISMA que la del pipeline (header validado), no
  `roles[0]`; el implementer lo anotó como desviación y la mutación
  demuestra que era carga real.
- **(5)** → R11 (logout) y los dos R9 (refresh de revocada/indistinguibles).
- **(6)** → la visibilidad por tenant de `sesion` la sostiene el motor, no
  el código: sin las políticas, `SELECT *` no ve ninguna fila (rol no
  dueño). El RLS de `0011` se probó contra PostgreSQL real.

## 2. Trazabilidad requirements ↔ tests (20/20)

Verificada archivo por archivo; la tabla del implementer
(`progress/impl_sesion_y_revocacion.md`) es fiel. R1–R20 [x], con mutación
que los sostiene en los puntos de riesgo (R4/R12 → mut. 1, R7/R10 → mut. 2,
R8/R13 → mut. 3, R14/R33 → mut. 4, R9/R11 → mut. 5, R1/R14 → mut. 6).

**Anclaje al PRD:** los 20 citan RF-AU1, RF-C3, RF-AU6, RF-W4, §11.3, D2 y
los criterios de aceptación del humano (PA-3). Ningún requirement sin
origen. Las cuatro decisiones PA-27 se ejecutaron tal como el humano las
aprobó en la puerta del spec.

**Ningún test fabrica el objeto que dice verificar.** El rol de aplicación
lo provisiona `asegurarRolDeAplicacion`; el arnés siembra **sesiones reales**
(no fabrica un mock de sesión) y los asserts de estado persistido usan
`poolAdmin` con `SELECT` independientes (`revocada_at`, hashes,
`token_version`). El único mock (unit de `SesionesService`) solo registra
llamadas; el flujo completo se mide contra PostgreSQL real.

## 3. Puntos críticos revisados

1. **La excepción RLS del refresh (R18/R19).** La función
   `sesion_por_refresh_token` es la segunda —y declarada última— vía fuera
   del RLS. Verifiqué: `SECURITY DEFINER`, `REVOKE FROM PUBLIC`, devuelve
   solo las 5 columnas del bootstrap, coincidencia exacta de hash, y el GRANT
   al rol de aplicación vive en `rol-aplicacion.ts` (el mismo procedimiento
   de producción). El inventario de funciones SECURITY DEFINER de
   `migrations.db.test.ts` sigue vigilando que no aparezca una tercera. El
   servicio revalida la sesión dentro de `SET LOCAL` (R19) antes de rotar.
2. **Rotación y reuso (R7/R8).** El ciclo vigente→huella→detección está
   cubierto por mut. 2 y 3: quitando cualquiera de las dos piezas, la suite
   lo ve. El caso del atacante (reenviar el viejo tras rotar) revoca la
   sesión COMPLETA y lo audita con actor/motivo/timestamp (R13).
3. **PA-3 cerrado de verdad.** La ventana «revocar rol → token sigue
   válido» ya no existe: mut. 1 lo demuestra en la dirección correcta
   (el chequeo existe y es necesario) y el test de aceptación de la feature
   lo prueba contra la base real.
4. **Aislamiento (R14).** Sesión de A invisible desde B: el motor (mut. 6)
   y el arnés (tokens con sesión real por tenant) lo sostienen. El refresh
   de A rota en el tenant de A, nunca en B.
5. **Sin PII ni credenciales en repositorios.** El refresh en claro solo
   existe en la respuesta; la base, los logs y `audit_log` (serializado
   completo) no lo contienen (T23).

## 4. Tasks completas

**28 / 28 `[x]`**, cero `[ ]` en `specs/sesion_y_revocacion/tasks.md`.

## 5. Invariantes de seguridad (C7)

- **Aislamiento por tenant:** [x] — `0011` ENABLE+FORCE+política en la misma
  migración (mut. 6 lo sostiene); RLS real con rol sin BYPASSRLS; HTTP T19.
- **RBAC en backend con test de rechazo:** [x] — `RolesGuard` intacto (R15),
  T20; 401/403/404 siguen donde estaban; los 3 tests R33/R35 de #5 siguen
  verdes y su mutación (4) los protege.
- **Auditoría de acciones críticas:** [x] — `auth.sesion_abierta`,
  `auth.refresh_emitido`, `auth.sesion_cerrada`,
  `auth.sesion_revocada_por_reuso`: una fila exacta cada una, con
  `tenant_id`, `actor_id`, `entity_type='sesion'`, `entity_id` (T22, T17).
- **Sin secretos hardcodeados:** [x] — refresh con 48 bytes de entropía,
  hash SHA-256 en reposo; `JWT_SECRET` sigue sin default (defecto #3
  cerrado); el env nuevo `REFRESH_TOKEN_EXPIRATION` tiene default 30 días.
- **Datos personales en logs:** [x] — T23 (auditoría serializada + logs
  capturados).
- **Integridad documental (SHA-256):** n/a — no toca documentos firmados.

## 6. Checkpoints

C1 [x] · C2 [x] · C3 [x] · C4 [x] · C5 [x] · C6 [x] · C7 [x] · C8 n/a

---

## Bloqueantes

**Ninguno.**

## Deuda anotada (no bloqueante)

- **D-1 —** `POST /auth/refresh` y `POST /auth/logout` no llevan
  `x-tenant-id` en el flujo actual: el refresh lo resuelve de la sesión y el
  logout del token. Si algún día un cliente manda el header a estas rutas,
  el `TenantContextInterceptor` abriría transacción con ese tenant (no hace
  daño: el refresh usa su propia conexión), pero conviene revisarlo cuando
  exista el primer cliente HTTP real (web/pwa).
- **D-2 —** El arnés firma tokens con `ver: 0` fijo: si una feature futura
  siembra usuarios con `token_version` distinto, `entorno-clientes.ts`
  debe leerla en vez de asumir 0.
- **D-3 —** `auth.refresh_emitido` no lleva `ip_address` ni `request_id`
  (el refresh es público y el interceptor no corre): aceptable hoy, pero si
  la auditoría de seguridad los exige, hay que pasarlos por parámetro.

## Recomendación

**Cerrar #27 como `done`.** Es la feature que cierra PA-3 —la deuda de
seguridad más antigua del tablero— y lo hace con el patrón ya consolidado en
este repositorio: el estado vivo en PostgreSQL con RLS real, la excepción de
contexto como función SECURITY DEFINER acotada y auditable, y cada
invariante sostenido por una mutación que lo pone en rojo. Los seis puntos
de riesgo del informe se reproducen al test exacto (1, 2, 3, 1, 3 y 1
rojos, respectivamente), y la única desviación estructural (JwtStrategy con
`passReqToCallback`, mut. 4) resultó ser carga real: sin ella, tres
invariantes de la #5 caen.
