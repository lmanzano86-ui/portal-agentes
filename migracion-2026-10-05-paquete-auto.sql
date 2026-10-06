-- Migración Portal de Agentes — 2026-10-05 (e)
-- Paquete automático: estado del paquete + URLs de materiales + acceso del sistema.
-- Pegar y ejecutar en el SQL Editor de Supabase.

-- 1) Columnas para el paquete automático
alter table public.solicitudes add column if not exists paquete_estado text default 'pendiente';
alter table public.solicitudes add column if not exists demo_url text;
alter table public.solicitudes add column if not exists propuesta_url text;
alter table public.solicitudes add column if not exists contrato_url text;

-- 2) Usuario de automatización (sistema@portal-agentes.local).
--    Solo puede LEER solicitudes y ACTUALIZAR las columnas del paquete.
--    No puede leer perfiles de agentes ni ninguna otra tabla.
drop policy if exists "automatizacion lee solicitudes" on public.solicitudes;
create policy "automatizacion lee solicitudes"
  on public.solicitudes for select
  using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');

drop policy if exists "automatizacion actualiza paquete" on public.solicitudes;
create policy "automatizacion actualiza paquete"
  on public.solicitudes for update
  using (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8')
  with check (auth.uid() = '1f2fc50d-ee2e-4ee8-8aa5-058272324bf8');
