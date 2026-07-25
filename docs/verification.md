# Verificación — Cómo demostrar que el trabajo funciona

> Regla de oro: **el agente no dice "funciona", lo demuestra**.
> Toda feature termina con evidencia ejecutable, no con afirmaciones.

## Principio: dos problemas distintos (PRD §16.1)

| | Qué se prueba | Cómo |
|---|---|---|
| **El sistema** | Aislamiento, RBAC, workflows, offline, firma | **Determinista** |
| **Las funciones de IA** | Chatbot, interpretación de archivos de pago | **Evals** |

> 🔒 **Los invariantes de seguridad se prueban SIEMPRE de forma determinista.**
> Un test que valide que un inquilino no ve datos de otro tenant no puede
> depender del juicio de un modelo. Si el resultado es probabilístico, no es
> un control de seguridad.

---

## Nivel 1 — Tests unitarios (obligatorio)

Toda función pública de un servicio tiene al menos un test que:
1. Cubre el camino feliz.
2. Cubre al menos un camino de error si la función puede fallar.

```bash
pnpm test
```

## Nivel 2 — Tests contra PostgreSQL real (obligatorio si toca datos)

**El RLS no se puede probar con mocks ni con SQLite.** Los tests que tocan la
base de datos levantan un PostgreSQL real con **Testcontainers**.

```ts
// Patrón: el test demuestra que el aislamiento se sostiene incluso cuando
// el código de aplicación intenta saltárselo.
it('no devuelve propiedades de otro tenant aunque se consulte sin filtro', async () => {
  await asTenant(tenantA, () => createProperty({ address: 'Calle 1' }));
  await asTenant(tenantB, () => createProperty({ address: 'Calle 2' }));

  const result = await asTenant(tenantA, () => db.query('SELECT * FROM property'));

  expect(result).toHaveLength(1);
  expect(result[0].address).toBe('Calle 1');
});
```

**Anti-patrón:** mockear el repositorio y afirmar que se llamó con
`tenant_id`. Eso prueba que el código *intenta* filtrar, no que el sistema
*aísle*.

## Nivel 3 — Tests de API (obligatorio para endpoints nuevos)

Con Supertest contra la app real:
- Camino feliz con un rol autorizado.
- **Rechazo con cada rol no autorizado.**
- **Rechazo con un token de otro tenant.**

Un endpoint nuevo sin estos tres casos no pasa review.

## Nivel 4 — E2E y offline (obligatorio para features de UI)

Con **Playwright**. Para la PWA de campo, el flujo offline se ejercita de
verdad:

```ts
await context.setOffline(true);
// crear inventario, agregar fotos, verificar indicador de pendientes
await context.setOffline(false);
// verificar sincronización y confirmación del backend
```

Un inventario solo se considera sincronizado cuando **el backend responde
OK**, nunca antes.

## Nivel 5 — Trazabilidad de requirements (obligatorio para `"sdd": true`)

Cada `R<n>` de `specs/<name>/requirements.md` debe mapearse a al menos un
test concreto. El implementer documenta el mapa en `progress/impl_<name>.md`:

```markdown
## Trazabilidad
- R1 (RF-I14) → `crea inventario sin conexión`
- R2 (RF-I16) → `muestra indicador de pendientes hasta confirmación`
- R3 (RF-I18) → `el botón manual sincroniza los pendientes`
```

El reviewer rechaza si algún `R<n>` queda sin cobertura.

## Nivel 6 — Evals de IA (solo si la feature toca IA)

Con **Promptfoo**, en CI. Obligatorio incluir:
- Casos de **respuesta correcta**.
- Casos de **negativa correcta**: que el modelo se niegue a revelar datos
  fuera del scope o a ejecutar acciones irreversibles.
- **Red-teaming de prompt injection.** Si estas pruebas fallan, no se
  despliega.

Para la interpretación de archivos de pago, las aserciones son
**deterministas** (¿mapeó la columna N como monto?), no juicio difuso. Y la
regla dura: **la IA identifica estructura, el código extrae los valores** —
ningún importe es transcrito por un modelo.

---

## Anti-patrones (no hacer)

- ❌ "He añadido el endpoint, debería funcionar." → falta test ejecutable.
- ❌ Test que solo verifica que no lanza excepción → debe comprobar el
  resultado concreto.
- ❌ Mockear la base de datos para probar aislamiento → usa Postgres real.
- ❌ Probar solo el camino feliz de un endpoint con permisos.
- ❌ Marcar la feature como `done` sin `./init.sh` verde.
- ❌ Verificar un invariante de seguridad con un LLM.

## Verificación final antes de cerrar

```bash
./init.sh    # debe terminar con [OK] Entorno listo
```

Si `./init.sh` está rojo, **no** marques nada como `done`. Anota el bloqueo
en `progress/current.md` y pon la feature en `blocked`.
