# Design — web_admin_panels

## 1. Estructura
```
apps/web/src/
├── api/cliente-web.ts        (transporte inyectable + sesión IndexedDB)
├── sesion/sesion.ts          (refresh token en IndexedDB, nunca localStorage)
├── vistas/
│   ├── Login.tsx             (R1)
│   ├── Dashboard.tsx         (R2)
│   ├── Inventarios.tsx       (R3: lista + ficha)
│   ├── Contratos.tsx         (R4: lista + vencimientos + acciones)
│   ├── Clientes.tsx          (R5)
│   ├── Plantillas.tsx        (R5)
│   └── Layout.tsx            (sidebar + indicador de sesión)
├── hooks/use-api.ts          (cargando/error/listo)
└── App.tsx                   (navegación por estado, PA-28-1)
```

## 2. Sesión (R1, R6)
`sesion.ts` guarda SOLO el refresh token en IndexedDB (`idb`); el access
token en memoria. `cliente-web.ts` replica el manejo 401 → refresh →
reintento → logout de #15.

## 3. Vistas y datos (R2–R5)
Cada vista usa un hook `useApi` con los tres estados de conventions.md.
Navegación por estado en App (PA-28-1); los botones de negocio llaman a la
API real (PA-28-3).

## 4. Archivos y tests
Cliente con transporte mock (registro de llamadas), tests de Login
(flujo feliz y rechazo), Dashboard (tarjetas por estado), Inventarios
(filtros y ficha), Contratos (vencimientos + renovar), Plantillas
(clonar). Sin cambios en el backend.
