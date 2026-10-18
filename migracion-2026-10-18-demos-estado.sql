-- Migración 2026-10-18: estados del demo (Hecho / En desarrollo / Pendiente por el dueño).
-- Solo los demos "terminado" se muestran en las páginas públicas.

alter table public.demo_paginas
  add column if not exists estado text not null default 'terminado';

-- Valores válidos: 'terminado' | 'en_desarrollo' | 'pendiente_dueno'
