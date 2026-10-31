-- شغّل هذا الأمر بعد إنشاء حساب mariam@gmail.com من واجهة المتجر وتأكيد بريده.
-- نفّذه من Supabase Dashboard > SQL Editor بصلاحية مالك مشروع Supabase.
update public.profiles
set role = 'owner'
where lower(email) = lower('mariam@gmail.com');

-- يجب أن يتأثر صف واحد. إذا كانت النتيجة 0، تأكد من إنشاء الحساب أولاً وأن البريد صحيح.
