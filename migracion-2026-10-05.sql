-- Migración Portal de Agentes — 2026-10-05
-- Pegar y ejecutar TODO este archivo en el SQL Editor de Supabase.

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
