# Arquitectura — Qué significa "hacer un buen trabajo" aquí

> Este archivo define las fronteras. Si un cambio las cruza, el reviewer lo
> rechaza. Las decisiones de fondo están en `docs/PRD.md` §11 (`D1`..`D10`);
> aquí se traducen a reglas ejecutables.

## Estilo: monolito modular (D1)

**Un solo despliegue, módulos con fronteras claras.** No microservicios.

```
apps/
├── api/                 # NestJS — el backend completo
│   └── src/modules/
│       ├── core/        # tenant, auth, usuarios, roles, auditoría
│       ├── properties/  # hoja de vida del inmueble, ciclo de vida
│       ├── workflows/   # motor de estados genérico
│       ├── inventories/ # módulo de inventarios
│       ├── contracts/   # templates, firma, renovaciones
│       └── ...          # un módulo por paquete comercial
├── web/                 # React — paneles internos y portales
└── pwa/                 # PWA de campo (offline)
packages/
├── types/               # tipos compartidos entre api y front
└── ...
```

### Reglas de frontera

- **Un módulo NO importa internals de otro.** Solo su API pública (el
  `*.service.ts` exportado por el módulo, o un contrato en `packages/types`).
- **`core/` no depende de ningún otro módulo.** Todos dependen de `core/`.
- **Un paquete comercial se puede desactivar** sin romper el resto. Si al
  quitar un módulo el sistema deja de compilar, la frontera está mal.
- **Nada de dependencias circulares entre módulos.**

## Capas dentro de un módulo

```
Controller  → valida entrada, no tiene lógica de negocio
   ↓
Service     → lógica de negocio, orquesta
   ↓
Repository  → único punto de acceso a datos
```

- **Ningún controller consulta la base de datos directamente.**
- **Ninguna consulta SQL vive fuera de la capa de repositorio.**
- Los DTOs de entrada se validan en el borde (class-validator / Zod).

## Multi-tenancy (D2) — la regla más importante

**El aislamiento lo fuerza PostgreSQL, no el código de aplicación.**

- Toda tabla de negocio lleva `tenant_id`.
- **Row-Level Security activo y `FORCE`** sobre esas tablas.
- El contexto de tenant se establece por conexión/transacción a partir del
  token, antes de cualquier consulta.
- **Una consulta sin contexto de tenant debe fallar**, no devolver todo.

> Si el aislamiento dependiera de que cada `WHERE` incluya `tenant_id`, un
> solo olvido filtra datos entre inmobiliarias. Por eso vive en el motor.

## Motor de workflows (D3)

Estados, transiciones, condiciones y responsables son **datos**, no `switch`
en el código. Si aparece una máquina de estados hardcodeada para un módulo
concreto, está mal: debe expresarse sobre el motor genérico.

## Almacenamiento (D6)

- **Fotos y documentos nunca en la base de datos.** Van a object storage
  (MinIO, S3-compatible).
- El acceso se hace con **URLs firmadas con expiración**, no con buckets
  públicos.
- En la base de datos se guarda la referencia y el hash, no el binario.

## API-first (D7, D8)

La API es el único punto de entrada a los datos. Web, PWA, portales
embebibles y —más adelante— el chatbot son **clientes** de la misma API.
Ninguno accede a la base de datos por su cuenta.

Consecuencias que se respetan desde ahora:
- CORS configurable **por dominio de tenant**, no abierto.
- Todo endpoint asume que puede ser llamado desde otro origen legítimo.

## Firma electrónica (D4)

Implementación propia (OTP + IP + timestamp + hash SHA-256), pero **detrás de
una interfaz abstracta**. Ningún módulo llama a la implementación concreta:
llaman al contrato. Así se puede enchufar un proveedor certificado después
sin tocar los módulos.

## Qué NO se hace en este proyecto

- ❌ Microservicios, colas entre servicios, o comunicación HTTP interna.
- ❌ ORMs con `synchronize: true` o esquema implícito. **Todo cambio de
  esquema es una migración versionada.**
- ❌ Lógica de negocio en el frontend que el backend no valide también.
- ❌ Acceso a datos que evite el repositorio o el RLS.
- ❌ Secretos en el código o en el repositorio.

## Cuando la arquitectura no alcanza

Si una feature no encaja en estas reglas, **no las rompas en silencio**:
documenta la tensión en el `design.md` de la feature y propón la excepción
explícitamente para que el humano decida.
