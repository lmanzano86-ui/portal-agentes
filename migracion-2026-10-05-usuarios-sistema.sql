-- Migración Portal de Agentes — 2026-10-05 (f)
-- Gestión de usuarios de sistema SOLO desde la cuenta de Lester.
-- Pegar y ejecutar en el SQL Editor de Supabase.

-- Lista los usuarios técnicos (@portal-agentes.local). Solo Lester.
create or replace function public.listar_usuarios_sistema()
returns table (id uuid, email text, nombre text, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() <> '3def5e8b-ec08-4f3c-84a7-20b34de859d8' then
    raise exception 'No autorizado';
  end if;
  return query
    select u.id, u.email::text, (u.raw_user_meta_data->>'nombre')::text, u.created_at
    from auth.users u
    where u.email like '%@portal-agentes.local'
    order by u.created_at;
end;
$$;

-- Elimina un usuario de sistema. Solo Lester, y solo @portal-agentes.local
-- (nunca un agente real). Borrar el usuario elimina también su fila de perfiles.
create or replace function public.eliminar_usuario_sistema(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if auth.uid() <> '3def5e8b-ec08-4f3c-84a7-20b34de859d8' then
    raise exception 'No autorizado';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'El usuario no existe';
  end if;
  if v_email not like '%@portal-agentes.local' then
    raise exception 'Solo se pueden eliminar usuarios de sistema';
  end if;
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function public.listar_usuarios_sistema() to authenticated;
grant execute on function public.eliminar_usuario_sistema(uuid) to authenticated;
