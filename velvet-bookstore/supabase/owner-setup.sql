-- =====================================================================
-- تعيين حساب المالك (شغّله بعد schema.sql)
-- 1) أنشئ الحساب من الموقع (تسجيل جديد) وأكّد البريد.
-- 2) غيّر البريد بالأسفل لبريد المالك ثم Run.
-- =====================================================================
update public.profiles
   set role = 'owner'
 where lower(email) = lower('PUT_OWNER_EMAIL@gmail.com');

-- تحقق: لازم يظهر صف واحد على الأقل
select id, email, role from public.profiles where role = 'owner';
