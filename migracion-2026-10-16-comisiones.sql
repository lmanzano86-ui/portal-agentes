-- ============================================================
-- Migración 2026-10-16: sistema de comisiones por niveles
-- Portal de Agentes — New Age Professional Services
--
-- Niveles: 35% (inicio) → 3 ventas → 40% → 5 ventas → 50%
--          → 8 ventas → 60% → 10 ventas + 1 recluta con 3 ventas → 70%
-- Una "venta" = solicitud marcada como cerrada.
-- ============================================================

-- Quién reclutó a cada agente (para el requisito del 70%).
alter table public.perfiles
  add column if not exists reclutado_por uuid references public.perfiles(id);

-- El trigger ahora guarda quién creó la invitación como reclutador.
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
    insert into public.perfiles (id, nombre, rol, pais, comision_pct, reclutado_por)
    values (new.id, v_inv.nombre, v_inv.rol, v_inv.pais, v_inv.comision_pct, v_inv.creada_por)
    on conflict (id) do nothing;
    update public.invitaciones set usada = true, usada_en = now() where id = v_inv.id;
  else
    insert into public.perfiles (id, nombre, rol, activo)
    values (new.id, v_nombre, 'agente', false)
    on conflict (id) do nothing;
  end if;
  return new;
end; $$;

-- Estadísticas de un agente: ventas propias y reclutas con sus ventas.
-- Solo el propio agente, su director o el admin pueden verlas.
create or replace function public.stats_agente(p_agente_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ventas int;
  v_reclutas jsonb;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sin sesión.';
  end if;
  if v_uid <> p_agente_id and not public.es_admin_o_director() then
    raise exception 'Sin permiso.';
  end if;

  select count(*) into v_ventas
  from public.solicitudes
  where agente_id = p_agente_id and cerrado = true;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'ventas', coalesce(v.n, 0)
    )), '[]'::jsonb) into v_reclutas
  from public.perfiles p
  left join lateral (
    select count(*) as n from public.solicitudes s
    where s.agente_id = p.id and s.cerrado = true
  ) v on true
  where p.reclutado_por = p_agente_id and p.activo = true;

  return jsonb_build_object('ventas', v_ventas, 'reclutas', v_reclutas);
end;
$$;
grant execute on function public.stats_agente(uuid) to authenticated;

-- Para agentes existentes: si fueron creados por invitación, vincular reclutador.
-- (Solo vincula los que aún no tienen reclutado_por y tienen invitación usada con ese email.)
update public.perfiles p
set reclutado_por = i.creada_por
from public.invitaciones i
where p.reclutado_por is null
  and i.usada = true
  and lower(i.email) = lower((select email from auth.users u where u.id = p.id))
  and i.creada_por is not null
  and i.creada_por <> p.id;
