# Implementación — feature #25 (`retencion_codeudor_referencias`)

**Status:** implementación completa, a la espera del review. Suite: `npm run
test` **495** (47 archivos) + `npm run test:db` **82** (3 archivos). Lint,
typecheck y build verdes.

## Mapa de trazabilidad R1–R25 → test concreto

| R | Enunciado (resumen) | Test que lo cubre |
|---|---|---|
| R1 | Tabla `tarifa_retencion` (tenant, anio, numeric(5,2), UNIQUE) | `migrations.db.test.ts` «tarifa_retencion tiene UNIQUE…» + schema `tarifa-retencion.ts` |
| R2 | Tabla `codeudor_inquilino` con UNIQUE por tenant+inquilino+doc | `migrations.db.test.ts` «FK… perfil_inquilino» + `codeudores.test.ts` «permite el MISMO documento en otro inquilino» |
| R3 | Tabla `referencia_inquilino` (`relacion` libre nullable) | `migrations.db.test.ts` FK + `referencias.test.ts` «admite una referencia sin relacion ni email» |
| R4 | RLS ENABLE+FORCE+política en las tres tablas, misma migración | `migrations.db.test.ts` (RLS de las 3) + `retencion-codeudor-rls.test.ts` (SELECT* sin WHERE por tenant, rol sin BYPASSRLS) |
| R5 | Sin columna de tarifa en `perfil_propietario` | `migrations.db.test.ts` «perfil_propietario sigue SIN ninguna columna…» |
| R6 | `PUT /configuracion/retencion/:anio` upsert solo-admin | `retencion.test.ts` «PUT crea la tarifa y, repetido… UNA sola fila» |
| R7 | `GET /configuracion/retencion` tarifas propias desc | `retencion.test.ts` «GET devuelve solo las tarifas del tenant…» |
| R8 | `resolverPorcentaje` devuelve la tarifa del año | `retencion.test.ts` «un propietario sujeto a retención resuelve…» |
| R9 | Año sin configurar → `TarifaRetencionNoConfiguradaError`, sin default | `retencion.test.ts` «resolverPorcentaje de un año sin configurar lanza…» |
| R10 | `sujeto_retencion=false` → `{aplica:false}` sin consultar tarifa | `retencion.test.ts` «…SIN consultar tarifa_retencion» (espía `buscarPorAnio` no llamado) |
| R11 | `porcentaje` viaja como string exacto | `retencion.test.ts` «'3.50' exacto» (unit + HTTP, `typeof string`) |
| R12 | `POST /inquilinos/:id/codeudores` admin/empleado, 201 con id | `codeudores.test.ts` «registra un codeudor…» |
| R13 | GET/PATCH/DELETE codeudores, baja lógica sin borrado físico | `codeudores.test.ts` (PATCH persiste, DELETE `activo=false` con SELECT) |
| R14 | Documento repetido en el mismo inquilino → 409 | `codeudores.test.ts` «rechaza con 409 CODEUDOR_YA_EXISTE…» |
| R15 | `POST /inquilinos/:id/referencias` 201 con id | `referencias.test.ts` «registra una referencia…» |
| R16 | GET/PATCH/DELETE referencias, baja lógica | `referencias.test.ts` (PATCH, DELETE, listado solo activas) |
| R17 | Frontera de comportamiento: sin contrato/firma/inventario | `codeudores.test.ts` «registra codeudor y referencia SIN que exista…» (ni tablas existen) |
| R18 | Frontera estructural: sin FK hacia contrato/firma/inventario/OTP | `codeudores.test.ts` «ninguna FK…» + `migrations.db.test.ts` (R18) |
| R19 | Aislamiento por tenant: 404/lista propia, nunca ajena | `retencion-codeudor-seguridad.api.test.ts` T23 (GET/PATCH/DELETE ajeno → 404, tarifa propia, PUT no toca la ajena) + `retencion-codeudor-rls.test.ts` |
| R20 | Roles `propietario`/`inquilino` → 403 en las 10 rutas | `retencion-codeudor-seguridad.api.test.ts` T24 (403 por rol, 401 sin token) |
| R21 | `empleado` → 403 en retención | `retencion-codeudor-seguridad.api.test.ts` «empleado: 403 en retención…» |
| R22 | Sin contexto de tenant → `SinContextoDeTenantError` | `retencion-codeudor-rls.test.ts` (GUC virgen → 0 filas; `obtenerClienteTenant` lanza) |
| R23 | Auditoría de las 7 mutaciones con tenant, actor, acción, entidad | `retencion-codeudor-seguridad.api.test.ts` T25 (una fila exacta por mutación, con SELECT) |
| R24 | Documento/celular/telefono/email fuera de logs y `metadata` | `retencion-codeudor-seguridad.api.test.ts` T25 (auditoría serializada + stdout/stderr capturados) |
| R25 | Migración única versionada + TABLAS_PERMITIDAS + RUTAS_PERMITIDAS | `tests/migrations.test.ts` (journal, tablas) + `routes-surface.test.ts` (10 rutas) |

