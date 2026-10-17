-- ============================================================
-- Sección DEMOS administrable (2026-10-17)
-- Tablas: demos_paises (secciones por país) + demos (tarjetas)
-- Lectura: cualquier usuario autenticado
-- Escritura: solo admin / director
-- ============================================================

-- ---------- Secciones por país ----------
create table if not exists public.demos_paises (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.demos_paises enable row level security;

drop policy if exists "demos_paises lectura" on public.demos_paises;
create policy "demos_paises lectura"
  on public.demos_paises for select
  to authenticated
  using (true);

drop policy if exists "demos_paises escritura admin" on public.demos_paises;
create policy "demos_paises escritura admin"
  on public.demos_paises for all
  to authenticated
  using (public.es_admin_o_director())
  with check (public.es_admin_o_director());

-- ---------- Tarjetas de demos ----------
create table if not exists public.demos (
  id uuid primary key default gen_random_uuid(),
  pais_id uuid not null references public.demos_paises(id) on delete cascade,
  titulo text not null,
  descripcion text,
  url text not null,
  imagen_url text,
  orden int not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.demos enable row level security;

drop policy if exists "demos lectura" on public.demos;
create policy "demos lectura"
  on public.demos for select
  to authenticated
  using (true);

drop policy if exists "demos escritura admin" on public.demos;
create policy "demos escritura admin"
  on public.demos for all
  to authenticated
  using (public.es_admin_o_director())
  with check (public.es_admin_o_director());

-- ---------- Datos iniciales: países ----------
insert into public.demos_paises (nombre, orden)
values
  ('Estados Unidos', 1),
  ('España', 2),
  ('Brasil', 3),
  ('Países Bajos', 4)
on conflict (nombre) do nothing;
