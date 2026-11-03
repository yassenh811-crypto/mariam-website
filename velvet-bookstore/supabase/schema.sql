-- =====================================================================
-- Velvet Bookstore — Supabase schema (كامل)
-- الاستخدام: Supabase → SQL Editor → New query → الصق الملف كله → Run
-- الملف آمن لإعادة التشغيل أكثر من مرة (idempotent).
-- بعد التشغيل: شغّل supabase/owner-setup.sql لتعيين حساب المالك.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1) الملفات الشخصية + الصلاحيات
-- =====================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  address     text,
  role        text not null default 'customer',
  created_at  timestamptz not null default now()
);
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists phone      text;
alter table public.profiles add column if not exists address    text;
alter table public.profiles add column if not exists role       text not null default 'customer';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('customer','owner')) not valid;

-- هل المستخدم الحالي هو المالك؟
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

-- إنشاء ملف شخصي تلقائياً عند التسجيل
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ملفات للحسابات الموجودة قبل تشغيل هذا الملف
insert into public.profiles (id, email, full_name, phone)
select id, email, coalesce(raw_user_meta_data->>'full_name', ''), coalesce(raw_user_meta_data->>'phone', '')
from auth.users
on conflict (id) do nothing;

-- منع العميل من ترقية نفسه إلى مالك
create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_owner() then
    raise exception 'لا يمكن تغيير الصلاحية.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- =====================================================================
-- 2) التصنيفات والكتب
-- =====================================================================
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image_path  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.categories add column if not exists image_path text;
alter table public.categories add column if not exists is_active  boolean not null default true;
alter table public.categories add column if not exists created_at timestamptz not null default now();

create table if not exists public.books (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  author          text,
  pages           integer check (pages is null or pages > 0),
  description     text not null default '',
  original_price  numeric(10,2) not null check (original_price > 0),
  sale_price      numeric(10,2) check (sale_price is null or (sale_price > 0 and sale_price <= original_price)),
  stock_qty       integer not null default 0 check (stock_qty >= 0),
  cover_path      text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.books add column if not exists author          text;
alter table public.books add column if not exists pages           integer;
alter table public.books add column if not exists description     text not null default '';
alter table public.books add column if not exists sale_price      numeric(10,2);
alter table public.books add column if not exists stock_qty       integer not null default 0;
alter table public.books add column if not exists cover_path      text;
alter table public.books add column if not exists is_active       boolean not null default true;
alter table public.books add column if not exists created_at      timestamptz not null default now();

create table if not exists public.book_categories (
  book_id      uuid not null references public.books(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  primary key (book_id, category_id)
);
create index if not exists book_categories_category_idx on public.book_categories (category_id);

-- كتالوج الكتب المعروض للزوار (حالة المخزون + "أضيف حديثاً" آخر 7 أيام)
drop view if exists public.book_catalog;
create view public.book_catalog as
select
  b.*,
  case
    when b.stock_qty <= 0 then 'out'
    when b.stock_qty = 1  then 'last'
    when b.stock_qty <= 3 then 'low'
    else 'available'
  end as stock_status,
  (b.created_at >= now() - interval '7 days') as is_new
from public.books b
where b.is_active = true;

-- =====================================================================
-- 3) المراجعات وقائمة الأمنيات
-- =====================================================================
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.books(id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  comment       text not null default '',
  is_published  boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint reviews_one_per_user unique (book_id, user_id)
);

drop view if exists public.public_reviews;
create view public.public_reviews as
select
  r.id,
  r.book_id,
  r.rating,
  r.comment,
  r.is_published,
  r.created_at,
  nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') as display_name,
  b.title as book_title
from public.reviews r
join public.books b on b.id = r.book_id
left join public.profiles p on p.id = r.user_id
where r.is_published = true and b.is_active = true;

drop view if exists public.book_review_stats;
create view public.book_review_stats as
select
  book_id,
  round(avg(rating)::numeric, 1) as average_rating,
  count(*)::integer as review_count
from public.reviews
where is_published = true
group by book_id;

create table if not exists public.wishlist (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  book_id     uuid not null references public.books(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, book_id)
);

-- =====================================================================
-- 4) الطلبات والدفع والمحادثات
-- =====================================================================
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  order_code        text not null unique,
  user_id           uuid not null references public.profiles(id) on delete restrict,
  customer_name     text,
  phone             text,
  shipping_address  text,
  subtotal          numeric(10,2) not null default 0,
  discount_total    numeric(10,2) not null default 0,
  total             numeric(10,2) not null default 0,
  payment_method    text not null check (payment_method in ('cod','instapay','vodafone_cash')),
  payment_status    text not null default 'pending',
  status            text not null default 'new'
                    check (status in ('new','awaiting_payment','payment_review','paid','preparing','shipped','delivered','cancelled')),
  created_at        timestamptz not null default now()
);
create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status);

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,
  book_id         uuid references public.books(id) on delete set null,
  title_snapshot  text not null,
  quantity        integer not null check (quantity > 0),
  unit_price      numeric(10,2) not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.payments (
  id                     uuid primary key default gen_random_uuid(),
  order_id               uuid not null unique references public.orders(id) on delete cascade,
  method                 text,
  amount                 numeric(10,2),
  proof_path             text,
  transaction_reference  text,
  status                 text not null default 'pending'
                         check (status in ('pending','submitted','approved','rejected')),
  reviewed_by            uuid references public.profiles(id),
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now()
);

