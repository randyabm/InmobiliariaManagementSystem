import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '@inmobiliaria/types';

import { AppError } from '../errors';

/**
 * Mensajes de cara al usuario, SIEMPRE en español (docs/conventions.md).
 *
 * No se reutiliza el texto que genera NestJS/Express (p. ej. "Cannot GET /x"):
 * está en inglés y describe internals del framework. La traducción es por
 * código de estado, no por excepción, para que ninguna ruta pueda filtrar
 * texto del framework por descuido.
 */
const MENSAJES_POR_ESTADO: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'La solicitud no es válida.',
  [HttpStatus.UNAUTHORIZED]: 'Debes autenticarte para acceder a este recurso.',
  [HttpStatus.FORBIDDEN]: 'No tienes permisos para realizar esta acción.',
  [HttpStatus.NOT_FOUND]: 'El recurso solicitado no existe.',
  [HttpStatus.METHOD_NOT_ALLOWED]:
    'El método HTTP no está permitido para esta ruta.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'El contenido enviado es demasiado grande.',
  [HttpStatus.TOO_MANY_REQUESTS]:
    'Has realizado demasiadas solicitudes. Intenta de nuevo más tarde.',
  [HttpStatus.INTERNAL_SERVER_ERROR]:
    'Ocurrió un error inesperado. Intenta de nuevo más tarde.',
};

const CODIGOS_POR_ESTADO: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

const ESTADO_POR_DEFECTO = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * Traduce cualquier excepción a la forma única `ApiErrorResponse`.
 *
 * INVARIANTE (R16, docs/conventions.md): el cuerpo NUNCA contiene stack
 * traces, SQL, nombres de tabla ni datos de otro tenant. El detalle técnico
 * va al log del servidor, no a la respuesta.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status = this.resolverEstado(exception);
    const body: ApiErrorResponse = {
      statusCode: status,
      error: this.resolverCodigo(exception, status),
      message: this.resolverMensaje(exception, status),
      timestamp: new Date().toISOString(),
      path: request.url,
      // Datos accionables de los errores de dominio que los declaran (**R28**
      // de la #26). No es vía libre para adjuntar cualquier cosa: solo los
      // errores < 500 que definen `detalles` a propósito, y cada uno justifica
      // en su propia clase por qué esos campos no revelan nada ajeno.
      ...this.resolverDetalles(exception, status),
    };

    // El detalle técnico se registra, no se devuelve. Sin datos personales
    // (Ley 1581 de 2012): solo método, ruta y mensaje del error.
    this.logger.error(
      `${request.method} ${request.url} -> ${status} ${body.error}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json(body);
  }

  private resolverEstado(exception: unknown): number {
    if (exception instanceof AppError) return exception.httpStatus;
    if (exception instanceof HttpException) return exception.getStatus();
    return ESTADO_POR_DEFECTO;
  }

  private resolverCodigo(exception: unknown, status: number): string {
    if (exception instanceof AppError) return exception.code;
    return CODIGOS_POR_ESTADO[status] ?? 'INTERNAL_ERROR';
  }

  private resolverMensaje(exception: unknown, status: number): string {
    // Solo los errores de dominio propios llevan mensaje propio: están
    // escritos en español y revisados. Todo lo demás usa la tabla.
    if (exception instanceof AppError && status < 500) return exception.message;
    return (
      MENSAJES_POR_ESTADO[status] ??
      MENSAJES_POR_ESTADO[ESTADO_POR_DEFECTO] ??
      'Ocurrió un error inesperado.'
    );
  }

  /**
   * Campos extra que un error de dominio decide exponer (**R28**).
   *
   * Solo para errores propios con estado < 500, por el mismo motivo que
   * `resolverMensaje`: son los únicos escritos y revisados aquí. Un 5xx nunca
   * adjunta datos, porque su causa es un defecto y su contenido, impredecible.
   *
   * Los detalles NO se registran en el log: el log lleva método, ruta y código
   * y nada más (Ley 1581 de 2012). Que un dato sea legítimo en la respuesta a
   * quien acaba de teclearlo no lo hace legítimo en un archivo persistente.
   */
  private resolverDetalles(
    exception: unknown,
    status: number,
  ): Record<string, unknown> {
    if (!(exception instanceof AppError) || status >= 500) return {};

    const detalles = (exception as { detalles?: unknown }).detalles;
    if (typeof detalles !== 'object' || detalles === null) return {};

    return { ...(detalles as Record<string, unknown>) };
  }
}
