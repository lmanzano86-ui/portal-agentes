-- Migración 2026-10-16: parches de seguridad y funciones rotas
-- PARCHE S1 (CRÍTICO): admin_listar_agentes sin control
create or replace function public.admin_listar_agentes()
returns table (id uuid, email text, nombre text, rol text, activo boolean,
               pais text, comision_pct numeric, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Sin permiso: solo el administrador.';
  end if;
  return query
    select p.id, u.email::text, p.nombre, p.rol, p.activo, p.pais, p.comision_pct, p.created_at
    from public.perfiles p
    join auth.users u on u.id = p.id
    where u.email not like '%@portal-agentes.local'
    order by p.created_at;
end;
$$;
-- FIX B3: columnas de cierre
alter table public.solicitudes
  add column if not exists cerrado boolean not null default false,
  add column if not exists cerrado_en timestamptz;
-- FIX S4: expiración de invitaciones (72h)
alter table public.invitaciones
  add column if not exists expira_en timestamptz not null default (now() + interval '72 hours'),
  add column if not exists usada_en timestamptz;
update public.invitaciones set expira_en = created_at + interval '72 hours' where expira_en is null;
-- F2: tabla de auditoría
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.perfiles(id),
  accion text not null, tabla text not null, registro_id text,
  antes jsonb, despues jsonb, created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
drop policy if exists "audit solo admin" on public.audit_log;
create policy "audit solo admin" on public.audit_log for all using (public.es_admin()) with check (public.es_admin());
alter table public.solicitudes add column if not exists updated_at timestamptz not null default now();
create or replace function public.tocar_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_solicitudes_updated_at on public.solicitudes;
create trigger trg_solicitudes_updated_at before update on public.solicitudes for each row execute function public.tocar_updated_at();
-- FIX B1: función hay_admin
create or replace function public.hay_admin() returns boolean language sql security definer set search_path = public as $$ select exists (select 1 from public.perfiles where rol = 'admin' limit 1); $$;
grant execute on function public.hay_admin() to anon, authenticated;
-- S5: el estado solo lo cambia director/admin
drop policy if exists "agente actualiza propia solicitud" on public.solicitudes;
create policy "agente actualiza propia solicitud" on public.solicitudes for update using (auth.uid() = agente_id) with check (auth.uid() = agente_id and estado = (select estado from public.solicitudes where id = solicitudes.id) and cerrado = (select cerrado from public.solicitudes where id = solicitudes.id));
drop policy if exists "director_admin cambian estado" on public.solicitudes;
create policy "director_admin cambian estado" on public.solicitudes for update using (public.es_admin_o_director()) with check (public.es_admin_o_director());