create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references public.orders(id) on delete cascade,
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  sender_id        uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body             text not null check (char_length(trim(body)) between 1 and 2000),
  created_at       timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

-- =====================================================================
-- 5) الزيارات وإعدادات المتجر
-- =====================================================================
create table if not exists public.visits (
  id           bigint generated always as identity primary key,
  visitor_key  text not null check (char_length(visitor_key) between 8 and 80),
  visited_on   date not null default ((now() at time zone 'utc')::date),
  created_at   timestamptz not null default now(),
  constraint visits_once_per_day unique (visitor_key, visited_on)
);

create table if not exists public.store_settings (
  key         text primary key,
  value       text not null default '',
  is_public   boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.store_settings add column if not exists is_public  boolean not null default true;
alter table public.store_settings add column if not exists updated_at  timestamptz not null default now();

-- القيم الافتراضية: تعمل سواء كان عمود value من نوع text أو jsonb
do $$
declare
  v_type text;
  v_key  text;
  v_val  text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'store_settings' and column_name = 'value';

  for v_key, v_val in
    select * from (values
      ('whatsapp_number',      ''),
      ('instapay_details',     ''),
      ('vodafone_cash_number', ''),
      ('facebook_url',         ''),
      ('tiktok_url',           ''),
      ('instagram_url',        ''),
      ('return_policy',
       'الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.')
    ) as s(k, v)
  loop
    if v_type = 'jsonb' then
      execute 'insert into public.store_settings (key, value, is_public) values ($1, to_jsonb($2::text), true) on conflict (key) do nothing'
        using v_key, v_val;
    elsif v_type = 'json' then
      execute 'insert into public.store_settings (key, value, is_public) values ($1, to_json($2::text), true) on conflict (key) do nothing'
        using v_key, v_val;
    else
      execute 'insert into public.store_settings (key, value, is_public) values ($1, $2, true) on conflict (key) do nothing'
        using v_key, v_val;
    end if;
  end loop;
end $$;

-- =====================================================================
-- 5.5) توافق مع جداول قديمة: إضافة الأعمدة الناقصة وتخفيف قيود الأعمدة القديمة
-- =====================================================================
alter table public.orders add column if not exists customer_name     text;
alter table public.orders add column if not exists phone             text;
alter table public.orders add column if not exists shipping_address  text;
alter table public.orders add column if not exists subtotal          numeric(10,2) not null default 0;
alter table public.orders add column if not exists discount_total    numeric(10,2) not null default 0;
alter table public.orders add column if not exists payment_status    text not null default 'pending';

