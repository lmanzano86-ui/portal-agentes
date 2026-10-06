-- Migración Portal de Agentes — 2026-10-05 (d)
-- Guarda el nombre del agente en cada solicitud.
-- Pegar y ejecutar en el SQL Editor de Supabase.
alter table public.solicitudes add column if not exists agente_nombre text;
