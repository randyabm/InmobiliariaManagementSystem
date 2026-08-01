# Design — inventory_tenant_review

> Feature #13. Revisión del inventario por el inquilino (RF-I4, RF-I5,
> RF-AU2 actualizado, RF-AU3, RF-AU5). Primeras rutas de CLIENTE del
> sistema.

---

## 1. El flujo completo

```
empleado (admin/empleado)
  POST /inventarios/:id/invitaciones
    → token (48 B, hash SHA-256 en invitacion_inventario)
    → inventario BORRADOR → ENVIADO (R2)
    → respuesta: { url_invitacion }

inquilino (sin sesión)
  GET  /invitaciones/:token           → bootstrap { inventario, inquilino } (R3)
  POST /invitaciones/:token/registro  → crear cuenta persistente + OTP (R4/R5)
  POST /auth/login                    → sesión estándar (#27)

inquilino (rol inquilino)
  GET  /inquilino/inventarios/:id                     → su inventario (R9)
  POST /inquilino/inventarios/:id/items/:idItem/revision  (R6)
  POST /auth/otp/solicitar { proposito: 'FIRMA' }     (R8, consume #14)
  POST /auth/otp/verificar
```

## 2. Invitación (R1, R3, PA-13-4)

- `invitacion_inventario`: id, tenant_id, inventario_id FK,
  perfil_inquilino_id FK, token_hash (UNIQUE), expira_en, usada_en NULL,
  created_at. RLS por tenant.
- El bootstrap sin sesión usa la **4ª vía** SECURITY DEFINER
  `invitacion_por_token(hash) RETURNS TABLE(token_hash? no — id,
  inventario_id, perfil_inquilino_id, tenant_id, expira_en, usada_en)`: la
  función valida coincidencia exacta del hash; el flujo abre transacción
  con `SET LOCAL` del tenant devuelto y revalida DENTRO del RLS (patrón
  R52/R18). El inventario de funciones crece a 4 y su test se actualiza.
- `usada_en` evita el reuso: una invitación consumida (cuenta creada o
  login vinculado) no vuelve a servir (409/401 uniforme).

## 3. Cuenta persistente y OTP (R3, R4, R5, PA-13-1/3)