alter table public.order_items add column if not exists book_id         uuid references public.books(id) on delete set null;
alter table public.order_items add column if not exists title_snapshot  text;
alter table public.order_items add column if not exists unit_price      numeric(10,2);

alter table public.payments add column if not exists method                 text;
alter table public.payments add column if not exists amount                 numeric(10,2);
alter table public.payments add column if not exists proof_path             text;
alter table public.payments add column if not exists transaction_reference  text;
alter table public.payments add column if not exists status                 text not null default 'pending';
alter table public.payments add column if not exists reviewed_by            uuid;
alter table public.payments add column if not exists reviewed_at            timestamptz;

alter table public.conversations add column if not exists customer_id uuid references public.profiles(id) on delete cascade;
alter table public.conversations add column if not exists created_at  timestamptz not null default now();
update public.conversations c
   set customer_id = o.user_id
  from public.orders o
 where o.id = c.order_id and c.customer_id is null;

alter table public.messages add column if not exists sender_id  uuid default auth.uid();
alter table public.messages add column if not exists created_at timestamptz not null default now();

alter table public.visits add column if not exists visited_on date not null default ((now() at time zone 'utc')::date);

-- فهارس فريدة مطلوبة لـ on conflict
create unique index if not exists payments_order_unique       on public.payments (order_id);
create unique index if not exists conversations_order_unique  on public.conversations (order_id);

-- أي عمود قديم إجباري بدون قيمة افتراضية ولا نعرفه: نجعله اختيارياً حتى لا تفشل الإدخالات الجديدة
do $$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('orders','order_items','payments','conversations','messages','visits','reviews','wishlist')
      and c.is_nullable = 'NO'
      and c.column_default is null
      and c.is_identity = 'NO'
      and (c.table_name, c.column_name) not in (
        ('orders','id'),('orders','order_code'),('orders','user_id'),('orders','payment_method'),
        ('order_items','id'),('order_items','order_id'),('order_items','quantity'),
        ('payments','id'),('payments','order_id'),
        ('conversations','id'),('conversations','order_id'),
        ('messages','id'),('messages','conversation_id'),('messages','body'),
        ('visits','visitor_key'),
        ('reviews','id'),('reviews','book_id'),('reviews','rating'),
        ('wishlist','user_id'),('wishlist','book_id')
      )
  loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
  end loop;
end $$;

-- =====================================================================
-- 6) الدوال (RPC)
-- =====================================================================

-- حذف أي نسخ قديمة من الدوال (بأي توقيع) قبل إنشائها من جديد
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_order','submit_payment_proof','admin_update_order_status','admin_review_payment','record_visit')
  loop
    execute 'drop function if exists ' || r.sig::text;
  end loop;
end $$;

