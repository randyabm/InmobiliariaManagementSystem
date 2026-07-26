# Convenciones — Estilo, nombres y errores

> Reglas de escritura de código. El reviewer las verifica.

## Idioma

> **Decisión del humano (2026-07-26):** todo en español. Esta sección se
> enmendó tras la feature #1: la regla anterior exigía código en inglés y el
> `reviewer` detectó que la implementación real era español en internals y
> tests. Se resolvió a favor del español, no renombrando el código.

- **Código en español:** nombres de variables, funciones, clases, tablas,
  columnas y endpoints. El equipo trabaja en español y el dominio es
  colombiano; traducir `canon`, `arrendatario` o `poliza` a inglés produce
  nombres peores, no mejores.
- **Sin tildes ni `ñ` en identificadores.** `poliza`, no `póliza`;
  `anio`, no `año`. Aplica a código, tablas, columnas y rutas HTTP: los
  identificadores acentuados rompen herramientas, drivers y URLs.
- **Se respeta el término técnico establecido en inglés** cuando traducirlo
  sería peor o inventado: `tenant`, `token`, `hash`, `commit`, `endpoint`,
  `timestamp`, `healthcheck`. No se traducen a `arrendatarioDelSistema` ni
  `marcaDeTiempo`.
- **Cuidado con `tenant`:** en este proyecto significa *inmobiliaria cliente
  del SaaS*, no *inquilino*. El inquilino es `inquilino`. No los mezcles.
- **Comentarios y documentación en español.**
- **Mensajes de error de cara al usuario en español.**

## TypeScript

- `strict: true`. Ningún `any` sin un comentario que lo justifique.
- Preferir tipos explícitos en las fronteras públicas (parámetros y retornos
  de servicios); inferencia dentro de funciones.
- Nada de `@ts-ignore` sin justificación escrita al lado.
- Los tipos compartidos entre backend y frontend viven en `packages/types`,
  no se duplican.

## Nombres

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos | `kebab-case` | `property-lifecycle.service.ts` |
| Clases | `PascalCase` | `PropertyLifecycleService` |
| Variables y funciones | `camelCase` | `findActiveContract` |
| Constantes | `UPPER_SNAKE_CASE` | `MAX_PHOTO_SIZE_BYTES` |
| Tablas y columnas | `snake_case` | `inventory_item_photo`, `tenant_id` |
| Endpoints | `kebab-case`, plural | `GET /properties/:id/inventories` |
| Enums de dominio | `PascalCase` + valores `SCREAMING_SNAKE` | `PropertyStatus.EN_DESOCUPACION` |

## Estructura de un módulo

```
modules/<nombre>/
├── <nombre>.module.ts
├── <nombre>.controller.ts
├── <nombre>.service.ts
├── <nombre>.repository.ts
├── dto/
├── entities/
└── __tests__/
```

## Manejo de errores

- **Nunca devuelvas un error genérico 500 por una condición esperada.**
- Usa excepciones de dominio con significado; el borde HTTP las traduce a
  códigos de estado.
- Un error de autorización devuelve **403**; uno de recurso inexistente
  dentro de otro tenant devuelve **404**, no 403 — no confirmes la
  existencia de recursos ajenos.
- Los mensajes de error **nunca** incluyen datos de otro tenant, stack
  traces, ni consultas SQL.

```ts
// ✅
throw new PropertyNotFoundError(propertyId);

// ❌ — filtra información y no es accionable
throw new Error(`SELECT failed for tenant ${tenantId}: ${sql}`);
```

## Base de datos y migraciones

- **Todo cambio de esquema es una migración versionada.** Sin excepción.
- Las migraciones son **hacia adelante e idempotentes**; nunca se edita una
  migración ya aplicada.
- Toda tabla de negocio: `id`, `tenant_id`, `created_at`, `updated_at`.
- Toda tabla de negocio nueva **debe habilitar RLS en la misma migración que
  la crea**. Crear la tabla sin RLS es un defecto, aunque los tests pasen.
- Nada de borrado físico en entidades con valor legal (contratos, firmas,
  auditoría): borrado lógico o inmutabilidad.

## Dinero y fechas

- **Dinero: nunca `float`.** Enteros en la unidad mínima o `numeric` de
  PostgreSQL. El peso colombiano no usa decimales en la práctica, pero la
  representación debe ser exacta de todos modos.
- **Fechas: siempre con zona horaria** (`timestamptz`). La operación es en
  `America/Bogota`; el almacenamiento en UTC.
- Los cálculos de plazos legales (preavisos, prórrogas) se hacen sobre
  fechas, no sobre timestamps, para evitar errores por hora del día.

## Logs y datos personales

- Nunca registres en logs: documentos de identidad, contraseñas, tokens,
  contenido de contratos, ni fotos.
- Los logs llevan `tenant_id` y `request_id` para poder rastrear sin
  exponer datos (Ley 1581 de 2012).

## Frontend

- Componentes funcionales con hooks. Nada de lógica de negocio en el
  componente: vive en hooks o en el cliente de API.
- El frontend **nunca** es la única barrera de permisos: ocultar un botón no
  es autorizar.
- Estados de carga y error explícitos en toda vista que consulte la API.

## Comentarios

- Explica **por qué**, no **qué**. El qué se lee en el código.
- Un comentario que describe una regla legal o de negocio debe citar su
  origen: `// Ley 820/2003 art. 6 — prórroga automática`.
