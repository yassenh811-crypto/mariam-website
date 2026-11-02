-- Velvet Bookstore — Supabase schema
-- Run this whole file in Supabase Dashboard > SQL Editor using the project owner account.

begin;

create extension if not exists pgcrypto;

-- ---------- Shared helpers ----------
create or replace function public.is_store_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'owner'
  );
$$;

revoke all on function public.is_store_owner() from public;
grant execute on function public.is_store_owner() to anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Profiles and roles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  address text,
  role text not null default 'customer' check (role in ('customer','owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,email,full_name,phone)
  values (
    new.id,
    coalesce(new.email,''),
    coalesce(new.raw_user_meta_data->>'full_name',''),
    nullif(new.raw_user_meta_data->>'phone','')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_velvet on auth.users;
create trigger on_auth_user_created_velvet
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- A customer cannot promote their own profile or modify their email/role.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_store_owner() then
    if new.role is distinct from old.role then
      raise exception 'لا يمكن تغيير صلاحية الحساب';
    end if;
    if new.email is distinct from old.email then
      raise exception 'لا يمكن تغيير البريد الإلكتروني من هذه الصفحة';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_privileges_trigger on public.profiles;
create trigger protect_profile_privileges_trigger
before update on public.profiles
for each row execute procedure public.protect_profile_privileges();

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
drop policy if exists "profiles read self or owner" on public.profiles;
create policy "profiles read self or owner" on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_store_owner());
drop policy if exists "profiles update self or owner" on public.profiles;
create policy "profiles update self or owner" on public.profiles
for update to authenticated
using (id = auth.uid() or public.is_store_owner())
with check (id = auth.uid() or public.is_store_owner());
-- User profile rows are created only by the auth trigger; no client INSERT policy.

-- ---------- Books, categories, stock ----------
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  author text,
  pages integer check (pages is null or pages > 0),
  description text not null default '',
  cover_path text,
  stock_qty integer not null default 0 check (stock_qty >= 0),
  original_price numeric(12,2) not null check (original_price > 0),
  sale_price numeric(12,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint books_sale_price_check check (sale_price is null or (sale_price > 0 and sale_price < original_price))
);

create index if not exists books_created_at_idx on public.books(created_at desc);
create index if not exists books_active_idx on public.books(is_active);
drop trigger if exists books_updated_at on public.books;
create trigger books_updated_at before update on public.books
for each row execute procedure public.set_updated_at();

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.book_categories (
  book_id uuid not null references public.books(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (book_id, category_id)
);
create index if not exists book_categories_category_idx on public.book_categories(category_id);

-- Safe public catalogue: deliberately does NOT expose stock_qty.
create or replace view public.book_catalog
with (security_barrier = true)
as
select
  b.id, b.title, b.author, b.pages, b.description, b.cover_path,
  b.original_price, b.sale_price, b.is_active, b.created_at, b.updated_at,
  case
    when b.stock_qty = 0 then 'out'
    when b.stock_qty = 1 then 'last'
    when b.stock_qty between 2 and 3 then 'low'
    else 'available'
  end as stock_status,
  (b.created_at >= now() - interval '7 days') as is_new
from public.books b
where b.is_active = true;

grant select on public.book_catalog to anon, authenticated;

alter table public.books enable row level security;
drop policy if exists "owner manages books" on public.books;
create policy "owner manages books" on public.books
for all to authenticated
using (public.is_store_owner())
with check (public.is_store_owner());

alter table public.categories enable row level security;
drop policy if exists "active categories are public" on public.categories;
create policy "active categories are public" on public.categories
for select to anon, authenticated using (is_active = true or public.is_store_owner());
drop policy if exists "owner manages categories" on public.categories;
create policy "owner manages categories" on public.categories
for all to authenticated using (public.is_store_owner()) with check (public.is_store_owner());

alter table public.book_categories enable row level security;
drop policy if exists "book category links are public" on public.book_categories;
create policy "book category links are public" on public.book_categories
for select to anon, authenticated using (true);
drop policy if exists "owner manages book category links" on public.book_categories;
create policy "owner manages book category links" on public.book_categories
for all to authenticated using (public.is_store_owner()) with check (public.is_store_owner());

-- Starter categories only; no example/fake books are inserted.
insert into public.categories(name) values
  ('روايات'),('رومانسية'),('خيال'),('غموض'),('تنمية بشرية'),('تاريخ'),('كتب تعليمية'),('مغامرات')
on conflict (name) do nothing;

-- ---------- Wishlist ----------
create table if not exists public.wishlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, book_id)
);
alter table public.wishlist enable row level security;
drop policy if exists "customer manages own wishlist" on public.wishlist;
create policy "customer manages own wishlist" on public.wishlist
for all to authenticated
using (user_id = auth.uid() or public.is_store_owner())
with check (user_id = auth.uid() or public.is_store_owner());

-- ---------- Orders and immutable order-item snapshots ----------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  user_id uuid not null references public.profiles(id),
  customer_name text not null,
  phone text not null,
  shipping_address text not null,
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_total numeric(12,2) not null default 0 check (discount_total >= 0),
  total numeric(12,2) not null check (total >= 0),
  payment_method text not null check (payment_method in ('cod','instapay','vodafone_cash')),
  payment_status text not null default 'unpaid' check (payment_status in ('cod_pending','unpaid','under_review','approved','rejected')),
  status text not null default 'new' check (status in ('new','awaiting_payment','payment_review','paid','preparing','shipped','delivered','cancelled')),
  stock_restored boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_created_idx on public.orders(user_id,created_at desc);
create index if not exists orders_status_created_idx on public.orders(status,created_at desc);
create index if not exists orders_code_idx on public.orders(order_code);
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders
for each row execute procedure public.set_updated_at();

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  title_snapshot text not null,
  author_snapshot text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price > 0),
  original_unit_price numeric(12,2) not null check (original_unit_price > 0),
  created_at timestamptz not null default now()
);
create index if not exists order_items_order_idx on public.order_items(order_id);

