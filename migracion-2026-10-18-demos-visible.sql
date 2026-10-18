-- Migración 2026-10-18: interruptor mostrar/ocultar en el frente (páginas públicas).
-- Solo se muestran las páginas con estado 'terminado' Y visible = true.

alter table public.demo_paginas
  add column if not exists visible boolean not null default true;
