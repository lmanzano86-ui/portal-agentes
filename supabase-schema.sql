-- Portal de Agentes — New Age Professional Services
-- Ejecutar en el SQL Editor de Supabase (una sola vez).

-- 1) Perfiles: un registro por agente (el login lo maneja Supabase Auth)
create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null default 'agente' check (rol in ('agente','director','admin')),
  activo boolean not null default true,
  pais text,                 -- país donde trabaja el agente (lo fija el admin en la invitación)
  comision_pct numeric,       -- % de comisión del agente (lo fija el admin en la invitación)
  created_at timestamptz default now()
);

-- 2) Solicitudes de negocios
create table solicitudes (
  id uuid primary key default gen_random_uuid(),
  agente_id uuid not null references perfiles(id),
  pais text not null,
  nombre_negocio text not null,
  giro text,
  direccion text,
  telefono text,
  horario text,
  servicios text,
  instagram text,
  facebook text,
  web_actual text,
  plan_interes text,
  notas text,
  estado text not null default 'nueva'
    check (estado in ('nueva','en revisión','demo lista','publicada')),
  created_at timestamptz default now()
);

-- 3) Invitaciones: el admin crea agentes desde el portal, sin SQL
create table invitaciones (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nombre text not null,
  rol text not null default 'agente' check (rol in ('agente','director')),
  pais text not null,            -- país donde trabajará el agente (lo elige el admin)
  comision_pct numeric not null,  -- % de comisión (lo elige el admin)
  token text not null unique,
  creada_por uuid references perfiles(id),
  usada boolean not null default false,
  usada_en timestamptz,
  created_at timestamptz default now()
);

-- 4) Seguridad: activar RLS
alter table perfiles enable row level security;
alter table solicitudes enable row level security;
alter table invitaciones enable row level security;

-- 4b) Funciones auxiliares SECURITY DEFINER (evitan recursión infinita:
--     las políticas no pueden consultar la misma tabla que protegen)
create or replace function public.es_admin()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

create or replace function public.es_admin_o_director()
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','director'));
$$;

-- 5) Políticas de perfiles
create policy "perfil propio legible"
  on perfiles for select using (auth.uid() = id);

create policy "admin ve perfiles"
  on perfiles for select using (public.es_admin_o_director());

create policy "admin gestiona perfiles"
  on perfiles for all using (public.es_admin());

-- 6) Políticas de solicitudes
create policy "agente crea solicitud propia"
  on solicitudes for insert with check (auth.uid() = agente_id);

create policy "agente ve sus solicitudes"
  on solicitudes for select using (auth.uid() = agente_id or public.es_admin_o_director());

create policy "admin actualiza estado"
  on solicitudes for update using (public.es_admin_o_director());

-- 7) Políticas de invitaciones (solo admin/director desde el portal)
create policy "admin gestiona invitaciones"
  on invitaciones for all using (public.es_admin_o_director());

-- 8) Validar una invitación por token (la usa la página pública de invitación)
create or replace function public.validar_invitacion(p_token text)
returns table (email text, nombre text, rol text, pais text, comision_pct numeric)
language sql security definer set search_path = public as $$
  select i.email, i.nombre, i.rol, i.pais, i.comision_pct
  from public.invitaciones i
  where i.token = p_token and i.usada = false;
$$;

-- 9) Al crear un usuario en Auth, crear su perfil automáticamente:
--    el primer usuario del sistema queda como admin (Lester);
--    los demás usan su invitación, o quedan inactivos pendientes de aprobación.
create or replace function public.manejar_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitaciones%rowtype;
  v_hay_admin boolean;
  v_nombre text;
begin
  v_nombre := coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1));
  select exists (select 1 from public.perfiles where rol = 'admin') into v_hay_admin;

  if not v_hay_admin then
    insert into public.perfiles (id, nombre, rol)
    values (new.id, v_nombre, 'admin')
    on conflict (id) do nothing;
    return new;
  end if;

  select * into v_inv from public.invitaciones
    where lower(email) = lower(new.email) and usada = false
    order by created_at desc limit 1;

  if found then
    insert into public.perfiles (id, nombre, rol, pais, comision_pct)
    values (new.id, v_inv.nombre, v_inv.rol, v_inv.pais, v_inv.comision_pct)
    on conflict (id) do nothing;
    update public.invitaciones set usada = true, usada_en = now() where id = v_inv.id;
  else
    insert into public.perfiles (id, nombre, rol, activo)
    values (new.id, v_nombre, 'agente', false)
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();

-- 10) Puesta en marcha (sin SQL adicional):
--    a) En Supabase → Authentication → Sign In / Providers → Email:
--       DESACTIVAR "Confirm email" (para que el registro sea inmediato).
--    b) Lester abre el portal, se registra con su correo y contraseña
--       → queda automáticamente como ADMIN (es el primer usuario).
--    c) Desde la sección "Agentes" del panel crea invitaciones para su equipo
--       y les envía el enlace por WhatsApp.

-- 11) MIGRACIÓN 2026-10-05 — país y comisión por agente.
--     Si ya ejecutaste este archivo antes (base en producción), pega y ejecuta
--     SOLO esta sección en el SQL Editor. Las invitaciones y perfiles viejos
--     quedan con pais/comision_pct en NULL (se ven como "sin asignar").
alter table public.perfiles add column if not exists pais text;
alter table public.perfiles add column if not exists comision_pct numeric;
alter table public.invitaciones add column if not exists pais text;
alter table public.invitaciones add column if not exists comision_pct numeric;

create or replace function public.validar_invitacion(p_token text)
returns table (email text, nombre text, rol text, pais text, comision_pct numeric)
language sql security definer set search_path = public as $$
  select i.email, i.nombre, i.rol, i.pais, i.comision_pct
  from public.invitaciones i
  where i.token = p_token and i.usada = false;
$$;

create or replace function public.manejar_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inv public.invitaciones%rowtype;
  v_hay_admin boolean;
  v_nombre text;
begin
  v_nombre := coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1));
  select exists (select 1 from public.perfiles where rol = 'admin') into v_hay_admin;

  if not v_hay_admin then
    insert into public.perfiles (id, nombre, rol)
    values (new.id, v_nombre, 'admin')
    on conflict (id) do nothing;
    return new;
  end if;

  select * into v_inv from public.invitaciones
    where lower(email) = lower(new.email) and usada = false
    order by created_at desc limit 1;

  if found then
    insert into public.perfiles (id, nombre, rol, pais, comision_pct)
    values (new.id, v_inv.nombre, v_inv.rol, v_inv.pais, v_inv.comision_pct)
    on conflict (id) do nothing;
    update public.invitaciones set usada = true, usada_en = now() where id = v_inv.id;
  else
    insert into public.perfiles (id, nombre, rol, activo)
    values (new.id, v_nombre, 'agente', false)
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.manejar_nuevo_usuario();