alter table public.orders enable row level security;
drop policy if exists "customer reads own orders owner reads all" on public.orders;
create policy "customer reads own orders owner reads all" on public.orders
for select to authenticated using (user_id = auth.uid() or public.is_store_owner());
drop policy if exists "owner updates orders" on public.orders;
create policy "owner updates orders" on public.orders
for update to authenticated using (public.is_store_owner()) with check (public.is_store_owner());
-- Orders are created only through create_order(); no client INSERT policy.

alter table public.order_items enable row level security;
drop policy if exists "customer reads own order items owner reads all" on public.order_items;
create policy "customer reads own order items owner reads all" on public.order_items
for select to authenticated using (
  public.is_store_owner() or exists (
    select 1 from public.orders o where o.id = order_items.order_id and o.user_id = auth.uid()
  )
);

-- ---------- Payment submissions ----------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  method text not null check (method in ('instapay','vodafone_cash')),
  amount numeric(12,2) not null check (amount > 100),
  status text not null default 'unpaid' check (status in ('unpaid','under_review','approved','rejected')),
  proof_path text,
  transaction_reference text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
for each row execute procedure public.set_updated_at();
alter table public.payments enable row level security;
drop policy if exists "customer reads own payments owner reads all" on public.payments;
create policy "customer reads own payments owner reads all" on public.payments
for select to authenticated using (user_id = auth.uid() or public.is_store_owner());
drop policy if exists "owner manages payments" on public.payments;
create policy "owner manages payments" on public.payments
for update to authenticated using (public.is_store_owner()) with check (public.is_store_owner());

-- ---------- Conversations and messages ----------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations(user_id,created_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);

alter table public.conversations enable row level security;
drop policy if exists "participants read conversations" on public.conversations;
create policy "participants read conversations" on public.conversations
for select to authenticated using (user_id = auth.uid() or public.is_store_owner());

