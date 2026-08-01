import type { ContextoPeticion } from '../../../common/database/cliente-tenant';
import { AuditService } from '../audit/audit.service';
import type { RolDeCliente } from './identidad.service';

/**
 * Auditoría de la **reutilización de identidad** (**R13**).
 *
 * Vive aquí, y no duplicada en `propietarios.service.ts` e
 * `inquilinos.service.ts`, por el mismo motivo que
 * `predicado-identidad.ts`: es **una sola regla**, y dos copias divergen sin
 * que nada lo note.
 *
 * ## Por qué es acción crítica
 *
 * Es el instante en que una credencial que ya existe gana acceso a los datos de
 * un rol nuevo dentro de la inmobiliaria. Quien ya podía ver lo suyo como
 * propietario pasa a poder ver lo suyo como inquilino con la misma contraseña.
 * `CHECKPOINTS.md` §C7 exige traza inmutable de eso.
 *
 * ## Qué NO se registra
 *
 * El **documento**, ni en `metadata` ni en ningún log (`docs/conventions.md`,
 * Ley 1581 de 2012). El `metadata` lleva el rol, que no es dato personal. El
 * `entity_id` es el `user_id` reutilizado, que ya está en la tabla `user` del
 * mismo tenant y no revela nada nuevo.
 *
 * Solo se audita cuando la identidad se **reutilizó**: crear una identidad
 * nueva ya lo audita el `@Audit` del controlador con `accion = 'crear'`, y una
 * segunda entrada por cada alta convertiría la traza de lo excepcional en
 * ruido.
 */
export async function auditarRolAnadido(
  audit: AuditService,
  ctx: ContextoPeticion,
  userId: string,
  rol: RolDeCliente,
  reutilizada: boolean,
): Promise<void> {
  if (!reutilizada) return;

  await audit.log({
    tenantId: ctx.tenantId,
    ...(ctx.actorId !== undefined ? { actorId: ctx.actorId } : {}),
    accion: 'identidad.rol_anadido',
    entityType: 'user',
    entityId: userId,
    metadata: { rol },
  });
}