-- تسجيل زيارة فريدة يومياً
create or replace function public.record_visit(p_visitor_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor_key is null or char_length(p_visitor_key) not between 8 and 80 then
    return;
  end if;
  insert into public.visits (visitor_key) values (p_visitor_key)
  on conflict (visitor_key, visited_on) do nothing;
end;
$$;

-- إنشاء طلب: الأسعار والمخزون تُحسب من قاعدة البيانات وليس من المتصفح
create or replace function public.create_order(
  p_items             jsonb,
  p_payment_method    text,
  p_shipping_address  text,
  p_phone             text,
  p_customer_name     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_item      jsonb;
  v_book      public.books%rowtype;
  v_qty       integer;
  v_price     numeric;
  v_subtotal  numeric := 0;
  v_total     numeric := 0;
  v_order_id  uuid;
  v_code      text;
  v_status    text;
  v_pay_state text;
begin
  if v_uid is null then
    raise exception 'سجّل الدخول أولاً لإتمام الطلب.';
  end if;
  if p_payment_method not in ('cod','instapay','vodafone_cash') then
    raise exception 'طريقة الدفع غير صالحة.';
  end if;
  if coalesce(trim(p_customer_name), '') = ''
     or coalesce(trim(p_phone), '') = ''
     or coalesce(trim(p_shipping_address), '') = '' then
    raise exception 'أكمل الاسم ورقم الهاتف والعنوان.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'السلة فارغة.';
  end if;

  -- التحقق من الكتب والمخزون وحساب الإجمالي
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 then
      raise exception 'كمية غير صالحة.';
    end if;
    select * into v_book
    from public.books
    where id = (v_item->>'book_id')::uuid and is_active = true
    for update;
    if not found then
      raise exception 'أحد الكتب لم يعد متاحاً.';
    end if;
    if v_book.stock_qty < v_qty then
      raise exception 'الكمية المتاحة من "%" غير كافية.', v_book.title;
    end if;
    v_price    := coalesce(v_book.sale_price, v_book.original_price);
    v_subtotal := v_subtotal + v_book.original_price * v_qty;
    v_total    := v_total + v_price * v_qty;
  end loop;

  if v_total < 100 then
    raise exception 'الحد الأدنى للطلب 100 جنيه.';
  end if;

  -- كود طلب فريد
  loop
    v_code := 'VLV-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from public.orders where order_code = v_code);
  end loop;

  if p_payment_method = 'cod' then
    v_status := 'new';              v_pay_state := 'cash_on_delivery';
  else
    v_status := 'awaiting_payment'; v_pay_state := 'awaiting_proof';
  end if;

  insert into public.orders (
    order_code, user_id, customer_name, phone, shipping_address,
    subtotal, discount_total, total, payment_method, payment_status, status
  ) values (
    v_code, v_uid, trim(p_customer_name), trim(p_phone), trim(p_shipping_address),
    v_subtotal, v_subtotal - v_total, v_total, p_payment_method, v_pay_state, v_status
  ) returning id into v_order_id;

  -- بنود الطلب + خصم المخزون
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_book from public.books where id = (v_item->>'book_id')::uuid;
    insert into public.order_items (order_id, book_id, title_snapshot, quantity, unit_price)
    values (v_order_id, v_book.id, v_book.title, v_qty, coalesce(v_book.sale_price, v_book.original_price));
    update public.books set stock_qty = stock_qty - v_qty where id = v_book.id;
  end loop;

  if p_payment_method <> 'cod' then
    insert into public.payments (order_id, method, amount, status)
    values (v_order_id, p_payment_method, v_total, 'pending');
  end if;

  insert into public.conversations (order_id, customer_id) values (v_order_id, v_uid);

  return jsonb_build_object(
    'id', v_order_id,
    'order_code', v_code,
    'total', v_total,
    'status', v_status
  );
end;
$$;

-- إرسال/تحديث إثبات الدفع من العميل
create or replace function public.submit_payment_proof(
  p_order_id               uuid,
  p_proof_path             text,
  p_transaction_reference  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_ref    text := nullif(trim(coalesce(p_transaction_reference, '')), '');
begin
  select * into v_order from public.orders where id = p_order_id and user_id = auth.uid();
  if not found then
    raise exception 'الطلب غير موجود.';
  end if;
  if v_order.payment_method = 'cod' then
    raise exception 'هذا الطلب بالدفع عند الاستلام ولا يحتاج إثبات دفع.';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'هذا الطلب ملغي.';
  end if;
  if p_proof_path is null and v_ref is null then
    raise exception 'أدخل رقم العملية أو ارفع إثبات الدفع.';
  end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> auth.uid()::text then
    raise exception 'مسار الإثبات غير صالح.';
  end if;

  insert into public.payments (order_id, method, amount, proof_path, transaction_reference, status)
  values (p_order_id, v_order.payment_method, v_order.total, p_proof_path, v_ref, 'submitted')
  on conflict (order_id) do update
    set proof_path            = coalesce(excluded.proof_path, public.payments.proof_path),
        transaction_reference = coalesce(excluded.transaction_reference, public.payments.transaction_reference),
        status                = 'submitted'
    where public.payments.status <> 'approved';

  update public.orders
     set payment_status = 'under_review',
         status = case when status in ('new','awaiting_payment','payment_review') then 'payment_review' else status end
   where id = p_order_id and payment_status <> 'paid';
end;
$$;

-- المالك: تغيير حالة الطلب (مع إرجاع المخزون عند الإلغاء)
create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_line  record;
begin
  if not public.is_owner() then
    raise exception 'هذه العملية للمالك فقط.';
  end if;
  if p_status not in ('new','awaiting_payment','payment_review','paid','preparing','shipped','delivered','cancelled') then
    raise exception 'حالة غير صالحة.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'الطلب غير موجود.';
  end if;
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'لا يمكن إعادة تفعيل طلب ملغي. أنشئ طلباً جديداً.';
  end if;

  if p_status = 'cancelled' and v_order.status <> 'cancelled' then
    for v_line in select book_id, quantity from public.order_items where order_id = p_order_id and book_id is not null loop
      update public.books set stock_qty = stock_qty + v_line.quantity where id = v_line.book_id;
    end loop;
  end if;

  update public.orders
     set status = p_status,
         payment_status = case
           when p_status = 'delivered' and payment_method = 'cod' then 'paid'
           when p_status = 'paid' then 'paid'
           else payment_status
         end
   where id = p_order_id;
end;
$$;

-- المالك: اعتماد أو رفض الدفع
create or replace function public.admin_review_payment(p_order_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'هذه العملية للمالك فقط.';
  end if;
  if not exists (select 1 from public.payments where order_id = p_order_id) then
    raise exception 'لا يوجد دفع مسجل لهذا الطلب.';
  end if;

  update public.payments
     set status = case when p_approved then 'approved' else 'rejected' end,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where order_id = p_order_id;

  update public.orders
     set payment_status = case when p_approved then 'paid' else 'rejected' end,
         status = case
           when status in ('new','awaiting_payment','payment_review') then
             case when p_approved then 'paid' else 'awaiting_payment' end
           else status
         end
   where id = p_order_id;
end;
$$;

-- صلاحيات تنفيذ الدوال
revoke all on function public.create_order(jsonb, text, text, text, text)  from public, anon;
revoke all on function public.submit_payment_proof(uuid, text, text)       from public, anon;
revoke all on function public.admin_update_order_status(uuid, text)        from public, anon;
revoke all on function public.admin_review_payment(uuid, boolean)          from public, anon;
revoke all on function public.record_visit(text)                           from public;
grant execute on function public.create_order(jsonb, text, text, text, text) to authenticated;
grant execute on function public.submit_payment_proof(uuid, text, text)      to authenticated;
grant execute on function public.admin_update_order_status(uuid, text)       to authenticated;
grant execute on function public.admin_review_payment(uuid, boolean)         to authenticated;
grant execute on function public.record_visit(text)                          to anon, authenticated;
grant execute on function public.is_owner()                                  to anon, authenticated;

-- =====================================================================
-- 7) الصلاحيات على الجداول + RLS
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant select on public.categories, public.books, public.book_categories, public.store_settings to anon;
grant select on public.book_catalog, public.public_reviews, public.book_review_stats to anon, authenticated;
grant select, insert, update, delete on
  public.profiles, public.categories, public.books, public.book_categories, public.reviews,
  public.wishlist, public.orders, public.order_items, public.payments, public.conversations,
  public.messages, public.visits, public.store_settings
to authenticated;

alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.books           enable row level security;
alter table public.book_categories enable row level security;
alter table public.reviews         enable row level security;
alter table public.wishlist        enable row level security;
alter table public.orders          enable row level security;
alter table public.order_items     enable row level security;
alter table public.payments        enable row level security;
alter table public.conversations   enable row level security;
alter table public.messages        enable row level security;
alter table public.visits          enable row level security;
alter table public.store_settings  enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_owner())
  with check (id = auth.uid() or public.is_owner());

-- categories
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories for select to anon, authenticated
  using (is_active = true);
drop policy if exists categories_owner_all on public.categories;
create policy categories_owner_all on public.categories for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- books
drop policy if exists books_public_read on public.books;
create policy books_public_read on public.books for select to anon, authenticated
  using (is_active = true);
drop policy if exists books_owner_all on public.books;
create policy books_owner_all on public.books for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- book_categories
drop policy if exists book_categories_public_read on public.book_categories;
create policy book_categories_public_read on public.book_categories for select to anon, authenticated
  using (true);
drop policy if exists book_categories_owner_write on public.book_categories;
create policy book_categories_owner_write on public.book_categories for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- reviews (العميل يضيف مراجعة غير منشورة، والمالك يعتمدها)
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews for insert to authenticated
  with check (user_id = auth.uid() and is_published = false);
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select to authenticated
  using (user_id = auth.uid() or public.is_owner());
drop policy if exists reviews_owner_update on public.reviews;
create policy reviews_owner_update on public.reviews for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
drop policy if exists reviews_owner_delete on public.reviews;
create policy reviews_owner_delete on public.reviews for delete to authenticated
  using (public.is_owner());

-- wishlist
drop policy if exists wishlist_own on public.wishlist;
create policy wishlist_own on public.wishlist for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- orders / order_items / payments (القراءة فقط، والتعديل عبر الدوال)
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_owner());

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_owner())));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_owner())));

