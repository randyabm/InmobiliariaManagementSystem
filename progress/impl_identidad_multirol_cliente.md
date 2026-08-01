# Implementación — #26 `identidad_multirol_cliente`

> Informe escrito **conforme avanza** la implementación, no al final.
> Spec: `specs/identidad_multirol_cliente/{requirements,design,tasks}.md`.
> 29 requirements (R1–R29), 31 tasks (T1–T31), una migración
> (`0009_identidad_por_documento.sql`).

**Línea base verificada antes de empezar** (por el humano):
`./init.sh` exit 0 · `npm run test` **372** · `npm run test:db` **56**.

---

## Bitácora por bloques

### Bloque 0 — Deuda del arnés (T1–T4) — hecho

- **T1 (R25)** — `init.sh`: el chequeo `DATABASE_URL == DATABASE_MIGRATION_URL`
  pasa de `warn` a `fail` con `EXIT_CODE=1`, y añade un `ok` explícito cuando
  difieren. Los tres `warn` por variables ausentes **se dejan intactos**: ahí el
  aviso es la elección correcta y el review lo confirmó.
- **T2 (R25)** — `tests/init-sh-roles-db.test.ts`, 4 tests. Ejecuta `init.sh`
  en un **directorio de arena** (archivos base mínimos, `feature_list.json`
  vacío, `.env` con credenciales inertes y **sin `package.json`**) para que el
  código de salida dependa solo del chequeo bajo prueba: URLs iguales → exit ≠ 0
  con `[FAIL]`; URLs distintas → exit 0 y `[OK]`. Ejecutarlo sobre el repo real
  recursaría lint+typecheck+ambas suites por caso.
- **T3 (R26)** — Texto corregido: titular de **R62** en
  `specs/owner_tenant_profiles/requirements.md` y enunciado de **T58** en su
  `tasks.md` → "nunca heredada de otra inmobiliaria". También las tres
  tablas-resumen que repetían la frase (`tasks.md` ×2, `design.md` ×1): dejarlas
  reintroducía la contradicción por la puerta de atrás. **No** se tocó código,
  estado ni marcas `[x]` de la #5.
- **T4 (R26)** — `tests/spec-identidad-siempre-nueva.test.ts`, 5 tests: el
  titular de R62 y el enunciado de T58 no dicen "siempre nueva", el titular sí
  acota a "otra inmobiliaria", T58 sigue `[x]` (se corrige texto, no se reabre) y
  ningún resumen repite la afirmación sin acotar.

---

## Consulta de diagnóstico de identidades duplicadas (design.md §3)

Pendiente: se documenta con la migración del bloque A.

## Verificación por mutación (T27)

Pendiente: bloque C.

## Trazabilidad R → test (T28)

Pendiente: bloque C.
