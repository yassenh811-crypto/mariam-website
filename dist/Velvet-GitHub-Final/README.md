# Velvet — إصلاح خطأ 404 لملف CSS على GitHub Pages

هذه النسخة تبقي ملف التنسيق باسم ثابت `style.css` بدلاً من تحويله إلى اسم مشفّر مثل `index-xxxx.css`. أثناء التشغيل والبناء، ينسخ السكربت `scripts/prepare-static-css.mjs` ملف `style.css` الموجود بجانب `index.html` إلى `public/style.css`، ثم ينسخه Vite إلى جذر `dist`. ويرتبط به `index.html` عبر `%BASE_URL%` حتى يعمل داخل مسار المستودع على GitHub Pages.

## التحديث

1. فك ضغط الملف.
2. ارفع **كل محتويات** مجلد `Velvet-CSS-404-Fix` إلى جذر مستودع GitHub واستبدل الملفات القديمة.
3. تأكد أن هذه المسارات موجودة في المستودع:
   - `index.html`
   - `app.js`
   - `package.json`
   - `vite.config.js`
   - `style.css`
   - `scripts/prepare-static-css.mjs`
   - `public/` (يتولد فيه `style.css` تلقائياً)
   - `.github/workflows/deploy.yml`
4. من GitHub افتح `Settings → Pages` واجعل `Source` = `GitHub Actions`.
5. افتح `Actions` وانتظر اكتمال `Deploy Velvet to GitHub Pages` باللون الأخضر.
6. افتح رابط الموقع المنشور ثم حدّثه تحديثاً قوياً بـ `Ctrl + Shift + R`.

## أوامر الرفع

```bash
git add .
git commit -m "Fix GitHub Pages CSS 404"
git push
```

## بيانات Supabase

في `Settings → Secrets and variables → Actions` يجب وجود:
- Variable: `VITE_SUPABASE_URL`
- Secret: `VITE_SUPABASE_ANON_KEY`

استخدم مفتاح النشر العام فقط، ولا تضع `service_role` في الموقع أو المستودع.

## فحص البناء محلياً

```bash
npm install
npm run build
```

بعد البناء يجب أن يحتوي `dist` على `index.html` و`style.css` ومجلد `assets`. يمكنك الاستمرار في تعديل ملف `style.css` الموجود بجانب `index.html`؛ النسخ إلى `public` يتم تلقائياً. لا ترفع `dist` يدوياً إذا كنت تستخدم سير عمل GitHub Actions الموجود في `.github/workflows/deploy.yml`؛ فهو يبني المشروع ويرفع `dist` تلقائياً.
