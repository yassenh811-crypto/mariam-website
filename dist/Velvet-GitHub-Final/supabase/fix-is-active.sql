-- Velvet migration: add the visibility flag used by the catalogue and admin UI.
-- Safe to run more than once. Run this BEFORE re-running supabase/schema.sql.

alter table if exists public.books
  add column if not exists is_active boolean not null default true;

alter table if exists public.categories
  add column if not exists is_active boolean not null default true;
