-- Migración Portal de Agentes — 2026-10-05 (b)
-- Agrega el enlace del perfil de Google a las solicitudes.
-- Pegar y ejecutar en el SQL Editor de Supabase.
alter table public.solicitudes add column if not exists enlace_google text;
