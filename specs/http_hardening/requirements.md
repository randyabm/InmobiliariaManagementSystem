# Requirements — http_hardening

> Feature #24. Endurecimiento de cabeceras HTTP.
> Fuente: RF-INT4 (CORS por tenant), D7 (API-first + embebido en WordPress).
> **Alcance acordado fuera del PRD:** las cabeceras de seguridad (HSTS,
> X-Content-Type-Options, Referrer-Policy, CSP) y la supresión de
> X-Powered-By no están en el PRD pero fueron aceptadas como requisitos de
> hardening por decisión explícita del humano (ver feature_list.json #24).

---

## R1 — (RF-INT4, D7) Supresión de X-Powered-By

CUANDO el servidor responde a cualquier petición HTTP, el sistema DEBE
omitir la cabecera `X-Powered-By` (no revela el framework ni su versión).

## R2 — (Acordado fuera del PRD) HSTS

CUANDO el servidor responde a cualquier petición HTTP, el sistema DEBE
incluir la cabecera `Strict-Transport-Security` con un valor mínimo de
`max-age=31536000; includeSubDomains`.

## R3 — (Acordado fuera del PRD) X-Content-Type-Options

CUANDO el servidor responde a cualquier petición HTTP, el sistema DEBE
incluir la cabecera `X-Content-Type-Options: nosniff`.

## R4 — (Acordado fuera del PRD) Referrer-Policy

CUANDO el servidor responde a cualquier petición HTTP, el sistema DEBE
incluir la cabecera `Referrer-Policy: strict-origin-when-cross-origin`.

## R5 — (Acordado fuera del PRD) Content-Security-Policy

CUANDO el servidor responde a cualquier petición HTTP, el sistema DEBE
incluir una cabecera `Content-Security-Policy` con al menos las directivas
`default-src 'self'` y `frame-ancestors 'self'`.

## R6 — (RF-INT4, D7) frame-ancestors por tenant

CUANDO el servidor responde a una petición de un tenant que tiene dominios
de embebido registrados, el sistema DEBE incluir `frame-ancestors` con
los dominios permitidos de ese tenant, en lugar del valor por defecto
`'self'`.

## R7 — (Acordado fuera del PRD) Test de integridad de cabeceras

EL sistema DEBE tener al menos un test que verifique que las cabeceras
de seguridad (R1–R5) están presentes en la respuesta a un endpoint
qualquiera. El test DEBE fallar si alguna cabecera se omite.

## R8 — (RF-INT4, D7) Test de frame-ancestors

EL sistema DEBE tener al menos un test que verifique que
`frame-ancestors` no admite un origen arbitrario no listado en la
configuración del tenant. El test DEBE fallar si el origen no autorizado
aparece en la cabecera.
