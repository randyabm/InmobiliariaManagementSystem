# Implementación — feature #28 (`web_admin_panels`)

**Status:** done. Suite: `npm run test` **843** (incluye 8 de web) +
`test:db` **143**; lint/typecheck/build verdes; `./init.sh` exit 0.

## Trazabilidad R1–R7
| R | Test |
|---|---|
| R1 Login #27 + refresh en IndexedDB | `login.test.tsx` (flujo feliz y rechazo) + `paneles.test.tsx` (cerrar sesión limpia) |
| R2 Dashboard RF-P5 | `paneles.test.tsx` (tarjetas + lista) |
| R3 Inventarios RF-I13 (filtros + ficha) | `paneles.test.tsx` (navegación y lista) |
| R4 Contratos + vencimientos + renovar/no-renovar | `paneles.test.tsx` (vencimientos + POST renovar) |
| R5 Clientes y Plantillas (clonar) | `paneles.test.tsx` (clonar → POST) |
| R6 Tokens nunca en localStorage | `paneles.test.tsx` (cerrar sesión) |
| R7 Tres estados explícitos | `use-api.tsx` (cargando/error/listo) en todas las vistas |

## Decisiones PA-28
PA-28-1 cliente con transporte inyectable y navegación por estado;
PA-28-2 solo dependencias existentes (+ `idb` y `@testing-library/user-event`
de test); PA-28-3 las acciones llaman a la API real (renovar, no-renovar,
clonar).

## Notas
- `apps/web` deja de ser el shell de healthcheck: el login y el panel
  interno sustituyen la pantalla anterior (App.test.tsx actualizado).
- El cliente replica el manejo 401 → refresh → reintento → logout de #15.
- CSS mínimo inline por clases; sin librerías de UI (PA-28-2).
