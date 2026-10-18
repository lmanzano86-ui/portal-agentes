-- Migración 2026-10-18: administración de Demos (secciones por país + páginas).
-- Las páginas públicas (Mis páginas y New Age Professional Services) leen de aquí al instante.

create table if not exists public.demo_secciones (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  nombre text not null,
  bandera text not null default '',
  titulo_panel text not null default '',
  subtitulo_panel text not null default '',
  titulo_publico text not null default '',
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.demo_paginas (
  id uuid primary key default gen_random_uuid(),
  seccion_id uuid not null references public.demo_secciones(id) on delete cascade,
  tag text not null default '',
  titulo text not null,
  descripcion text not null default '',
  url text unique not null,
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.demo_secciones enable row level security;
alter table public.demo_paginas enable row level security;

drop policy if exists "demos lectura publica" on public.demo_secciones;
create policy "demos lectura publica" on public.demo_secciones for select using (true);
drop policy if exists "demos paginas lectura publica" on public.demo_paginas;
create policy "demos paginas lectura publica" on public.demo_paginas for select using (true);
drop policy if exists "admin gestiona demo_secciones" on public.demo_secciones;
create policy "admin gestiona demo_secciones" on public.demo_secciones for all using (public.es_admin());
drop policy if exists "admin gestiona demo_paginas" on public.demo_paginas;
create policy "admin gestiona demo_paginas" on public.demo_paginas for all using (public.es_admin());

-- Usuario de automatización (scripts de Doky: agregar demos al publicar).
-- uuid: 1f2fc50d-ee2e-4ee8-8aa5-058272324bf8
drop policy if exists "auto insert demo_secciones" on public.demo_secciones;
create policy "auto insert demo_secciones" on public.demo_secciones for insert with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
drop policy if exists "auto update demo_secciones" on public.demo_secciones;
create policy "auto update demo_secciones" on public.demo_secciones for update using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8') with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
drop policy if exists "auto delete demo_secciones" on public.demo_secciones;
create policy "auto delete demo_secciones" on public.demo_secciones for delete using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8') with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
drop policy if exists "auto insert demo_paginas" on public.demo_paginas;
create policy "auto insert demo_paginas" on public.demo_paginas for insert with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
drop policy if exists "auto update demo_paginas" on public.demo_paginas;
create policy "auto update demo_paginas" on public.demo_paginas for update using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8') with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
drop policy if exists "auto delete demo_paginas" on public.demo_paginas;
create policy "auto delete demo_paginas" on public.demo_paginas for delete using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8') with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');

-- Seed de secciones
insert into public.demo_secciones (slug, nombre, bandera, titulo_panel, subtitulo_panel, titulo_publico, orden)
values
('lester', 'Mis páginas', '🇺🇸', '', '', '🇺🇸 Nuestros trabajos', 0),
('espana', 'España', '🇪🇸', '🇪🇸 Agente España', 'Páginas del agente en España', '🇪🇸 España', 1),
('brasil', 'Brasil', '🇧🇷', '🇧🇷 Agente Brasil', 'Páginas del agente en Brasil', '🇧🇷 Brasil', 2),
('paises_bajos', 'Países Bajos', '🇳🇱', '🇳🇱 Agente Países Bajos', 'Páginas del agente en Países Bajos', '🇳🇱 Países Bajos', 3),
('mexico', 'México', '🇲🇽', '🇲🇽 México', 'Demos en México', '🇲🇽 México', 4)
on conflict (slug) do nothing;

-- Seed de páginas (desde enlaces.json)
insert into public.demo_paginas (seccion_id, tag, titulo, descripcion, url, orden)
select s.id, v.tag, v.titulo, v.descripcion, v.url, v.orden
from public.demo_secciones s
join (values
('lester', 'Herramienta de ventas', 'Formulario de registro RHP', 'Registro de prospectos en mercados y eventos, con rifa y exportación a CSV.', 'https://lmanzano86-ui.github.io/formulario-rhp/formulario-registro-rhp.html', 0),
('lester', 'Herramienta de equipo', 'Carriers del equipo', 'Directorio de carriers y enlaces de contratación para tu equipo de agentes.', 'https://lmanzano86-ui.github.io/carriers-equipo/', 1),
('lester', 'Demo para cliente', 'Demo — Taquería El Faro', 'Ejemplo de página web para vender el paquete a restaurantes.', 'https://lmanzano86-ui.github.io/demo-taqueria/', 2),
('lester', 'Demo para cliente', 'Demo — Restaurante La Hacienda', 'Ejemplo de página web con datos reales del restaurante colombiano.', 'https://lmanzano86-ui.github.io/demo-hacienda/', 3),
('lester', 'Demo web', 'Demo Caribbean Twist', 'Restaurante cubano-dominicano en Tampa: demo moderna con fotos reales, menú, catering y QR.', 'https://lmanzano86-ui.github.io/demo-caribbeantwist/', 4),
('lester', 'Demo para cliente', 'Demo El Famoso Borinquen', 'Tienda latina en Tampa: comida caliente, carnicería y abarrotes.', 'https://lmanzano86-ui.github.io/demo-borinquen/', 5),
('lester', 'Demo para cliente', 'Bravo Supermarkets', 'Supermercado latino en Tampa: especiales semanales y circular.', 'https://lmanzano86-ui.github.io/bravo-supermarkets/', 6),
('lester', 'Demo para cliente', 'Demo Inkbass Tattoo', 'Estudio de tatuajes en Tampa: estilos, artista y reservas.', 'https://lmanzano86-ui.github.io/demo-inkbass/', 7),
('lester', 'Mi negocio', 'Páginas web para negocios', 'Presentación de mi servicio: planes, hosting privado y ejemplos.', 'https://lmanzano86-ui.github.io/paginas-web/', 8),
('lester', 'DEMO', 'Caribbean Club Market', 'Demo bilingüe ES/EN con especiales y ofertas', 'https://lmanzano86-ui.github.io/demo-caribbeanclub/', 9),
('lester', 'DEMO', 'Ultra Jewelry', 'Demo elegante marfil y dorado, bilingüe ES/EN', 'https://lmanzano86-ui.github.io/demo-ultrajewelry/', 10),
('lester', 'Mercado', 'Latin Fresh Market', 'Mercado latino · Tampa y Riverview', 'https://lmanzano86-ui.github.io/demo-latinfresh/', 11),
('lester', 'Salón de belleza', 'Lala''s Threading & Beauty Salon', 'Demo elegante: threading, cejas, maquillaje y más — Tampa FL', 'https://lmanzano86-ui.github.io/demo-lalasthreading/', 12),
('lester', 'Barbería', 'Willi Barbershop', 'Demo moderna: reserva en Booksy, precios reales — Tampa FL', 'https://lmanzano86-ui.github.io/demo-willibarbershop/', 13),
('lester', 'PANADERÍA', 'Maikel''s Florida Bakery', 'Demo moderna: pastelitos, sándwich cubano, cakes de encargo — Tampa FL', 'https://lmanzano86-ui.github.io/demo-maikelsbakery/', 14),
('lester', 'CONTRATISTA', 'KV Home Construction', 'Demo moderna: construcción, remodelaciones y piscinas — Tampa FL', 'https://lmanzano86-ui.github.io/demo-kvconstruction/', 15),
('lester', 'restaurante', 'El Señor de los Tacos', 'Demo moderna con pedidos por Square, fotos reales, menú y redes', 'https://lmanzano86-ui.github.io/demo-senortacos/', 16),
('lester', 'barberia', 'MVB Barbershop', 'Demo deportiva con equipo de 3 barberos, reservas en Booksy y fotos reales', 'https://lmanzano86-ui.github.io/demo-mvbbarbershop/', 17),
('lester', 'Tienda de mascotas', 'Zuri Palomas Pet Shop', 'Demo colorida para tienda de mascotas en Tampa', 'https://lmanzano86-ui.github.io/demo-zuripetshop/', 18),
('brasil', 'Padaria', 'Pane Defacci Padaria e Confeitaria', 'Demo trilingüe (PT/ES/EN) para padaria em Foz do Iguaçu, Brasil.', 'https://lmanzano86-ui.github.io/demo-panedefacci/', 0),
('brasil', 'Produtos naturais', 'Casa do Mel Foz do Iguaçu', 'Demo trilingüe (PT/ES/EN) para loja de produtos naturais em Foz do Iguaçu, Brasil.', 'https://lmanzano86-ui.github.io/demo-casadomel/', 1),
('lester', 'eeuu', 'Pete''s Place North & Liquor Store', 'Bar y licorera en Tampa — demo bilingüe ES/EN', 'https://lmanzano86-ui.github.io/demo-petes-place-north/', 19),
('brasil', 'brasil', 'Academia Plena Forma', 'Gimnasio en Foz do Iguaçu — demo trilingüe PT/ES/EN', 'https://lmanzano86-ui.github.io/demo-academia-plena-forma/', 2),
('paises_bajos', 'Demo Países Bajos', 'Demo — Banketbakkerij Van der Linde', 'Pastelería/heladería icónica de Ámsterdam (desde 1937). Demo en neerlandés.', 'https://lmanzano86-ui.github.io/demo-van-der-linde/', 0),
('paises_bajos', 'Países Bajos', 'Phone & more', 'Demo trilingüe (NL/ES/EN) — tienda de móviles, Damrak/Dam, Ámsterdam', 'https://lmanzano86-ui.github.io/demo-phone-more/', 1),
('lester', 'eeuu', 'Fenix Tattoo Gallery', 'Estudio de tatuajes en Tampa — propuesta de rediseño bilingüe ES/EN', 'https://lmanzano86-ui.github.io/demo-fenix-tattoo/', 20),
('lester', 'eeuu', 'Le Marqués Hair & Beauty', 'Salón de belleza premium en Tampa — demo de lujo bilingüe ES/EN con sistema de reservas', 'https://lmanzano86-ui.github.io/demo-lemarques/', 21),
('lester', 'eeuu', 'Le Marqués Hair & Beauty — versión oscura', 'Segunda propuesta: negro y dorado con el logo original + sistema de reservas', 'https://lmanzano86-ui.github.io/demo-lemarques-2/', 22),
('lester', 'eeuu', 'Angela''s Salon Dominicana', 'Salón de belleza dominicano en Tampa: demo bilingüe ES/EN con su logo real, sistema de agendar citas y WhatsApp', 'https://lmanzano86-ui.github.io/demo-angelas-salon/', 23),
('lester', 'eeuu', 'Carrollwood Pet Grooming', 'Peluquería canina y felina en Tampa: demo bilingüe ES/EN con sistema de reservas, QR de ubicación y reseñas', 'https://lmanzano86-ui.github.io/demo-carrollwood-pet-grooming/', 24),
('lester', 'eeuu', 'Bruni Luxury Events', 'Catering y decoración de eventos de lujo en Tampa — demo ES/EN', 'https://lmanzano86-ui.github.io/demo-bruni-luxury-events/', 25),
('lester', 'eeuu', 'Hector''s NY Pizza', 'Pizzería estilo NY en Carrollwood, Tampa — rediseño con menú, especiales y reservas', 'https://lmanzano86-ui.github.io/demo-hectors-ny-pizza/', 26),
('lester', 'EE.UU.', 'Wulfaven Brewing Company', 'Cervecería artesanal familiar en Carrollwood, Tampa — rediseño', 'https://lmanzano86-ui.github.io/demo-wulfaven-brewing/', 27),
('mexico', 'México', 'Maya Travel Company', 'Tours y viajes en Cancún', 'https://lmanzano86-ui.github.io/demo-mayatravel/', 0),
('lester', 'EE.UU.', 'Balmaseda & Associates', 'Boutique luxury real estate — Tampa', 'https://lmanzano86-ui.github.io/demo-balmaseda/', 28),
('lester', 'EE.UU.', 'AC Blanco', 'Air conditioning & repair — Tampa, FL', 'https://lmanzano86-ui.github.io/demo-blancoac/', 29),
('brasil', 'Brasil', 'Fortis Personal Studio', 'Treino personalizado em Foz do Iguaçu', 'https://lmanzano86-ui.github.io/demo-fortis/', 3),
('lester', 'EE.UU.', 'Mile-Express', 'Envíos de dinero y carga — Tampa, FL', 'https://lmanzano86-ui.github.io/demo-mileexpress/', 30),
('lester', 'EE.UU.', 'Premier Installation Services', 'Office furniture installation — Wesley Chapel, FL', 'https://lmanzano86-ui.github.io/demo-premierinstall/', 31),
('lester', 'EE.UU.', 'Quality Network Technologies', 'Low voltage systems — Tampa, FL', 'https://lmanzano86-ui.github.io/demo-qualitynetwork/', 32),
('lester', 'EE.UU.', 'La Vita Nuova', 'Sport bar & grill latino en Tampa — demo ES/EN', 'https://lmanzano86-ui.github.io/demo-lavitannuova/', 33),
('lester', 'EE.UU.', 'La Semilla Bakery', 'Panadería colombiana en Tampa — demo ES/EN', 'https://lmanzano86-ui.github.io/demo-lasemilla/', 34),
('lester', 'EE.UU.', 'Iglesia Casa del Espíritu Santo', 'Iglesia en Tampa — demo ES/EN', 'https://lmanzano86-ui.github.io/demo-iglesiaes/', 35)
) as v(seccion_slug, tag, titulo, descripcion, url, orden)
  on v.seccion_slug = s.slug
on conflict (url) do nothing;