alter table public.messages enable row level security;
drop policy if exists "participants read messages" on public.messages;
create policy "participants read messages" on public.messages
for select to authenticated using (
  public.is_store_owner() or exists (
    select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = auth.uid()
  )
);
drop policy if exists "participants send messages" on public.messages;
create policy "participants send messages" on public.messages
for insert to authenticated with check (
  sender_id = auth.uid() and (
    public.is_store_owner() or exists (
      select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  )
);

-- ---------- Reviews ----------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null check (length(trim(comment)) between 3 and 1200),
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  unique (book_id,user_id)
);
create index if not exists reviews_book_idx on public.reviews(book_id,created_at desc);
alter table public.reviews enable row level security;
drop policy if exists "public reads published reviews owner reads all" on public.reviews;
create policy "public reads published reviews owner reads all" on public.reviews
for select to anon, authenticated using (is_published = true or public.is_store_owner());
drop policy if exists "customer reviews a purchased book" on public.reviews;
create policy "customer reviews a purchased book" on public.reviews
for insert to authenticated with check (
  user_id = auth.uid() and is_published = false and exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.book_id = reviews.book_id
      and o.user_id = auth.uid()
      and o.status in ('paid','preparing','shipped','delivered')
  )
);
drop policy if exists "owner moderates reviews" on public.reviews;
create policy "owner moderates reviews" on public.reviews
for update to authenticated using (public.is_store_owner()) with check (public.is_store_owner());

create or replace view public.public_reviews
with (security_barrier = true)
as
select r.id,r.book_id,r.rating,r.comment,r.is_published,r.created_at,
       coalesce(nullif(p.full_name,''),'قارئ Velvet') as display_name,
       b.title as book_title
from public.reviews r
left join public.profiles p on p.id=r.user_id
left join public.books b on b.id=r.book_id
where r.is_published = true;
grant select on public.public_reviews to anon, authenticated;

create or replace view public.book_review_stats
with (security_barrier = true)
as
select book_id, round(avg(rating)::numeric,1) as average_rating, count(*)::integer as review_count
from public.reviews
where is_published = true
group by book_id;
grant select on public.book_review_stats to anon, authenticated;

-- ---------- Store settings ----------
create table if not exists public.store_settings (
  key text primary key,
  value jsonb not null default '""'::jsonb,
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);
drop trigger if exists store_settings_updated_at on public.store_settings;
create trigger store_settings_updated_at before update on public.store_settings
for each row execute procedure public.set_updated_at();
alter table public.store_settings enable row level security;
drop policy if exists "public settings or owner can read" on public.store_settings;
create policy "public settings or owner can read" on public.store_settings
for select to anon, authenticated using (is_public = true or public.is_store_owner());
drop policy if exists "owner manages settings" on public.store_settings;
create policy "owner manages settings" on public.store_settings
for all to authenticated using (public.is_store_owner()) with check (public.is_store_owner());

insert into public.store_settings(key,value,is_public) values
  ('whatsapp_number','""'::jsonb,true),
  ('instapay_details','""'::jsonb,true),
  ('vodafone_cash_number','""'::jsonb,true),
  ('facebook_url','""'::jsonb,true),
  ('tiktok_url','""'::jsonb,true),
  ('instagram_url','""'::jsonb,true),
  ('return_policy',to_jsonb('الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.'::text),true)
on conflict (key) do nothing;

-- ---------- Visits / analytics ----------
create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  visitor_key text not null,
  visited_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (visitor_key,visited_on),
  check (length(visitor_key) between 16 and 100)
);
create index if not exists visits_date_idx on public.visits(visited_on desc);
alter table public.visits enable row level security;
drop policy if exists "owner reads visits" on public.visits;
create policy "owner reads visits" on public.visits
for select to authenticated using (public.is_store_owner());
-- Inserts are only possible via the limited record_visit RPC below.

-- Explicit API grants; row-level security still decides which rows each role can access.
grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.books to authenticated;
grant select on public.categories, public.book_categories to anon, authenticated;
grant insert, update, delete on public.categories, public.book_categories to authenticated;
grant select, insert, update, delete on public.wishlist to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select, update on public.payments to authenticated;
grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.reviews to authenticated;
grant select on public.store_settings to anon, authenticated;
grant insert, update, delete on public.store_settings to authenticated;
grant select on public.visits to authenticated;

