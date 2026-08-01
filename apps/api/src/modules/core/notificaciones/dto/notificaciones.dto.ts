import { CANALES_NOTIFICACION } from '@inmobiliaria/types';
import { z } from 'zod';

/** `POST /notificaciones` (R8) — envío manual. */
export const esquemaEnviarNotificacion = z
  .object({
    destinatario: z.string().trim().min(1).max(320),
    canal: z.enum(CANALES_NOTIFICACION).optional(),
    contenido: z.record(z.unknown()).default({}),
  })
  .strict();

export type EnviarNotificacionDto = z.infer<typeof esquemaEnviarNotificacion>;

/** `POST /notificaciones/programadas` (R11). */
export const esquemaProgramarNotificacion = z
  .object({
    programada_para: z.string().datetime(),
    destinatario: z.string().trim().min(1).max(320),
    canal: z.enum(CANALES_NOTIFICACION),
    plantilla: z.string().trim().min(1).max(120).optional(),
    contenido: z.record(z.unknown()).default({}),
    entidad_tipo: z.string().trim().min(1).max(60).optional(),
    entidad_id: z.string().uuid().optional(),
  })
  .strict();

export type ProgramarNotificacionDto = z.infer<typeof esquemaProgramarNotificacion>;