-- conversations / messages
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (customer_id = auth.uid() or public.is_owner());

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c
                 where c.id = conversation_id and (c.customer_id = auth.uid() or public.is_owner())));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversations c
                where c.id = conversation_id and (c.customer_id = auth.uid() or public.is_owner()))
  );

-- visits (القراءة للمالك فقط، والتسجيل عبر record_visit)
drop policy if exists visits_owner_select on public.visits;
create policy visits_owner_select on public.visits for select to authenticated
  using (public.is_owner());

-- store_settings
drop policy if exists settings_public_read on public.store_settings;
create policy settings_public_read on public.store_settings for select to anon, authenticated
  using (is_public = true);
drop policy if exists settings_owner_all on public.store_settings;
create policy settings_owner_all on public.store_settings for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- =====================================================================
-- 8) التخزين (Storage)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('book-covers',    'book-covers',    true,  5242880, array['image/jpeg','image/png','image/webp','image/gif']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "covers public read" on storage.objects;
create policy "covers public read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'book-covers');
drop policy if exists "covers owner insert" on storage.objects;
create policy "covers owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'book-covers' and public.is_owner());
drop policy if exists "covers owner update" on storage.objects;
create policy "covers owner update" on storage.objects for update to authenticated
  using (bucket_id = 'book-covers' and public.is_owner());
drop policy if exists "covers owner delete" on storage.objects;
create policy "covers owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'book-covers' and public.is_owner());

drop policy if exists "proofs customer insert" on storage.objects;
create policy "proofs customer insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "proofs read own or owner" on storage.objects;
create policy "proofs read own or owner" on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_owner()));
drop policy if exists "proofs owner delete" on storage.objects;
create policy "proofs owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_owner());

-- =====================================================================
-- 9) التحديث اللحظي (Realtime): رسائل المحادثة + تنبيه الطلبات الجديدة للمالك
-- =====================================================================
do $$
begin
  begin alter publication supabase_realtime add table public.messages;
  exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.orders;
  exception when duplicate_object or undefined_object then null; end;
end $$;

-- تحديث كاش واجهة PostgREST
notify pgrst, 'reload schema';