-- ---------- Secure order creation RPC ----------
create or replace function public.create_order(
  p_items jsonb,
  p_payment_method text,
  p_shipping_address text,
  p_phone text,
  p_customer_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_item record;
  v_book public.books%rowtype;
  v_order_id uuid;
  v_order_code text;
  v_subtotal numeric(12,2) := 0;
  v_original_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_unit_price numeric(12,2);
  v_count integer := 0;
begin
  if v_user_id is null then raise exception 'يجب تسجيل الدخول قبل الشراء'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'سلة المشتريات فارغة'; end if;
  if exists (select 1 from jsonb_array_elements(p_items) element where coalesce((element->>'quantity')::integer,0) not between 1 and 30) then
    raise exception 'كمية أحد الكتب غير صحيحة';
  end if;
  if length(trim(coalesce(p_customer_name,''))) < 2 then raise exception 'اكتب اسم المستلم'; end if;
  if length(trim(coalesce(p_phone,''))) < 7 then raise exception 'اكتب رقم هاتف صحيحاً'; end if;
  if length(trim(coalesce(p_shipping_address,''))) < 5 then raise exception 'اكتب عنوان التوصيل كاملاً'; end if;

  -- Lock every requested book in stable order, then calculate all prices on the server.
  for v_item in
    select parsed.book_id, sum(parsed.quantity)::integer as quantity
    from (
      select (element->>'book_id')::uuid as book_id,
             (element->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) element
    ) parsed
    group by parsed.book_id
    order by parsed.book_id
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 30 then
      raise exception 'كمية الكتاب غير صحيحة';
    end if;
    select * into v_book
      from public.books
      where id = v_item.book_id and is_active = true
      for update;
    if not found then raise exception 'أحد الكتب لم يعد متاحاً'; end if;
    if v_book.stock_qty < v_item.quantity then
      raise exception 'الكمية المطلوبة من كتاب "%" غير متوفرة',v_book.title;
    end if;
    v_unit_price := coalesce(v_book.sale_price,v_book.original_price);
    v_subtotal := v_subtotal + (v_unit_price * v_item.quantity);
    v_original_subtotal := v_original_subtotal + (v_book.original_price * v_item.quantity);
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then raise exception 'سلة المشتريات فارغة'; end if;
  v_total := v_subtotal;
  if v_total < 100 then raise exception 'نعتذر، الحد الأدنى للطلب هو 100 جنيه.'; end if;
  if abs(v_total - 100) < 0.001 then
    if p_payment_method <> 'cod' then raise exception 'الطلب الذي يساوي 100 جنيه متاح له الدفع عند الاستلام فقط'; end if;
  elsif v_total > 100 then
    if p_payment_method not in ('instapay','vodafone_cash') then raise exception 'الطلبات الأكبر من 100 جنيه تتطلب الدفع المسبق عبر إنستاباي أو فودافون كاش'; end if;
  else
    raise exception 'طريقة الدفع غير صالحة';
  end if;

  v_order_id := gen_random_uuid();
  v_order_code := 'VLT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.orders(id,order_code,user_id,customer_name,phone,shipping_address,subtotal,discount_total,total,payment_method,payment_status,status)
  values (
    v_order_id,v_order_code,v_user_id,trim(p_customer_name),trim(p_phone),trim(p_shipping_address),
    v_original_subtotal,(v_original_subtotal-v_subtotal),v_total,p_payment_method,
    case when p_payment_method='cod' then 'cod_pending' else 'unpaid' end,
    case when p_payment_method='cod' then 'new' else 'awaiting_payment' end
  );

  -- Store snapshots and reserve stock in the same transaction to prevent overselling.
  for v_item in
    select parsed.book_id, sum(parsed.quantity)::integer as quantity
    from (
      select (element->>'book_id')::uuid as book_id,
             (element->>'quantity')::integer as quantity
      from jsonb_array_elements(p_items) element
    ) parsed
    group by parsed.book_id
    order by parsed.book_id
  loop
    select * into v_book from public.books where id=v_item.book_id for update;
    v_unit_price := coalesce(v_book.sale_price,v_book.original_price);
    insert into public.order_items(order_id,book_id,title_snapshot,author_snapshot,quantity,unit_price,original_unit_price)
    values(v_order_id,v_book.id,v_book.title,v_book.author,v_item.quantity,v_unit_price,v_book.original_price);
    update public.books set stock_qty=stock_qty-v_item.quantity where id=v_book.id;
  end loop;

  insert into public.conversations(order_id,user_id) values(v_order_id,v_user_id);
  if p_payment_method <> 'cod' then
    insert into public.payments(order_id,user_id,method,amount,status)
    values(v_order_id,v_user_id,p_payment_method,v_total,'unpaid');
  end if;

  return jsonb_build_object('id',v_order_id,'order_code',v_order_code,'total',v_total,'status',case when p_payment_method='cod' then 'new' else 'awaiting_payment' end);
end;
$$;
revoke all on function public.create_order(jsonb,text,text,text,text) from public;
grant execute on function public.create_order(jsonb,text,text,text,text) to authenticated;

-- Customer attaches a payment reference and/or private proof file.
create or replace function public.submit_payment_proof(
  p_order_id uuid,
  p_proof_path text,
  p_transaction_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_payment public.payments%rowtype;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول'; end if;
  select * into v_payment from public.payments
   where order_id=p_order_id and user_id=auth.uid()
   for update;
  if not found then raise exception 'بيانات الدفع غير موجودة'; end if;
  if v_payment.status='approved' then raise exception 'تم اعتماد الدفع بالفعل'; end if;
  if exists(select 1 from public.orders where id=p_order_id and status='cancelled') then raise exception 'هذا الطلب ملغي'; end if;
  if p_proof_path is null and length(trim(coalesce(p_transaction_reference,'')))=0 then
    raise exception 'أدخل رقم العملية أو ارفع إثبات الدفع';
  end if;
  if p_proof_path is not null then
    if split_part(p_proof_path,'/',1) <> auth.uid()::text
       or split_part(p_proof_path,'/',2) <> p_order_id::text then
      raise exception 'مسار إثبات الدفع غير صالح';
    end if;
  end if;
  update public.payments
    set proof_path=coalesce(p_proof_path,proof_path),
        transaction_reference=nullif(trim(coalesce(p_transaction_reference,'')),''),
        status='under_review'
    where id=v_payment.id;
  update public.orders set payment_status='under_review',status='payment_review'
    where id=p_order_id and user_id=auth.uid() and status <> 'cancelled';
end;
$$;
revoke all on function public.submit_payment_proof(uuid,text,text) from public;
grant execute on function public.submit_payment_proof(uuid,text,text) to authenticated;

-- Owner changes order state. Cancellation restores reserved stock exactly once.
create or replace function public.admin_update_order_status(p_order_id uuid,p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.orders%rowtype; v_line record;
begin
  if not public.is_store_owner() then raise exception 'غير مصرح'; end if;
  if p_status not in ('new','awaiting_payment','payment_review','paid','preparing','shipped','delivered','cancelled') then
    raise exception 'حالة الطلب غير صحيحة';
  end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v_order.status='cancelled' and p_status <> 'cancelled' then raise exception 'لا يمكن إعادة فتح طلب ملغي؛ أنشئ طلباً جديداً بدلاً منه'; end if;
  if p_status='cancelled' and not v_order.stock_restored then
    for v_line in select book_id,quantity from public.order_items where order_id=p_order_id and book_id is not null loop
      update public.books set stock_qty=stock_qty+v_line.quantity where id=v_line.book_id;
    end loop;
    update public.orders set stock_restored=true where id=p_order_id;
  end if;
  update public.orders set status=p_status,
    payment_status=case when p_status='paid' then 'approved' else payment_status end
    where id=p_order_id;
  if p_status='paid' then
    update public.payments set status='approved',reviewed_by=auth.uid(),reviewed_at=now()
      where order_id=p_order_id;
  elsif p_status='cancelled' then
    update public.payments set status='rejected',reviewed_by=auth.uid(),reviewed_at=now()
      where order_id=p_order_id and status <> 'approved';
  end if;
end;
$$;
revoke all on function public.admin_update_order_status(uuid,text) from public;
grant execute on function public.admin_update_order_status(uuid,text) to authenticated;

-- Owner explicitly approves or rejects manual bank-transfer proof.
create or replace function public.admin_review_payment(p_order_id uuid,p_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_order public.orders%rowtype;
begin
  if not public.is_store_owner() then raise exception 'غير مصرح'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'الطلب غير موجود'; end if;
  if v_order.payment_method='cod' then raise exception 'هذا الطلب دفع عند الاستلام وليس تحويلاً مسبقاً'; end if;
  if v_order.status='cancelled' then raise exception 'الطلب ملغي'; end if;
  update public.payments set
    status=case when p_approved then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now()
  where order_id=p_order_id;
  update public.orders set
    payment_status=case when p_approved then 'approved' else 'rejected' end,
    status=case when p_approved then 'paid' else 'awaiting_payment' end
  where id=p_order_id;
end;
$$;
revoke all on function public.admin_review_payment(uuid,boolean) from public;
grant execute on function public.admin_review_payment(uuid,boolean) to authenticated;

-- Record at most one page visit per browser key per date.
create or replace function public.record_visit(p_visitor_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor_key is null or length(p_visitor_key) < 16 or length(p_visitor_key) > 100 then
    raise exception 'معرّف الزيارة غير صالح';
  end if;
  insert into public.visits(visitor_key,visited_on)
  values(p_visitor_key,current_date)
  on conflict(visitor_key,visited_on) do nothing;
end;
$$;
revoke all on function public.record_visit(text) from public;
grant execute on function public.record_visit(text) to anon, authenticated;

-- ---------- Storage buckets and policies ----------
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('book-covers','book-covers',true,5242880,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif'];

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('payment-proofs','payment-proofs',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists "public can view book covers" on storage.objects;
create policy "public can view book covers" on storage.objects
for select to anon, authenticated using (bucket_id='book-covers');
drop policy if exists "owner uploads book covers" on storage.objects;
create policy "owner uploads book covers" on storage.objects
for insert to authenticated with check (bucket_id='book-covers' and public.is_store_owner());
drop policy if exists "owner updates book covers" on storage.objects;
create policy "owner updates book covers" on storage.objects
for update to authenticated using (bucket_id='book-covers' and public.is_store_owner()) with check (bucket_id='book-covers' and public.is_store_owner());
drop policy if exists "owner deletes book covers" on storage.objects;
create policy "owner deletes book covers" on storage.objects
for delete to authenticated using (bucket_id='book-covers' and public.is_store_owner());

drop policy if exists "customer uploads own order proof" on storage.objects;
create policy "customer uploads own order proof" on storage.objects
for insert to authenticated with check (
  bucket_id='payment-proofs'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists (
    select 1 from public.orders o
    where o.id=((storage.foldername(name))[2])::uuid and o.user_id=auth.uid()
  )
);
drop policy if exists "customer and owner read payment proof" on storage.objects;
create policy "customer and owner read payment proof" on storage.objects
for select to authenticated using (
  bucket_id='payment-proofs' and (
    public.is_store_owner() or (
      (storage.foldername(name))[1]=auth.uid()::text and exists (
        select 1 from public.orders o
        where o.id=((storage.foldername(name))[2])::uuid and o.user_id=auth.uid()
      )
    )
  )
);
drop policy if exists "customer removes own unpaid proof" on storage.objects;
create policy "customer removes own unpaid proof" on storage.objects
for delete to authenticated using (
  bucket_id='payment-proofs' and (storage.foldername(name))[1]=auth.uid()::text
  and exists (select 1 from public.orders o where o.id=((storage.foldername(name))[2])::uuid and o.user_id=auth.uid())
);

-- ---------- Realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then
    execute 'alter publication supabase_realtime add table public.orders';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reviews') then
    execute 'alter publication supabase_realtime add table public.reviews';
  end if;
end;
$$;

commit;

-- IMPORTANT: create the owner account through the website first, then run the one-time
-- promotion command from README.md in SQL Editor. Never expose a service_role key.
