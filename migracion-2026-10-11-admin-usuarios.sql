-- ============================================================
-- Migración 2026-10-11: el administrador crea y edita usuarios
-- directamente desde el panel (sin depender del enlace de invitación).
--
-- CÓMO APLICARLA (Lester, en Supabase → SQL Editor):
--   1) Ejecuta el BLOQUE 1 completo.
--   2) Ejecuta el BLOQUE 2 después de pegar tu service_role key
--      (Dashboard → Project Settings → API → service_role).
--      Esa clave NUNCA va en el código del portal: queda guardada
--      en el Vault de la base de datos, solo legible por el servidor.
--   3) Además, para que el flujo de invitación funcione:
--      Dashboard → Authentication → Sign In / Sign Up → desactiva
--      "Confirm email".
-- ============================================================

-- ---------- BLOQUE 1: extensión y funciones ----------
create extension if not exists pg_net with schema extensions;

-- Llamada genérica a la Auth Admin API. Solo el admin puede usarla.
-- Devuelve el request_id; el resultado se lee con admin_auth_result().
create or replace function public.admin_auth_request(p_method text, p_path text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, extensions, net
as $$
declare
  v_key text;
  v_req bigint;
  v_url text := 'https://ildviocjmqcyfknzlyrm.supabase.co' || p_path;
begin
  if not public.es_admin() then
    raise exception 'Sin permiso: solo el administrador.';
  end if;
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'portal_service_role' limit 1;
  if v_key is null then
    raise exception 'Falta configurar la clave service_role: ejecuta el BLOQUE 2 de esta migración.';
  end if;
  if upper(p_method) = 'POST' then
    select net.http_post(url := v_url,
      headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := p_body) into v_req;
  elsif upper(p_method) = 'PUT' then
    select net.http_put(url := v_url,
      headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := p_body) into v_req;
  elsif upper(p_method) = 'DELETE' then
    select net.http_delete(url := v_url,
      headers := jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key)) into v_req;
  else
    raise exception 'Método no soportado: %', p_method;
  end if;
  return v_req;
end;
$$;

-- Lee el resultado de una llamada anterior. Devuelve {"pending": true}
-- si aún no hay respuesta, o {"status": n, "body": {...}}.
create or replace function public.admin_auth_result(p_request_id bigint)
returns jsonb
language plpgsql security definer set search_path = public, extensions, net
as $$
declare
  r record;
begin
  if not public.es_admin() then
    raise exception 'Sin permiso: solo el administrador.';
  end if;
  select status_code, content into r from net._http_response where id = p_request_id;
  if not found then
    return jsonb_build_object('pending', true);
  end if;
  delete from net._http_response where id = p_request_id;
  return jsonb_build_object('status', r.status_code, 'body', r.content::jsonb);
end;
$$;

-- Lista del equipo con correo (el correo vive en auth.users).
-- Excluye las cuentas técnicas @portal-agentes.local.
create or replace function public.admin_listar_agentes()
returns table (id uuid, email text, nombre text, rol text, activo boolean,
               pais text, comision_pct numeric, created_at timestamptz)
language sql security definer set search_path = public
as $$
  select p.id, u.email::text, p.nombre, p.rol, p.activo, p.pais, p.comision_pct, p.created_at
  from public.perfiles p
  join auth.users u on u.id = p.id
  where u.email not like '%@portal-agentes.local'
  order by p.created_at;
$$;

grant execute on function public.admin_auth_request(text, text, jsonb) to authenticated;
grant execute on function public.admin_auth_result(bigint) to authenticated;
grant execute on function public.admin_listar_agentes() to authenticated;

-- ---------- BLOQUE 2: guardar la service_role en el Vault ----------
-- Pega tu service_role key entre las comillas simples y ejecuta.
-- (Dashboard → Project Settings → API → "service_role" → Reveal)
--
-- select vault.create_secret('PEGA_AQUI_TU_SERVICE_ROLE_KEY', 'portal_service_role',
--   'Service role para crear usuarios desde el panel del portal');
--
-- Para verificar que quedó guardada (no muestra el valor):
-- select name, created_at from vault.secrets where name = 'portal_service_role';
