-- Migración Portal de Agentes — 2026-10-05 (c)
-- Agrega el estado de la página web a las solicitudes.
-- Pegar y ejecutar en el SQL Editor de Supabase.
alter table public.solicitudes add column if not exists estado_web text;