- El registro crea la identidad con `IdentidadService.resolverIdentidad`
  (#26, dedup por documento) + `password_hash` (bcrypt) y rol `inquilino`.
  El email/celular verificado por OTP pasa al perfil (D-9: el contacto vive
  en el perfil).
- `codigo_otp`: id, tenant_id, user_id, proposito CHECK (`REGISTRO`,
  `LOGIN`, `FIRMA`), codigo_hash, expira_en, verificado_en NULL,
  created_at. RLS por tenant.
- La entrega se encola por `NotificacionesOutboxService` (canal del perfil,
  RF-C4). El código en claro solo viaja en la notificación (R12).
- `POST /auth/otp/verificar` con `proposito` verifica hash+expiración y
  marca `verificado_en`; 401 uniforme (sin distinguir). Para `FIRMA`, #14
  exigirá un OTP verificado reciente (ventana de 10 min) antes de firmar.

## 4. Revisión (R6, R7, PA-13-2)

- `inventario_item_revision`: id, tenant_id, item_id FK, perfil_inquilino_id
  FK, respuesta CHECK (`ACEPTADO`, `OBJETADO`), comentario text NULL,
  created_at. UNIQUE (item_id, perfil_inquilino_id) — una respuesta por
  ítem (una sola ronda, PA-13-2).
- Comentario obligatorio al objetar (400 si falta, R6).
- La foto del inquilino (multipart opcional) reutiliza `FotosService` de
  #12 con `autor = 'INQUILINO'` y se vincula a la revisión
  (`inventario_item_foto.revision_id` — columna nueva en #13).
- `revision_completada_en` en inventario cuando todos los ítems respondidos
  (R7); la notificación al empleado se dispara por el hook (#10) con el
  canal del empleado (email del perfil del creador o directo).

## 5. Scoping del inquilino (R9)

El guard de rol `inquilino` + un `InquilinoScopeGuard`/verificación en el
servicio: el perfil del usuario (user_id → perfil_inquilino del tenant) DEBE
coincidir con `perfil_inquilino_id` del inventario, 404 si no. El
`RolesGuard` ya exige el rol; el scoping por entidad es nuevo y se prueba
con dos inquilinos distintos del MISMO tenant.

## 6. Superficie HTTP (7 rutas)

| Método y ruta | Rol | R |
|---|---|---|
| `POST /inventarios/:id/invitaciones` | admin/empleado | R1, R2 |
| `GET /invitaciones/:token` | pública (bootstrap) | R3 |
| `POST /invitaciones/:token/registro` | pública | R3-R5 |
| `GET /inquilino/inventarios/:id` | inquilino | R9 |
| `POST /inquilino/inventarios/:id/items/:idItem/revision` | inquilino | R6, R7 |
| `POST /auth/otp/solicitar` | autenticado | R4, R8 |
| `POST /auth/otp/verificar` | autenticado | R5, R8 |

## 7. Migración (`0017_inventory_tenant_review.sql`, R13)

Forward-only e idempotente: `invitacion_inventario`, `codigo_otp`,
`inventario_item_revision` con RLS ENABLE+FORCE, `ALTER inventario ADD
revision_completada_en`, `ALTER inventario_item_foto ADD revision_id NULL
FK`, la función `invitacion_por_token` SECURITY DEFINER con REVOKE PUBLIC
(+ GRANT en rol-aplicacion), y el test del inventario de funciones pasa a
cuatro entradas.

## 8. Errores de dominio

| Error | `code` | HTTP | Cuándo |
|---|---|---|---|
| `InvitacionInvalidaError` (nuevo) | `INVITACION_INVALIDA` | 401 | R3: token inexistente/expirado/usado (uniforme) |
| `OtpInvalidoError` (nuevo) | `OTP_INVALIDO` | 401 | R5: código incorrecto/expirado (uniforme) |
| `RevisionInvalidaError` (nuevo) | `REVISION_INVALIDA` | 400 | R6: objetar sin comentario |
| `ResourceNotFoundError` (reutilizado) | `RESOURCE_NOT_FOUND` | 404 | R2, R9 |

## 9. Archivos

Se crean: migración `0017`, schemas (3), `modules/core/invitaciones/`
(+`invitaciones.controller/service/repository` + errores),
`modules/core/otp/` (+`otp.controller/service/repository`), `revision
inventario` dentro de `modules/core/inventarios/` (+`revision-inventario.
{controller,service,repository}.ts`), `packages/types/src/inventario-
revision.ts`, tests (`invitaciones.api.test.ts`, `revision-inquilino.api
.test.ts`, `otp.api.test.ts`, `inventario-revision-rls.test.ts`).

Se modifican: `schema/index.ts`, `_journal.json`, `tests/migrations.test.ts`
(+3), `routes-surface.test.ts` (+7), `migrations.db.test.ts` (tablas,
función 4ª, inventario SECURITY DEFINER), `rol-aplicacion.ts` (+GRANT),
`inventario-item-foto.ts` (revision_id), `inventario.ts`
(revision_completada_en), `feature_list.json`.

## 10. Alternativas descartadas

1. **Acceso anónimo de una sola vez (RF-I4 original).** Descartada: RF-AU2
   actualizado la reemplaza por cuenta persistente (R3, PA-13-1).
2. **OTP sin tabla (solo hash en user).** Descartada: `codigo_otp` permite
   propósito (FIRMA), expiración por intento y auditoría.
3. **Revisión multironda en #13.** Descartada: RF-I6/#22 la versiona
   (PA-13-2).

## 11. Estado de las ambigüedades

Las cuatro decisiones de la puerta (PA-13-1…PA-13-4) quedan explícitas. La
frontera con #14 (OTP de FIRMA) queda anclada en R8. No quedan más
ambigüedades de producto.
