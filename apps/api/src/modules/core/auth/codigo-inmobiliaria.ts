/**
 * El **código de inmobiliaria** (D-12, R73–R77).
 *
 * Desde **D-8** las identidades no se comparten entre inmobiliarias, así que el
 * correo dejó de identificar a nadie por sí solo: puede haber dos personas
 * distintas con el mismo correo en dos inmobiliarias. El login necesita, por
 * tanto, saber **en cuál** se entra, y el humano decidió (D-12) que ese
 * selector sea un código corto y legible (`arrendamientos-sion`) en vez del
 * NIT: se recuerda, no expone la lista de clientes del SaaS y **sirve tal cual
 * como subdominio** cuando llegue RF-INT2/RF-INT3, sin rehacer el login.
 *
 * De ese tercer motivo sale toda la validación: el formato es el de una
 * **etiqueta DNS válida**, que además cumple por construcción la regla de
 * `docs/conventions.md` de no usar tildes ni `ñ` en identificadores.
 *
 * **Este módulo no es la barrera.** La barrera es el `CHECK` de
 * `0007_identidad_por_tenant.sql`, que vale también para un alta hecha a mano
 * contra la base —hoy la única forma de dar de alta una inmobiliaria (R77,
 * PA-14)—. Lo de aquí sirve para rechazar con **400** una petición de login mal
 * formada antes de tocar la base de datos, y para que la regla esté escrita en
 * los dos sitios donde hace falta.
 */

/** Etiqueta DNS: minúsculas, dígitos y guiones interiores (R73). */
const FORMATO_CODIGO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const LONGITUD_MINIMA_CODIGO = 3;
export const LONGITUD_MAXIMA_CODIGO = 63;

/**
 * Subdominios de servicio que ninguna inmobiliaria puede reclamar (**R75**).
 *
 * No es una decisión de producto sino una salvaguarda técnica: si el código va
 * a ser un subdominio, permitir `www` hoy garantiza una colisión el día que se
 * despliegue RF-INT2. Reservarlos ahora cuesta esta lista; hacerlo después
 * cuesta renombrar a un cliente en producción.
 */
export const CODIGOS_RESERVADOS: readonly string[] = [
  'www',
  'api',
  'app',
  'admin',
  'portal',
  'static',
  'mail',
  'cdn',
];

/**
 * Normaliza el código recibido (**R74**): recorta espacios y pasa a minúsculas.
 *
 * Mismo criterio que `normalizarEmail`. Evita que `  Arrendamientos-Sion ` sea
 * rechazado por un espacio o una mayúscula, que es error de tecleo y no de
 * credenciales. Devuelve `null` si no queda nada utilizable, para que quien
 * llama distinga "no vino" de "vino algo".
 */
export function normalizarCodigoDeInmobiliaria(codigo: unknown): string | null {
  if (typeof codigo !== 'string') return null;
  const limpio = codigo.trim().toLowerCase();
  return limpio === '' ? null : limpio;
}

/** ¿El código ya normalizado cumple R73 y R75? */
export function esCodigoDeInmobiliariaValido(codigo: string): boolean {
  return (
    codigo.length >= LONGITUD_MINIMA_CODIGO &&
    codigo.length <= LONGITUD_MAXIMA_CODIGO &&
    FORMATO_CODIGO.test(codigo) &&
    !CODIGOS_RESERVADOS.includes(codigo)
  );
}