**Anclaje al PRD:** R1–R25 citan RF-C4, RF-C5, RF-P1, RF-A1, RF-C3, RF-W4,
§11.3, D2, D7 y Ley 1581 de 2012 (ver `requirements.md`). Ningún requirement
sin origen.

## Desviaciones anotadas

- **Nombre del parámetro de ruta normalizado.** El `design.md` §5 mezcla
  `:id` (GET/POST) y `:idInquilino` (PATCH/DELETE) para el mismo parámetro.
  Se normalizó a `:idInquilino` en las 8 rutas de codeudores/referencias
  (controller + `RUTAS_PERMITIDAS`). Es cosmético para Express (la forma de
  la ruta es idéntica), pero `routes-surface.test.ts` compara cadenas y exige
  una sola forma canónica.
- **`AuditInterceptor` ampliado (archivo de la #5).** El fallback de
  `entity_id` para bajas lógicas solo miraba `params.idCuenta ?? params.id`:
  en `DELETE /inquilinos/:idInquilino/codeudores/:idCodeudor` habría
  auditado el **inquilino** en vez del codeudor (R23). Se añaden
  `idCodeudor` e `idReferencia` al fallback. Es la extensión del mismo patrón
  que ya introdujo la #5 con `idCuenta`.

## Dependencia registrada para #14/#17

El amarre codeudor ↔ firmante se añadirá **desde** la tabla de firmas,
declarando la FK hacia `codeudor_inquilino` y no al revés (design.md §7): así
no se invierte la dirección de dependencia entre `core/clientes` y el módulo
de contratos, y la frontera estructural de R18 se mantiene. Esta feature no
declara ninguna FK hacia entidades de contrato, firma, inventario u OTP.

## Verificación final

- `npm run lint` — sin errores.
- `npm run typecheck` — sin errores.
- `npm run test` — **495 passed** (47 archivos); antes 452 → +43.
- `npm run test:db` — **82 passed** (3 archivos); antes 71 → +11.
- `npm run build` — ok (api, types, web).
- `./init.sh` — exit 0 (ejecutado al cierre).

## Candidatas a mutación (para el reviewer)

1. Quitar el `ON CONFLICT` del upsert de `retencion.repository.ts` → deben
   romper «PUT crea la tarifa y, repetido… UNA sola fila».
2. Cambiar `activo = false` por `DELETE` en `darDeBaja` de codeudores →
   deben romper los tests de baja lógica (SELECT `activo`) y los listados.
3. Relajar `resolverPorcentaje` para devolver un default → rompen R9 y el
   test «año sin configurar lanza».
4. `resolverRetencionDePropietario` consultando la tarifa para
   `sujeto=false` → rompe el espía «buscarPorAnio no llamado».
5. Quitar `:idInquilino`→`idCodeudor` del interceptor → rompe T25 (baja
   audita entity_id del inquilino).
6. Quitar el `AND tenant_id = $2` de `sujetoDeRetencion` → rompe T23 (404
   cross-tenant) — análogo a la mutación (b) de la #26.
