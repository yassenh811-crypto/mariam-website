-- Velvet fix: add the missing profile role column.
-- Run this once in Supabase SQL Editor if the existing profiles table
-- was created before the role column was added to the Velvet schema.

begin;

alter table public.profiles
  add column if not exists role text not null default 'customer';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('customer','owner'));
  end if;
end;
$$;

commit;
