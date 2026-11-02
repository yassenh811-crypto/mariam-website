# Velvet — متجر الكتب

مشروع واجهة متجر Velvet مع ربط Supabase، لوحة إدارة، كتب وتصنيفات ومراجعات وسلة ومفضلة، وملفات قاعدة البيانات والنشر على GitHub Pages.

## 1) التشغيل على جهازك

1. ثبّت Node.js إصدار 22 أو أحدث.
2. افتح هذا المجلد في VS Code.
3. انسخ `.env.example` وسمِّ النسخة `.env`.
4. ضع بيانات مشروع Supabase العامة داخل `.env`:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
```

5. افتح الطرفية داخل المجلد نفسه ونفّذ:

```bash
npm install
npm run dev
```

## 2) قاعدة بيانات Supabase

- لمشروع جديد: افتح Supabase ثم SQL Editor وشغّل `supabase/schema.sql` كاملاً.
- إذا كانت لديك قاعدة قديمة بالفعل: راجع `supabase/fix-books-columns.sql` وشغّله فقط إذا كانت أعمدة قاعدة البيانات القديمة تحتاج الإصلاح، ولا تشغّله عشوائياً على قاعدة جديدة.
- ملفات `fix-is-active.sql` و`fix-profiles-role.sql` إصلاحات إضافية لحالات قواعد البيانات القديمة؛ استخدمها فقط إذا كانت المشكلة المطابقة موجودة.
- `supabase/owner-setup.sql` ملف اختياري لتعيين حساب المالك. راجع البريد الإلكتروني المكتوب بداخله وعدّله إلى بريد حساب المالك الصحيح قبل تشغيله. يجب أن يكون الحساب قد أُنشئ وأُكّد في Supabase Authentication أولاً.

## 3) إعداد النشر على GitHub Pages

1. ارفع محتويات هذا المجلد إلى جذر مستودع GitHub، بحيث يكون `index.html` و`package.json` في الجذر مباشرة، وليس داخل مجلد `dist` أو مجلد فرعي.
2. افتح المستودع: Settings → Secrets and variables → Actions.
3. أنشئ Repository secrets بالاسمين التاليين:
   - `VITE_SUPABASE_URL` — رابط مشروع Supabase.
   - `VITE_SUPABASE_ANON_KEY` — مفتاح النشر العام `sb_publishable` أو `anon`.
4. لا تستخدم `service_role` أو `sb_secret` في الموقع أو في أي ملف يبدأ بـ `VITE_`.
5. افتح Settings → Pages واجعل Build and deployment → Source = GitHub Actions.
6. ادفع التعديلات إلى فرع `main`. ستعمل عملية النشر من Actions تلقائياً.

## 4) أوامر الرفع

نفّذ الأوامر من جذر المستودع بعد فك الضغط:

```bash
git add .
git commit -m "Deploy Velvet bookstore"
git push origin main
```

## ملاحظات مهمة

- ملف `.env` المحلي مستبعد من Git ولن يُرفع. عملية GitHub Actions تنشئ ملف `.env` مؤقتاً من Repository secrets وقت البناء.
- مفتاح `publishable/anon` مخصص للاستخدام العام في المتصفح؛ حماية البيانات تعتمد على سياسات RLS الصحيحة في Supabase.
- لا ترفع كلمات مرور أو مفاتيح إدارية سرية.
- ملف `style.css` يُنسخ تلقائياً إلى `public/style.css` قبل البناء حتى يتم نشره كرابط ثابت، والرابط في الصفحة نسبي حتى يعمل تحت مسار GitHub Pages الخاص بالمستودع.
