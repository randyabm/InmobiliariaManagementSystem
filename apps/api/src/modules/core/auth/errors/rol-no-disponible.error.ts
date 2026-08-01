import { AppError } from '../../../../common/errors';

/**
 * El rol solicitado como **rol activo** no está entre los roles activos que esa
 * identidad tiene en esa inmobiliaria (**R17**), o el `rol_activo` que declara
 * un token no figura entre los roles que el propio token transporta
 * (**R29**).
 *
 * ## Por qué el mensaje es genérico
 *
 * No dice qué roles **sí** tiene la identidad, ni si el rol pedido existe en el
 * sistema. Quien hace esta petición ya sabe qué roles tiene —los acaba de leer
 * en `GET /auth/me`—, así que un mensaje detallado no le aporta nada y sí
 * convertiría este endpoint en un enumerador de roles para un token robado.
 *
 * ## Por qué 403 y no 404
 *
 * No hay recurso que ocultar: el rol es un valor del propio dominio, no un
 * objeto ajeno. Lo que se rechaza es la **autorización** de actuar con él.
 */
export class RolNoDisponibleError extends AppError {
  readonly code = 'ROL_NO_DISPONIBLE';
  readonly httpStatus = 403;

  constructor(message = 'No puedes actuar con ese rol en esta inmobiliaria.') {
    super(message);
  }
}
