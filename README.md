# Velvet — متجر الكتب

## التشغيل المحلي
```bash
npm install
npm run dev
```
الملف `.env` موجود جاهز بإعدادات Supabase. افتح الرابط اللي يظهر في الطرفية (غالباً http://localhost:5173).

## الرفع على GitHub (أمر واحد)
فك الضغط فوق مجلد المشروع (اللي فيه `.git`)، ثم من داخل المجلد:
```bash
git add -A && git commit -m "Velvet v2: fix deploy + new design" && git push origin main
```
مرة واحدة فقط من GitHub: Settings → Pages → Build and deployment → Source = **GitHub Actions**.
بعدها كل `push` ينشر الموقع تلقائياً (تابع التقدم من تبويب Actions).

## قاعدة البيانات (مرة واحدة)
1. Supabase → SQL Editor → New query → الصق محتوى `supabase/schema.sql` كله → Run.
2. سجّل حساب من الموقع، وبعدين افتح `supabase/owner-setup.sql` وغيّر البريد لبريد المالك → Run.
3. ادخل بحساب المالك: هتظهر "لوحة الإدارة" في القائمة الجانبية. من هناك أضف التصنيفات والكتب وبيانات واتساب وإنستاباي.

## لو بيانات Supabase مش بتظهر
1. ادخل لوحة Supabase وتأكد إن المشروع **Active** مش Paused (المجاني بيتوقف لو مفيش نشاط أسبوع، اضغط Restore).
2. تأكد إن الجداول والـ views موجودة (`book_catalog`, `categories`, `public_reviews`...) وإن سياسات RLS تسمح بالقراءة العامة.
3. الموقع دلوقتي بيعرض سبب الخطأ مكتوب في مكان الكتب بدل ما يفضل فاضي.
4. في Authentication → URL Configuration أضف رابط موقعك على GitHub Pages ضمن Site URL / Redirect URLs.

## الأسرار
استخدم دايماً مفتاح `sb_publishable` أو `anon` فقط. ممنوع `service_role` أو `sb_secret` في أي ملف.
