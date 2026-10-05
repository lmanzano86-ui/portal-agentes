# Portal de Agentes — New Age Professional Services

Fase 1 del sistema: los agentes entran con su usuario y contraseña, llenan los
datos del negocio y la solicitud queda guardada para que el equipo de producción
genere la página demo, la propuesta de precios y el contrato.

## Estructura

- `index.html` — Agent Login
- `panel.html` — panel del agente: formulario de nueva solicitud + lista de solicitudes
- `css/estilos.css` — estilos (marca New Age: oscuro + dorado)
- `js/config.js` — URL y clave de Supabase (vacías = modo vista previa)
- `js/app.js` — login, sesión y solicitudes (Supabase o localStorage en demo)
- `supabase-schema.sql` — tablas y seguridad para ejecutar en Supabase

## Puesta en marcha (una sola vez)

1. Crear proyecto gratis en https://supabase.com (botón "Start your project").
2. En el SQL Editor, pegar y ejecutar `supabase-schema.sql`.
3. En Authentication → Sign In / Providers → Email: **desactivar "Confirm email"**.
4. En Project Settings → API, copiar la URL y la clave `anon`.
5. Pegarlas en `js/config.js` (SUPABASE_URL y SUPABASE_ANON_KEY).
6. Publicar esta carpeta en GitHub Pages (repo `portal-agentes`).
7. Agregar el botón "Agent Login" en la página principal → apunta a
   https://lmanzano86-ui.github.io/portal-agentes/

## Cómo entra Lester (admin)

Lester abre el portal y se registra con su correo y contraseña: como es el
primer usuario del sistema, queda automáticamente como **admin** con todos los
permisos. Sin SQL, sin dashboard.

## Cómo se crean los agentes (lo hace Lester desde el portal)

1. En el panel, sección **Agentes** → llena nombre, correo y rol → "Crear invitación".
2. El portal genera un enlace único. Lester se lo envía al agente por WhatsApp.
3. El agente abre el enlace, crea su contraseña y entra. Listo.
4. Para desactivar a alguien: botón "Desactivar" en su tarjeta.
5. Para revocar una invitación sin usar: botón "Revocar".

## Roles

- **agente**: crea solicitudes y ve solo las suyas.
- **director**: ve todas las solicitudes, cambia su estado y crea agentes.
- **admin** (Lester): todo + activa/desactiva cuentas.

## Contador de comisiones (fase futura)

Cada solicitud guarda `agente_id` y `created_at`: con eso se calcula
automáticamente el nivel de comisión del mes (35/40/45/50%) sin trabajo manual.
