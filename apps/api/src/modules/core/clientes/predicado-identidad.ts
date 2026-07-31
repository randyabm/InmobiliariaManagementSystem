/**
 * Predicado de pertenencia de una identidad (`user`) al tenant de la petición
 * (**R38**, hallazgo **B1** de `progress/review_owner_tenant_profiles.md`).
 *
 * Vive aquí, y no duplicado en cada repositorio, porque es **una sola regla**:
 * si un día cambia (T54 la simplifica), tiene que cambiar en un único sitio o
 * las dos copias divergen sin que nada lo note.
 *
 * ## Por qué el predicado es este y no `tenant_id = $N`
 *
 * Cuando se escribe esta task, `user` **todavía no tiene** columna `tenant_id`:
 * la añade la migración de D-8 (**R59**, T54). El predicado con
 * `EXISTS`/`NOT EXISTS` sobre `user_role` es válido **antes y después** de esa
 * migración (`requirements.md` R38, `design.md` §20.1), así que B1 se cierra
 * sin depender del bloque siguiente. Una vez `user.tenant_id` exista, T54 lo
 * sustituye por `tenant_id = $N`, que es la misma propiedad expresada de forma
 * directa.
 *
 * Las dos mitades dicen cosas distintas y las dos hacen falta:
 *
 * - `EXISTS (… ur.tenant_id = $N)` — la identidad está vinculada a **mi**
 *   inmobiliaria. Sin esto, un `user_id` cualquiera sería editable.
 * - `NOT EXISTS (… ur.tenant_id <> $N)` — y **no lo está a ninguna otra**.
 *   Mientras la vinculación de identidades entre tenants siguió existiendo
 *   (R25, que retira T58), la primera mitad sola no bastaba: el paso 1 del
 *   ataque descrito en la revisión consistía justamente en fabricarse ese rol.
 */
export function predicadoDePertenenciaAlTenant(indiceTenant: number): string {
  return (
    `EXISTS (SELECT 1 FROM user_role ur ` +
    `WHERE ur.user_id = "user".id AND ur.tenant_id = $${indiceTenant}) ` +
    `AND NOT EXISTS (SELECT 1 FROM user_role ur ` +
    `WHERE ur.user_id = "user".id AND ur.tenant_id <> $${indiceTenant})`
  );
}
