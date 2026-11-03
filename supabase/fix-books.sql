-- =====================================================================
-- fix-books.sql — إصلاح إضافة الكتب/التصنيفات مع الجداول القديمة
-- شغّله في SQL Editor (بعد schema.sql). آمن لإعادة التشغيل.
-- =====================================================================

-- 1) أعمدة مطلوبة للموقع
alter table public.books add column if not exists author          text;
alter table public.books add column if not exists pages           integer;
alter table public.books add column if not exists description     text not null default '';
alter table public.books add column if not exists original_price  numeric(10,2);
alter table public.books add column if not exists sale_price      numeric(10,2);
alter table public.books add column if not exists stock_qty       integer not null default 0;
alter table public.books add column if not exists cover_path      text;
alter table public.books add column if not exists is_active       boolean not null default true;
alter table public.books add column if not exists created_at      timestamptz not null default now();

alter table public.categories add column if not exists image_path text;
alter table public.categories add column if not exists is_active  boolean not null default true;
alter table public.categories add column if not exists created_at timestamptz not null default now();

-- 2) أي عمود قديم إجباري بدون قيمة افتراضية والموقع لا يرسله: نجعله اختيارياً
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('books','categories','book_categories','store_settings','profiles','wishlist')
      and c.is_nullable = 'NO'
      and c.column_default is null
      and c.is_identity = 'NO'
      and (c.table_name, c.column_name) not in (
        ('books','id'),('books','title'),('books','original_price'),
        ('categories','id'),('categories','name'),
        ('book_categories','book_id'),('book_categories','category_id'),
        ('store_settings','key'),
        ('profiles','id'),
        ('wishlist','user_id'),('wishlist','book_id')
      )
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
  end loop;
end $$;

-- 3) اختبار: إدخال كتاب وتصنيف تجريبيين ثم حذفهما.
--    لو ظهر خطأ هنا فهو نفس الخطأ الذي يمنع الإضافة من الموقع، ابعته لي.
do $$
declare
  v_book uuid;
  v_cat  uuid;
begin
  insert into public.books (title, author, pages, description, original_price, sale_price, stock_qty, is_active)
  values ('__اختبار__', null, null, '', 100, null, 5, true)
  returning id into v_book;

  insert into public.categories (name) values ('__اختبار__') returning id into v_cat;
  insert into public.book_categories (book_id, category_id) values (v_book, v_cat);

  delete from public.book_categories where book_id = v_book;
  delete from public.categories where id = v_cat;
  delete from public.books where id = v_book;
end $$;

notify pgrst, 'reload schema';

-- 4) تشخيص: أعمدة جدول books الحالية وهل هي إجبارية
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'books'
order by ordinal_position;
