-- Velvet: repair an older public.books table before running schema.sql.
-- Safe to run more than once. Run this in Supabase SQL Editor.
-- It adds the columns expected by the current application and copies values
-- from common legacy column names when they exist.

begin;

-- Repair the profile fields and owner role used by the current schema.
alter table if exists public.profiles
  add column if not exists email text not null default '',
  add column if not exists full_name text not null default '',
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists role text not null default 'customer',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Backfill blank profile emails from Supabase Auth without overwriting existing values.
update public.profiles p
set email = coalesce(nullif(p.email, ''), u.email, '')
from auth.users u
where u.id = p.id and coalesce(p.email, '') = '';

do $$
begin
  if to_regclass('public.profiles') is not null and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('customer','owner'));
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.books') is null then
    raise exception 'جدول public.books غير موجود. شغّل schema.sql أولاً إذا كانت هذه قاعدة بيانات جديدة.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='books' and column_name='title'
  ) then
    raise exception 'جدول books لا يحتوي على عمود title. أوقفنا الإصلاح حتى لا نغيّر أسماء كتبك بالتخمين.';
  end if;
end;
$$;

alter table public.books
  add column if not exists author text,
  add column if not exists pages integer,
  add column if not exists description text not null default '',
  add column if not exists cover_path text,
  add column if not exists stock_qty integer not null default 0,
  add column if not exists original_price numeric(12,2),
  add column if not exists sale_price numeric(12,2),
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- Copy author/pages/description/cover from common names used by older schemas.
update public.books b
set author = coalesce(
      nullif(b.author, ''),
      nullif(to_jsonb(b)->>'author_name', ''),
      nullif(to_jsonb(b)->>'writer', ''),
      nullif(to_jsonb(b)->>'writer_name', '')
    ),
    pages = coalesce(
      b.pages,
      nullif(regexp_replace(coalesce(to_jsonb(b)->>'page_count', to_jsonb(b)->>'pages_count'), '[^0-9-]', '', 'g'), '')::integer
    ),
    description = coalesce(
      nullif(b.description, ''),
      nullif(to_jsonb(b)->>'summary', ''),
      nullif(to_jsonb(b)->>'details', ''),
      nullif(to_jsonb(b)->>'book_description', ''),
      ''
    ),
    cover_path = coalesce(
      nullif(b.cover_path, ''),
      nullif(to_jsonb(b)->>'cover_url', ''),
      nullif(to_jsonb(b)->>'image_url', ''),
      nullif(to_jsonb(b)->>'cover_image', ''),
      nullif(to_jsonb(b)->>'image_path', ''),
      nullif(to_jsonb(b)->>'cover', '')
    );

-- Preserve legacy price values where a familiar column exists.
update public.books b
set original_price = coalesce(
      b.original_price,
      nullif(regexp_replace(coalesce(
        to_jsonb(b)->>'price',
        to_jsonb(b)->>'old_price',
        to_jsonb(b)->>'regular_price',
        to_jsonb(b)->>'base_price'
      ), '[^0-9.-]', '', 'g'), '')::numeric
    ),
    sale_price = coalesce(
      b.sale_price,
      nullif(regexp_replace(coalesce(
        to_jsonb(b)->>'discounted_price',
        to_jsonb(b)->>'discount_price',
        to_jsonb(b)->>'offer_price'
      ), '[^0-9.-]', '', 'g'), '')::numeric
    )
where b.original_price is null or b.sale_price is null;

-- Copy legacy stock only when the new stock_qty column is still its default zero.
update public.books b
set stock_qty = nullif(regexp_replace(coalesce(
      to_jsonb(b)->>'stock',
      to_jsonb(b)->>'quantity',
      to_jsonb(b)->>'qty',
      to_jsonb(b)->>'available_quantity'
    ), '[^0-9-]', '', 'g'), '')::integer
where b.stock_qty = 0
  and coalesce(
    to_jsonb(b)->>'stock',
    to_jsonb(b)->>'quantity',
    to_jsonb(b)->>'qty',
    to_jsonb(b)->>'available_quantity'
  ) is not null;

-- Bring the category columns used by the current storefront up to date too.
alter table if exists public.categories
  add column if not exists image_path text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

-- The schema file recreates this view with the repaired table columns.
drop view if exists public.book_catalog;

commit;

-- Review this result. Any book with missing/zero price must be edited in Admin
-- before it can be sold. The migration deliberately does not invent a price.
select
  count(*) as total_books,
  count(*) filter (where original_price is null or original_price <= 0) as books_missing_price,
  count(*) filter (where stock_qty = 0) as books_with_zero_stock
from public.books;
