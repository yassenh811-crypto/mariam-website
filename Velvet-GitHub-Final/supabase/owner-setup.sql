-- Velvet: تفعيل حساب المالك بأمان من Supabase SQL Editor
-- شغّل هذا الملف في نفس مشروع Supabase الموجود رابطه داخل ملف .env.
-- يجب أن يكون حساب mariam@gmail.com موجوداً ومؤكداً في Authentication > Users.

do $$
declare
  v_user_id uuid;
  v_email text;
  v_full_name text;
  v_confirmed_at timestamptz;
begin
  select
    id,
    email,
    coalesce(raw_user_meta_data ->> 'full_name', ''),
    email_confirmed_at
  into v_user_id, v_email, v_full_name, v_confirmed_at
  from auth.users
  where lower(email) = lower('mariam@gmail.com')
  limit 1;

  if v_user_id is null then
    raise exception 'لم يتم العثور على حساب mariam@gmail.com في Authentication > Users. أنشئ الحساب أولاً في نفس مشروع Supabase.';
  end if;

  if v_confirmed_at is null then
    raise exception 'حساب mariam@gmail.com غير مؤكّد البريد. أكّد البريد أولاً ثم أعد تشغيل الملف.';
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (v_user_id, coalesce(v_email, ''), v_full_name, 'owner')
  on conflict (id) do update
    set email = excluded.email,
        role = 'owner',
        updated_at = now();
end;
$$;

-- يجب أن يعرض الاستعلام التالي صفاً واحداً و role = owner.
select id, email, role
from public.profiles
where lower(email) = lower('mariam@gmail.com');
