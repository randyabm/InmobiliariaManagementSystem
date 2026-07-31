/**
 * Predicado de pertenencia de una identidad (`user`) al tenant de la petición
 * (**R38**, hallazgo **B1** de `progress/review_owner_tenant_profiles.md`).
 *
 * Vive aquí, y no duplicado en cada repositorio, porque es **una sola regla**:
 * si cambia, cambia en un sitio o las dos copias divergen sin que nada lo note.
 * Esta task es justamente la prueba de que hacía falta.
 *
 * ## Historia, porque explica la forma actual
 *
 * **T50** lo escribió como `EXISTS (… ur.tenant_id = $N)` **y**
 * `NOT EXISTS (… ur.tenant_id <> $N)` sobre `user_role`. No era rebuscado: en
 * ese momento `user` **no tenía** columna `tenant_id`, y ese predicado es el
 * único válido **antes y después** de la migración de D-8 (`requirements.md`
 * R38, `design.md` §20.1). Así B1 quedó cerrado sin depender del bloque
 * siguiente.
 *
 * **T54** lo simplifica, como el propio requirement anticipaba: con
 * `user.tenant_id NOT NULL` (**R59**) la pertenencia es una columna, no una
 * deducción. Y la segunda mitad —"y no pertenece a ninguna otra"— dejó de tener
 * sentido: **D-8** eliminó las identidades compartidas, así que no hay ninguna
 * que excluir. La coherencia entre identidad y rol ya no depende de este
 * predicado sino de la FK compuesta de **R60**, que la impone en el motor.
 *
 * ## Defensa en profundidad, no redundancia
 *
 * La misma regla está escrita dos veces a propósito: aquí (repositorio) y en la
 * política RLS `user_tenant_isolation` de `0007_identidad_por_tenant.sql`
 * (motor). La del motor es la garantía real —y la única que sigue valiendo si
 * alguien añade mañana otro `UPDATE`—; la de aquí es la que hace que un
 * despliegue mal configurado no se lleve por delante el aislamiento.
 */
export function predicadoDePertenenciaAlTenant(indiceTenant: number): string {
  return `"user"."tenant_id" = $${indiceTenant}`;
}
