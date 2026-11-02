import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = hasConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (value) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const readStore = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const byId = (id) => books.find((book) => book.id === id);

let books = [];
let categories = [];
let reviews = [];
let reviewStats = {};
let settings = {};
let currentUser = null;
let profile = null;
let activeConversation = null;
let realtimeChannels = [];
let showDiscountOnly = false;
let resumeCartAfterAuth = false;
let cart = readStore('velvet_cart', []);
let wishlist = readStore('velvet_wishlist', []);
let currentAdminTab = 'overview';

function toast(message, type = 'success') {
  const region = $('#toast-region');
  if (!region) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function showModal(content, extraClass = '') {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card ${extraClass}" role="dialog" aria-modal="true">${content}</section></div>`;
  root.classList.add('is-open');
  root.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.remove('is-open');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '';
  document.body.classList.remove('modal-open');
}

function openPanel(id) {
  closePanels();
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.add('is-open');
  panel.setAttribute('aria-hidden', 'false');
  $('#panel-scrim').classList.add('is-visible');
  document.body.classList.add('panel-open');
}

function closePanels() {
  ['cart-panel', 'wishlist-panel'].forEach((id) => {
    const panel = document.getElementById(id);
    if (panel) { panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); }
  });
  $('#panel-scrim')?.classList.remove('is-visible');
  document.body.classList.remove('panel-open');
}

function openStoreSidebar() {
  const sidebar = $('#store-sidebar');
  if (!sidebar) return;
  sidebar.classList.add('is-open');
  sidebar.setAttribute('aria-hidden', 'false');
  $('#store-sidebar-scrim')?.classList.add('is-visible');
  $('#store-sidebar-toggle')?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('store-sidebar-open');
}

function closeStoreSidebar() {
  const sidebar = $('#store-sidebar');
  sidebar?.classList.remove('is-open');
  sidebar?.setAttribute('aria-hidden', 'true');
  $('#store-sidebar-scrim')?.classList.remove('is-visible');
  $('#store-sidebar-toggle')?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('store-sidebar-open');
}

function storageUrl(path, bucket = 'book-covers') {
  if (!path || !supabase) return '';
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

function bookCover(book) {
  const url = storageUrl(book.cover_path);
  return url || 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="560"><rect width="100%" height="100%" fill="#eee7f4"/><text x="50%" y="45%" text-anchor="middle" font-size="70" fill="#8e75a7">✿</text><text x="50%" y="58%" text-anchor="middle" font-size="24" fill="#685176">Velvet</text></svg>`);
}

function discountPercent(book) {
  const oldPrice = Number(book.original_price || 0);
  const newPrice = Number(book.sale_price ?? oldPrice);
  return oldPrice > 0 && newPrice < oldPrice ? Math.round((1 - newPrice / oldPrice) * 100) : 0;
}

function currentPrice(book) { return Number(book.sale_price ?? book.original_price ?? 0); }

function stockLabel(status) {
  return ({ available: 'متاح', low: 'قاربت الكمية على النفاد', last: 'الطبعة الأخيرة من هذا الكتاب', out: 'نفدت الكمية' })[status] || 'غير متاح';
}

function renderBookCard(book) {
  const discount = discountPercent(book);
  const favorite = wishlist.includes(book.id);
  const stats = reviewStats[book.id] || { average: 0, count: 0 };
  const disabled = book.stock_status === 'out' || book.is_active === false;
  return `<article class="book-card" data-book-card="${book.id}">
    <div class="book-cover-wrap" data-action="book-details" data-id="${book.id}">
      <img class="book-cover" src="${bookCover(book)}" alt="غلاف ${escapeHtml(book.title)}" loading="lazy" />
      ${discount ? `<span class="discount-badge">خصم ${discount}%</span>` : ''}
      <span class="stock-pill stock-${book.stock_status || 'available'}">${stockLabel(book.stock_status)}</span>
    </div>
    <button class="favorite-button ${favorite ? 'is-favorite' : ''}" data-action="toggle-wishlist" data-id="${book.id}" aria-label="${favorite ? 'إزالة من' : 'إضافة إلى'} المفضلة">${favorite ? '★' : '☆'}</button>
    <div class="book-card-content">
      <button class="book-title" data-action="book-details" data-id="${book.id}">${escapeHtml(book.title)}</button>
      <p class="book-author">${escapeHtml(book.author || 'كاتب غير محدد')}</p>
      <div class="book-rating">${stats.count ? `★ ${Number(stats.average).toFixed(1)} <span>(${stats.count})</span>` : '<span>لا توجد تقييمات بعد</span>'}</div>
      <div class="book-card-bottom"><div class="price-wrap">${discount ? `<del>${money(book.original_price)}</del>` : ''}<strong>${money(currentPrice(book))}</strong></div>
      <button class="add-cart-button" data-action="add-cart" data-id="${book.id}" ${disabled ? 'disabled' : ''}>${disabled ? 'غير متاح' : 'أضف للسلة'} <span>＋</span></button></div>
    </div></article>`;
}

function renderCatalog() {
  const search = ($('#book-search')?.value || '').trim().toLocaleLowerCase('ar');
  const categoryId = $('#category-filter')?.value || 'all';
  const sort = $('#sort-books')?.value || 'newest';
  let filtered = books.filter((book) => book.is_active !== false);
  if (search) filtered = filtered.filter((book) => `${book.title} ${book.author || ''} ${book.description || ''}`.toLocaleLowerCase('ar').includes(search));
  if (categoryId !== 'all') filtered = filtered.filter((book) => (book.category_ids || []).includes(categoryId));
  if (showDiscountOnly) filtered = filtered.filter((book) => discountPercent(book) > 0);
  filtered.sort((a, b) => {
    if (sort === 'price-low') return currentPrice(a) - currentPrice(b);
    if (sort === 'price-high') return currentPrice(b) - currentPrice(a);
    if (sort === 'rating') return Number(reviewStats[b.id]?.average || 0) - Number(reviewStats[a.id]?.average || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  $('#all-books-grid').innerHTML = filtered.map(renderBookCard).join('');
  $('#books-empty').classList.toggle('hidden', filtered.length > 0);
  $('#new-books-grid').innerHTML = books.filter((book) => book.is_new && book.is_active !== false).slice(0, 8).map(renderBookCard).join('') || '<div class="empty-inline">لا توجد إضافات جديدة حالياً.</div>';
}

function renderCategories() {
  $('#categories-grid').innerHTML = categories.map((category) => {
    const img = category.image_path ? storageUrl(category.image_path) : '';
    const count = books.filter((book) => (book.category_ids || []).includes(category.id)).length;
    return `<button class="category-card" data-action="select-category" data-id="${category.id}">${img ? `<img src="${img}" alt="" loading="lazy">` : '<span class="category-flower">✿</span>'}<strong>${escapeHtml(category.name)}</strong><small>${count} كتاب</small></button>`;
  }).join('') || '<div class="empty-inline">سيتم عرض التصنيفات هنا بعد إضافتها.</div>';
  const select = $('#category-filter');
  if (select) {
    const oldValue = select.value;
    select.innerHTML = '<option value="all">كل التصنيفات</option>' + categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('');
    if ([...select.options].some((option) => option.value === oldValue)) select.value = oldValue;
  }
}

function renderReviews() {
  const topReviews = reviews.filter((review) => review.is_published).slice(0, 6);
  $('#reviews-grid').innerHTML = topReviews.map((review) => `<article class="review-card"><div class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div><p>“${escapeHtml(review.comment)}”</p><div class="review-meta"><strong>${escapeHtml(review.display_name || 'قارئ Velvet')}</strong><span>${escapeHtml(review.book_title || 'تجربة مع Velvet')}</span></div></article>`).join('') || '<div class="empty-inline">آراء القرّاء ستظهر هنا بعد اعتمادها.</div>';
}

function renderCart() {
  cart = cart.filter((line) => byId(line.id));
  writeStore('velvet_cart', cart);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  $('#cart-count').textContent = count;
  if ($('#sidebar-cart-count')) $('#sidebar-cart-count').textContent = String(count);
  const itemsHtml = cart.map((line) => {
    const book = byId(line.id);
    return `<div class="cart-line"><img src="${bookCover(book)}" alt=""><div class="cart-line-info"><strong>${escapeHtml(book.title)}</strong><span>${money(currentPrice(book))}</span><div class="quantity-control"><button data-action="cart-quantity" data-id="${book.id}" data-delta="-1" aria-label="تقليل">−</button><b>${line.quantity}</b><button data-action="cart-quantity" data-id="${book.id}" data-delta="1" aria-label="زيادة" ${book.stock_status === 'out' ? 'disabled' : ''}>＋</button></div></div><button class="remove-line" data-action="remove-cart" data-id="${book.id}" aria-label="حذف">×</button></div>`;
  }).join('');
  $('#cart-items').innerHTML = itemsHtml || '<div class="empty-state"><span>✿</span><h3>سلتك ما زالت فارغة</h3><p>أضف كتابك القادم إلى هنا.</p></div>';
  const subtotal = cart.reduce((sum, line) => sum + currentPrice(byId(line.id)) * line.quantity, 0);
  $('#cart-summary').innerHTML = cart.length ? `<div class="summary-row"><span>الإجمالي بعد الخصم</span><strong>${money(subtotal)}</strong></div><small>الحد الأدنى للطلب 100 جنيه.</small><button class="button button-primary button-full" data-action="checkout">إتمام الشراء</button>` : '';
}

function renderWishlist() {
  wishlist = wishlist.filter((id) => byId(id));
  writeStore('velvet_wishlist', wishlist);
  const container = $('#wishlist-items');
  container.innerHTML = wishlist.map((id) => byId(id)).filter(Boolean).map((book) => `<div class="cart-line"><img src="${bookCover(book)}" alt=""><div class="cart-line-info"><strong>${escapeHtml(book.title)}</strong><span>${money(currentPrice(book))}</span><button class="mini-link" data-action="add-cart" data-id="${book.id}">أضف للسلة</button></div><button class="remove-line" data-action="toggle-wishlist" data-id="${book.id}" aria-label="إزالة">×</button></div>`).join('') || '<div class="empty-state"><span>♡</span><h3>قائمة الأمنيات فارغة</h3><p>احفظ الكتب التي ترغب في قراءتها.</p></div>';
  $$('[data-action="toggle-wishlist"]').forEach((button) => {
    const active = wishlist.includes(button.dataset.id);
    button.classList.toggle('is-favorite', active);
    if (button.classList.contains('favorite-button')) button.textContent = active ? '★' : '☆';
  });
}

function refreshHeader() {
  const button = $('#account-button');
  const accountLabel = currentUser ? (profile?.full_name || 'حسابي') : 'تسجيل الدخول';
  if (button) button.textContent = accountLabel;
  const sidebarLabel = $('#sidebar-account-label');
  if (sidebarLabel) sidebarLabel.textContent = accountLabel;
  // يظهر مدخل لوحة الإدارة لصاحبة المتجر فقط بعد تحميل دور الحساب من قاعدة البيانات.
  $('#sidebar-admin-entry')?.classList.toggle('hidden', profile?.role !== 'owner');
}

async function loadPublicData() {
  if (!hasConfig) {
    ['new-books-grid', 'all-books-grid', 'categories-grid', 'reviews-grid'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="setup-note"><strong>المتجر جاهز للربط.</strong><p>أضف رابط Supabase ومفتاح النشر العام في ملف .env ثم نفّذ ملف قاعدة البيانات.</p></div>';
    });
    return;
  }
  try {
    const [bookRes, categoryRes, mappingRes, reviewRes, statsRes, settingsRes] = await Promise.all([
      supabase.from('book_catalog').select('*').order('created_at', { ascending: false }),
      supabase.from('categories').select('id,name,image_path,created_at').eq('is_active', true).order('name'),
      supabase.from('book_categories').select('book_id,category_id'),
      supabase.from('public_reviews').select('*').order('rating', { ascending: false }).order('created_at', { ascending: false }).limit(30),
      supabase.from('book_review_stats').select('*'),
      supabase.from('store_settings').select('key,value').eq('is_public', true)
    ]);
    if (bookRes.error) {
      console.warn('book_catalog failed, falling back to books table', bookRes.error);
      const fallback = await supabase.from('books').select('*').order('created_at', { ascending: false });
      if (fallback.error) throw bookRes.error;
      bookRes.data = fallback.data;
    }
    if (categoryRes.error) throw categoryRes.error;
    books = bookRes.data || [];
    categories = categoryRes.data || [];
    const mappings = mappingRes.data || [];
    books.forEach((book) => { book.category_ids = mappings.filter((row) => row.book_id === book.id).map((row) => row.category_id); });
    reviews = reviewRes.data || [];
    reviewStats = Object.fromEntries((statsRes.data || []).map((row) => [row.book_id, { average: row.average_rating, count: row.review_count }]));
    settings = Object.fromEntries((settingsRes.data || []).map((row) => [row.key, row.value]));
    renderCatalog(); renderCategories(); renderReviews(); renderCart(); renderWishlist(); renderSocialLinks();
  } catch (error) {
    console.error(error);
    toast(`تعذر تحميل بيانات المتجر: ${error.message || 'خطأ غير معروف'}`, 'error');
    const hint = /fetch|network|failed/i.test(String(error.message)) ? 'تعذر الوصول إلى Supabase: تأكد أن المشروع غير متوقف (Paused) من لوحة Supabase وأن الإنترنت أو الـ DNS لا يحجب *.supabase.co.' : 'تأكد من تشغيل ملف supabase/schema.sql ومن أن سياسات RLS تسمح بقراءة الكتب والتصنيفات.';
    ['new-books-grid', 'all-books-grid', 'categories-grid', 'reviews-grid'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<div class="setup-note"><strong>تعذر تحميل البيانات.</strong><p>${escapeHtml(error.message || '')}</p><p>${hint}</p><button class="button button-soft button-small" onclick="location.reload()">إعادة المحاولة</button></div>`;
    });
  }
}

function renderSocialLinks() {
  const links = [
    ['فيسبوك', settings.facebook_url], ['تيك توك', settings.tiktok_url], ['إنستجرام', settings.instagram_url], ['واتساب', settings.whatsapp_number ? `https://wa.me/${String(settings.whatsapp_number).replace(/\D/g, '')}` : '']
  ].filter(([, url]) => typeof url === 'string' && url.trim());
  $('#social-links').innerHTML = links.length ? links.map(([label, url]) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join('') : '<span>روابط التواصل ستظهر هنا بعد إعدادها.</span>';
}

function addToCart(id) {
  const book = byId(id);
  if (!book || book.stock_status === 'out') return toast('هذا الكتاب غير متاح حالياً.', 'error');
  const line = cart.find((item) => item.id === id);
  if (line) line.quantity += 1; else cart.push({ id, quantity: 1 });
  writeStore('velvet_cart', cart); renderCart(); toast('تمت إضافة الكتاب إلى السلة.');
}

async function toggleWishlist(id) {
  const existed = wishlist.includes(id);
  wishlist = existed ? wishlist.filter((item) => item !== id) : [...wishlist, id];
  writeStore('velvet_wishlist', wishlist);
  if (currentUser && supabase) {
    try {
      if (existed) await supabase.from('wishlist').delete().eq('user_id', currentUser.id).eq('book_id', id);
      else await supabase.from('wishlist').upsert({ user_id: currentUser.id, book_id: id }, { onConflict: 'user_id,book_id' });
    } catch (error) { console.warn(error); }
  }
  renderCatalog(); renderWishlist(); toast(existed ? 'تمت الإزالة من قائمة الأمنيات.' : 'أضيف الكتاب إلى قائمة الأمنيات.');
}

async function loadWishlistFromAccount() {
  if (!currentUser || !supabase) return;
  const { data, error } = await supabase.from('wishlist').select('book_id');
  if (error) return console.warn(error);
  const saved = (data || []).map((row) => row.book_id);
  wishlist = [...new Set([...wishlist, ...saved])];
  if (wishlist.length) {
    const { error: syncError } = await supabase.from('wishlist').upsert(
      wishlist.map((book_id) => ({ user_id: currentUser.id, book_id })),
      { onConflict: 'user_id,book_id', ignoreDuplicates: true }
    );
    if (syncError) console.warn('Wishlist sync:', syncError.message);
  }
  writeStore('velvet_wishlist', wishlist);
  renderCatalog(); renderWishlist();
}

function showBookDetails(id) {
  const book = byId(id);
  if (!book) return;
  const stats = reviewStats[id] || { average: 0, count: 0 };
  const bookReviews = reviews.filter((review) => review.book_id === id && review.is_published);
  const discount = discountPercent(book);
  const cats = categories.filter((cat) => (book.category_ids || []).includes(cat.id)).map((cat) => cat.name).join('، ');
  showModal(`<div class="modal-heading"><div><span class="section-kicker">تفاصيل الكتاب</span><h2>${escapeHtml(book.title)}</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
    <div class="book-detail"><img src="${bookCover(book)}" alt="غلاف ${escapeHtml(book.title)}"><div class="book-detail-copy"><p class="book-author">${escapeHtml(book.author || 'كاتب غير محدد')}</p><p>${escapeHtml(book.description || 'لا يوجد وصف متاح لهذا الكتاب حالياً.')}</p>
    <div class="detail-facts"><span>عدد الصفحات: ${book.pages ?? 'غير محدد'}</span><span>التصنيف: ${escapeHtml(cats || 'غير مصنف')}</span><span>التقييم: ${stats.count ? `${Number(stats.average).toFixed(1)} من 5 (${stats.count})` : 'لا توجد تقييمات'}</span><span>الحالة: ${stockLabel(book.stock_status)}</span></div>
    <div class="detail-price">${discount ? `<del>${money(book.original_price)}</del>` : ''}<strong>${money(currentPrice(book))}</strong>${discount ? `<span class="discount-badge">خصم ${discount}%</span>` : ''}</div>
    <div class="detail-actions"><button class="button button-primary" data-action="add-cart" data-id="${id}" ${book.stock_status === 'out' ? 'disabled' : ''}>أضف إلى السلة</button><button class="button button-soft" data-action="toggle-wishlist" data-id="${id}">☆ قائمة الأمنيات</button></div></div></div>
    <div class="detail-reviews"><h3>تقييمات القرّاء</h3>${bookReviews.map((review) => `<div class="review-line"><b>${escapeHtml(review.display_name || 'قارئ Velvet')}</b><span>${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</span><p>${escapeHtml(review.comment)}</p></div>`).join('') || '<p class="muted">لا توجد مراجعات معتمدة لهذا الكتاب بعد.</p>'}
    ${currentUser ? `<form id="review-form" class="stack-form"><h4>شاركنا رأيك</h4><input type="hidden" name="book_id" value="${id}"><label>التقييم<select name="rating" required><option value="5">5 نجوم</option><option value="4">4 نجوم</option><option value="3">3 نجوم</option><option value="2">نجمتان</option><option value="1">نجمة واحدة</option></select></label><label>تعليقك<textarea name="comment" minlength="3" maxlength="1200" required placeholder="اكتب رأيك في الكتاب..."></textarea></label><button class="button button-primary">إرسال التقييم للمراجعة</button></form>` : '<p class="muted">سجّل الدخول لكتابة تقييم.</p>'}</div>`);
}

function accountModal() {
  if (!currentUser) {
    showModal(`<div class="modal-heading"><div><span class="section-kicker">مرحباً بك</span><h2>حساب Velvet</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
      <div class="auth-tabs"><button class="active" data-action="auth-tab" data-tab="login">تسجيل الدخول</button><button data-action="auth-tab" data-tab="register">إنشاء حساب</button></div>
      <form id="auth-form" class="stack-form"><input type="hidden" name="mode" value="login"><label>البريد الإلكتروني<input name="email" type="email" autocomplete="email" required></label><label>كلمة المرور<input name="password" type="password" minlength="6" autocomplete="current-password" required></label><div id="register-fields" class="hidden"><label>الاسم الكامل<input name="full_name" autocomplete="name"></label><label>رقم الهاتف<input name="phone" autocomplete="tel"></label></div><button class="button button-primary button-full" type="submit">تسجيل الدخول</button><button type="button" class="text-button" data-action="forgot-password">نسيت كلمة المرور؟</button></form>`);
  } else {
    showModal(`<div class="modal-heading"><div><span class="section-kicker">مساحتك في Velvet</span><h2>أهلاً ${escapeHtml(profile?.full_name || currentUser.email)}</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
      <div class="account-tabs"><button class="active" data-action="account-tab" data-tab="profile">بياناتي</button><button data-action="account-tab" data-tab="orders">طلباتي</button><button data-action="account-tab" data-tab="messages">المحادثات</button>${profile?.role === 'owner' ? '<button data-action="open-admin">لوحة الإدارة</button>' : ''}</div><div id="account-content"><div class="loading-line">جارٍ تحميل الحساب…</div></div><button class="button button-soft button-full" data-action="logout">تسجيل الخروج</button>`);
    renderAccountTab('profile');
  }
}

async function renderAccountTab(tab) {
  const content = $('#account-content');
  if (!content || !currentUser) return;
  $$('.account-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  if (tab === 'profile') {
    content.innerHTML = `<form id="profile-form" class="stack-form"><label>الاسم الكامل<input name="full_name" value="${escapeHtml(profile?.full_name || '')}" required></label><label>رقم الهاتف<input name="phone" value="${escapeHtml(profile?.phone || '')}"></label><label>عنوان التوصيل<textarea name="address">${escapeHtml(profile?.address || '')}</textarea></label><label>البريد الإلكتروني<input value="${escapeHtml(currentUser.email)}" disabled></label><button class="button button-primary">حفظ البيانات</button></form>`;
  } else if (tab === 'orders') {
    content.innerHTML = '<div class="loading-line">جارٍ تحميل طلباتك…</div>';
    const { data, error } = await supabase.from('orders').select('id,order_code,total,payment_method,payment_status,status,created_at').order('created_at', { ascending: false });
    if (error) return content.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    content.innerHTML = (data || []).map((order) => `<article class="order-card"><div><strong>${escapeHtml(order.order_code)}</strong><span>${new Date(order.created_at).toLocaleDateString('ar-EG')}</span></div><div><b>${money(order.total)}</b><span class="status-pill">${escapeHtml(orderStatusLabel(order.status))}</span></div><button class="mini-link" data-action="customer-order-details" data-id="${order.id}">التفاصيل</button><button class="mini-link" data-action="order-chat" data-id="${order.id}">محادثة الطلب</button></article>`).join('') || '<div class="empty-inline">لا توجد طلبات حتى الآن.</div>';
  } else if (tab === 'messages') {
    content.innerHTML = '<div class="loading-line">جارٍ تحميل المحادثات…</div>';
    const { data, error } = await supabase.from('conversations').select('id,order_id,orders(order_code,status)').order('created_at', { ascending: false });
    if (error) return content.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
    content.innerHTML = (data || []).map((conversation) => `<button class="conversation-row" data-action="open-chat" data-id="${conversation.id}"><strong>${escapeHtml(conversation.orders?.order_code || 'محادثة')}</strong><span>${escapeHtml(orderStatusLabel(conversation.orders?.status))}</span></button>`).join('') || '<div class="empty-inline">لا توجد محادثات حالياً. ستظهر محادثة تلقائياً مع كل طلب.</div>';
  }
}

function orderStatusLabel(status) {
  return ({ new: 'طلب جديد', awaiting_payment: 'بانتظار الدفع', payment_review: 'الدفع قيد المراجعة', paid: 'تم تأكيد الدفع', preparing: 'جارٍ تجهيز الطلب', shipped: 'تم الشحن', delivered: 'تم التسليم', cancelled: 'تم الإلغاء' })[status] || status || '—';
}

async function openAuthTab(tab) {
  const form = $('#auth-form');
  if (!form) return;
  form.elements.mode.value = tab;
  $('#register-fields').classList.toggle('hidden', tab !== 'register');
  form.querySelector('button[type="submit"]').textContent = tab === 'register' ? 'إنشاء حساب' : 'تسجيل الدخول';
  $$('.auth-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
}

async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) return toast(error.message, 'error');
  currentUser = null; profile = null; stopRealtime(); refreshHeader(); closeModal(); toast('تم تسجيل الخروج.');
}

async function loadProfile() {
  if (!currentUser) { profile = null; return; }
  const { data, error } = await supabase.from('profiles').select('id,full_name,phone,address,role').eq('id', currentUser.id).single();
  if (error) throw error;
  profile = data;
  refreshHeader();
}

function renderCheckout() {
  const total = cart.reduce((sum, item) => sum + (currentPrice(byId(item.id)) * item.quantity), 0);
  if (total < 100) return toast('نعتذر، الحد الأدنى للطلب هو 100 جنيه.', 'error');
  if (!currentUser) {
    resumeCartAfterAuth = true;
    closePanels(); accountModal(); toast('سجّل الدخول أولاً، وستظل كتبك في السلة.'); return;
  }
  const exactMinimum = Math.abs(total - 100) < 0.001;
  const instapay = String(settings.instapay_details || '').trim();
  const vodafone = String(settings.vodafone_cash_number || '').trim();
  const paymentChoices = exactMinimum
    ? '<label class="payment-choice"><input type="radio" name="payment_method" value="cod" checked><span><b>الدفع عند الاستلام</b><small>متاح للطلبات التي تساوي 100 جنيه بالضبط.</small></span></label>'
    : `<p class="payment-note">لأن إجمالي طلبك أكبر من 100 جنيه، يلزم الدفع المسبق بإحدى الوسيلتين.</p>
      ${instapay ? `<label class="payment-choice"><input type="radio" name="payment_method" value="instapay" checked><span><b>إنستاباي</b><small>${escapeHtml(instapay)}</small></span></label>` : ''}
      ${vodafone ? `<label class="payment-choice"><input type="radio" name="payment_method" value="vodafone_cash" ${!instapay ? 'checked' : ''}><span><b>فودافون كاش</b><small>${escapeHtml(vodafone)}</small></span></label>` : ''}
      ${!instapay && !vodafone ? '<p class="form-error">لم يضف المتجر بيانات الدفع بعد. لا يمكن إرسال الطلب حالياً؛ تواصل مع المتجر لاحقاً.</p>' : '<label>رقم العملية (اختياري)<input name="transaction_reference" maxlength="120" placeholder="أدخل رقم التحويل بعد الدفع"></label><label>إثبات الدفع (صورة أو PDF)<input name="payment_proof" type="file" accept="image/*,application/pdf"></label><small>ارفع صورة التحويل أو أدخل رقم العملية. الحد الأقصى 5 ميجابايت.</small>'}`;
  showModal(`<div class="modal-heading"><div><span class="section-kicker">خطوة أخيرة</span><h2>إتمام الطلب</h2></div><button class="icon-button" data-action="close-modal">×</button></div>
    <div class="checkout-total"><span>إجمالي الطلب بعد الخصومات</span><strong>${money(total)}</strong></div>
    <form id="checkout-form" class="stack-form"><label>اسم المستلم<input name="customer_name" required value="${escapeHtml(profile?.full_name || '')}"></label><label>رقم الهاتف<input name="phone" required value="${escapeHtml(profile?.phone || '')}"></label><label>عنوان التوصيل<textarea name="shipping_address" required>${escapeHtml(profile?.address || '')}</textarea></label><div class="payment-methods"><h3>طريقة الدفع</h3>${paymentChoices}</div><p class="policy-copy">الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.</p><label class="policy-check"><input name="accept_policy" type="checkbox" required> أوافق على سياسة المتجر.</label><button class="button button-primary button-full" type="submit" ${(exactMinimum || instapay || vodafone) ? '' : 'disabled'}>تأكيد الطلب</button></form>`);
}

async function processCheckout(form) {
  const formData = new FormData(form);
  const items = cart.map((line) => ({ book_id: line.id, quantity: line.quantity }));
  const paymentMethod = formData.get('payment_method');
  const proof = formData.get('payment_proof');
  const reference = String(formData.get('transaction_reference') || '').trim();
  const total = cart.reduce((sum, line) => sum + currentPrice(byId(line.id)) * line.quantity, 0);
  if (total < 100) return toast('نعتذر، الحد الأدنى للطلب هو 100 جنيه.', 'error');
  if (Math.abs(total - 100) < 0.001 && paymentMethod !== 'cod') return toast('الطلب الذي يساوي 100 جنيه متاح له الدفع عند الاستلام فقط.', 'error');
  if (total > 100 && !['instapay', 'vodafone_cash'].includes(paymentMethod)) return toast('اختر إنستاباي أو فودافون كاش.', 'error');
  if (total > 100 && !reference && !(proof instanceof File && proof.size > 0)) return toast('أدخل رقم العملية أو ارفع إثبات الدفع.', 'error');
  if (proof instanceof File && proof.size > 5 * 1024 * 1024) return toast('حجم إثبات الدفع يجب ألا يتجاوز 5 ميجابايت.', 'error');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true; submit.textContent = 'جارٍ إنشاء الطلب…';
  let createdOrder = null;
  try {
    const { data, error } = await supabase.rpc('create_order', {
      p_items: items,
      p_payment_method: paymentMethod,
      p_shipping_address: String(formData.get('shipping_address')),
      p_phone: String(formData.get('phone')),
      p_customer_name: String(formData.get('customer_name'))
    });
    if (error) throw error;
    const order = typeof data === 'string' ? JSON.parse(data) : data;
    createdOrder = order;
    if (total > 100 && proof instanceof File && proof.size > 0) {
      const cleanName = proof.name.replace(/[^\w.-]/g, '_').slice(-80);
      const path = `${currentUser.id}/${order.id}/${crypto.randomUUID()}-${cleanName}`;
      const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(path, proof, { contentType: proof.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: proofError } = await supabase.rpc('submit_payment_proof', { p_order_id: order.id, p_proof_path: path, p_transaction_reference: reference || null });
      if (proofError) throw proofError;
    } else if (total > 100 && reference) {
      const { error: proofError } = await supabase.rpc('submit_payment_proof', { p_order_id: order.id, p_proof_path: null, p_transaction_reference: reference });
      if (proofError) throw proofError;
    }
    cart = []; writeStore('velvet_cart', cart); renderCart(); closePanels();
    const methodName = paymentMethod === 'cod' ? 'الدفع عند الاستلام' : paymentMethod === 'instapay' ? 'إنستاباي' : 'فودافون كاش';
    const message = `مرحباً Velvet، تم إنشاء طلب جديد.\nكود الطلب: ${order.order_code}\nالاسم: ${formData.get('customer_name')}\nالإجمالي: ${money(order.total)}\nطريقة الدفع: ${methodName}`;
    const phone = String(settings.whatsapp_number || '').replace(/\D/g, '');
    const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : '';
    showModal(`<div class="success-state"><span class="success-mark">✓</span><span class="section-kicker">تم استلام طلبك</span><h2>شكراً لاختيارك Velvet</h2><p>كود طلبك هو</p><strong class="order-code">${escapeHtml(order.order_code)}</strong><p>${total > 100 ? 'حالة الطلب: بانتظار مراجعة الدفع.' : 'حالة الطلب: طلب جديد وسيتم التواصل معك.'}</p>${whatsappUrl ? `<a class="button button-primary button-full" href="${whatsappUrl}" target="_blank" rel="noopener noreferrer">إرسال تفاصيل الطلب عبر واتساب</a>` : '<p class="muted">لم يضف المتجر رقم واتساب بعد.</p>'}<button class="button button-soft button-full" data-action="close-modal">متابعة التصفح</button></div>`);
    toast('تم إنشاء الطلب بنجاح.');
    await loadPublicData();
  } catch (error) {
    console.error(error);
    if (createdOrder) {
      cart = []; writeStore('velvet_cart', cart); renderCart(); closePanels();
      showModal(`<div class="success-state"><span class="success-mark">✓</span><h2>تم إنشاء الطلب</h2><p>كود الطلب: <b>${escapeHtml(createdOrder.order_code)}</b></p><p>تعذر رفع إثبات التحويل الآن. افتح تفاصيل الطلب لرفع الإثبات مرة أخرى دون إنشاء طلب مكرر.</p><button class="button button-primary button-full" data-action="customer-order-details" data-id="${createdOrder.id}">فتح تفاصيل الطلب</button></div>`);
      toast('تم إنشاء الطلب، لكن لم يكتمل رفع إثبات الدفع.', 'error');
    } else {
      toast(error.message || 'تعذر إتمام الطلب.', 'error');
      submit.disabled = false; submit.textContent = 'تأكيد الطلب';
    }
  }
}

async function submitReview(form) {
  if (!currentUser) return toast('سجّل الدخول أولاً.', 'error');
  const fd = new FormData(form);
  const { error } = await supabase.from('reviews').insert({ book_id: fd.get('book_id'), rating: Number(fd.get('rating')), comment: String(fd.get('comment')).trim() });
  if (error) return toast(error.message.includes('duplicate') ? 'سبق أن قيّمت هذا الكتاب.' : error.message, 'error');
  closeModal(); toast('تم إرسال تقييمك، وسيظهر بعد مراجعته.');
}

async function uploadCover(file, folder = 'books') {
  if (!file || !file.type.startsWith('image/')) throw new Error('اختر ملف صورة صالحاً.');
  if (file.size > 5 * 1024 * 1024) throw new Error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from('book-covers').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

async function openAdmin() {
  if (!hasConfig) return toast('اربط المتجر بقاعدة بيانات Supabase أولاً.', 'error');
  if (!currentUser) {
    closeStoreSidebar();
    accountModal();
    toast('سجّل الدخول بحساب صاحب المتجر أولاً.');
    return;
  }
  // أعد قراءة الدور من Supabase عند الضغط، حتى لا نعتمد على بيانات قديمة في الواجهة.
  try {
    await loadProfile();
  } catch (error) {
    console.error('Owner permission check failed:', error);
    return toast('تعذر التحقق من صلاحية الحساب. راجع اتصال Supabase وبيانات الحساب.', 'error');
  }
  if (profile?.role !== 'owner') {
    return toast('هذا الحساب ليس لديه صلاحية المالك. يجب تفعيل role = owner من Supabase.', 'error');
  }
  currentAdminTab = 'overview';
  await renderAdmin();
}

function adminShell(content) {
  return `<div class="admin-shell"><aside class="admin-sidebar"><div class="admin-brand"><span class="brand-mark">V</span><div><b>Velvet</b><small>لوحة الإدارة</small></div></div><nav>${[
    ['overview','الرئيسية','⌂'],['books','إدارة الكتب','▤'],['categories','التصنيفات','▦'],['orders','الطلبات والأرشيف','▣'],['chats','المحادثات','✉'],['reviews','مراجعات العملاء','★'],['analytics','التحليلات','▥'],['settings','إعدادات المتجر','⚙']
  ].map(([tab,label,icon]) => `<button class="admin-nav-item ${currentAdminTab === tab ? 'active' : ''}" data-action="admin-tab" data-tab="${tab}"><span>${icon}</span>${label}</button>`).join('')}</nav><button class="admin-back" data-action="close-modal">العودة إلى المتجر</button></aside><section class="admin-main"><header class="admin-topbar"><div><span class="section-kicker">مساحة الإدارة الآمنة</span><h2>${({overview:'نظرة عامة',books:'إدارة الكتب',categories:'إدارة التصنيفات',orders:'الطلبات والأرشيف',chats:'محادثات العملاء',reviews:'مراجعات العملاء',analytics:'التحليلات والإحصائيات',settings:'إعدادات المتجر'})[currentAdminTab]}</h2></div><span class="admin-user">${escapeHtml(profile?.full_name || currentUser.email)}</span></header><div id="admin-content">${content}</div></section></div>`;
}

async function renderAdmin() {
  if (profile?.role !== 'owner') return toast('غير مصرح بالدخول.', 'error');
  showModal(adminShell('<div class="loading-line">جارٍ تحميل البيانات…</div>'), 'admin-modal');
  const content = $('#admin-content');
  try {
    if (currentAdminTab === 'overview') {
      const today = new Date(); today.setHours(0,0,0,0);
      const [ordersRes, booksRes, visitsRes, pendingRes] = await Promise.all([
        supabase.from('orders').select('id,total,status,created_at'),
        supabase.from('books').select('id,title,stock_qty,is_active'),
        supabase.from('visits').select('id,visited_on'),
        supabase.from('orders').select('id').in('status', ['new','awaiting_payment','payment_review'])
      ]);
      [ordersRes,booksRes,visitsRes,pendingRes].forEach((res) => { if (res.error) throw res.error; });
      const orders = ordersRes.data || []; const orderToday = orders.filter((o) => new Date(o.created_at) >= today);
      const visitsToday = (visitsRes.data || []).filter((v) => v.visited_on === today.toISOString().slice(0,10)).length;
      content.innerHTML = `<div class="admin-stat-grid"><article><span>زيارات اليوم</span><strong>${visitsToday}</strong></article><article><span>طلبات اليوم</span><strong>${orderToday.length}</strong></article><article><span>طلبات تحتاج متابعة</span><strong>${(pendingRes.data || []).length}</strong></article><article><span>قيمة طلبات اليوم</span><strong>${money(orderToday.reduce((s,o)=>s+Number(o.total),0))}</strong></article><article><span>إجمالي الكتب</span><strong>${(booksRes.data || []).length}</strong></article><article><span>طلبات مكتملة اليوم</span><strong>${orderToday.filter((o)=>o.status==='delivered').length}</strong></article><article><span>طلبات ملغاة اليوم</span><strong>${orderToday.filter((o)=>o.status==='cancelled').length}</strong></article></div><div class="admin-panel"><div class="admin-panel-heading"><h3>أحدث الطلبات</h3><button class="mini-link" data-action="admin-tab" data-tab="orders">عرض الأرشيف ←</button></div>${orders.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,7).map((o)=>`<div class="admin-list-row"><b>${escapeHtml(o.id.slice(0,8).toUpperCase())}</b><span>${money(o.total)}</span><span class="status-pill">${orderStatusLabel(o.status)}</span><small>${new Date(o.created_at).toLocaleString('ar-EG')}</small></div>`).join('') || '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
    } else if (currentAdminTab === 'books') {
      const { data, error } = await supabase.from('books').select('*').order('created_at',{ascending:false}); if(error) throw error;
      const { data: mapping } = await supabase.from('book_categories').select('book_id,category_id');
      content.innerHTML = `<div class="admin-panel"><div class="admin-panel-heading"><h3>الكتب والمخزون</h3><button class="button button-primary button-small" data-action="admin-add-book">＋ إضافة كتاب</button></div><div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>الكتاب</th><th>السعر</th><th>المخزون الحقيقي</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>${(data||[]).map((book)=>`<tr><td><b>${escapeHtml(book.title)}</b><small>${escapeHtml(book.author||'')}</small></td><td>${money(book.sale_price ?? book.original_price)}</td><td>${book.stock_qty}</td><td>${book.is_active?'ظاهر':'مخفي'}</td><td><button class="mini-link" data-action="edit-book" data-id="${book.id}">تعديل</button> <button class="mini-link danger-link" data-action="delete-book" data-id="${book.id}">حذف</button></td></tr>`).join('')}</tbody></table></div></div>`;
      window._velvetAdminBookCategories = mapping || [];
    } else if (currentAdminTab === 'categories') {
      const { data, error } = await supabase.from('categories').select('*').order('name'); if(error) throw error;
      content.innerHTML = `<div class="admin-panel"><div class="admin-panel-heading"><h3>التصنيفات</h3><button class="button button-primary button-small" data-action="admin-add-category">＋ تصنيف جديد</button></div>${(data||[]).map((cat)=>`<div class="admin-list-row"><b>${escapeHtml(cat.name)}</b><small>${cat.is_active?'نشط':'مخفي'}</small><button class="mini-link" data-action="edit-category" data-id="${cat.id}">تعديل</button><button class="mini-link danger-link" data-action="delete-category" data-id="${cat.id}">حذف</button></div>`).join('') || '<p class="muted">لم تتم إضافة تصنيفات.</p>'}</div>`;
    } else if (currentAdminTab === 'orders') {
      const { data, error } = await supabase.from('orders').select('*,order_items(book_id,title_snapshot,quantity,unit_price),profiles(full_name,email)').order('created_at',{ascending:false}); if(error) throw error;
      content.innerHTML = `<div class="admin-panel"><div class="admin-panel-heading"><h3>جميع الطلبات</h3><input id="order-search" class="admin-search" placeholder="بحث بكود الطلب أو الاسم أو الهاتف"></div>${(data||[]).map((o)=>`<article class="admin-order" data-order-search="${escapeHtml(`${o.order_code} ${o.customer_name||''} ${o.phone||''}`.toLowerCase())}"><div class="admin-order-head"><div><b>${escapeHtml(o.order_code)}</b><small>${escapeHtml(o.customer_name||o.profiles?.full_name||'عميل')} · ${escapeHtml(o.phone||'')}</small></div><strong>${money(o.total)}</strong></div><div class="order-items-summary">${(o.order_items||[]).map((i)=>`${escapeHtml(i.title_snapshot)} × ${i.quantity}`).join('، ')}</div><div class="admin-order-controls"><span class="status-pill">${orderStatusLabel(o.status)}</span><select data-order-status="${o.id}">${[['new','طلب جديد'],['awaiting_payment','بانتظار الدفع'],['payment_review','الدفع قيد المراجعة'],['paid','تم تأكيد الدفع'],['preparing','جارٍ التجهيز'],['shipped','تم الشحن'],['delivered','تم التسليم'],['cancelled','إلغاء الطلب']].map(([v,l])=>`<option value="${v}" ${v===o.status?'selected':''}>${l}</option>`).join('')}</select>${o.payment_method!=='cod' && o.payment_status==='under_review' ? `<button class="mini-link" data-action="review-payment" data-id="${o.id}" data-approved="true">اعتماد الدفع</button><button class="mini-link danger-link" data-action="review-payment" data-id="${o.id}" data-approved="false">رفض الدفع</button>` : ''}<button class="mini-link" data-action="view-order" data-id="${o.id}">التفاصيل</button></div></article>`).join('') || '<p class="muted">لا توجد طلبات بعد.</p>'}</div>`;
    } else if (currentAdminTab === 'chats') {
      const { data, error } = await supabase.from('conversations').select('id,created_at,orders(order_code,customer_name)').order('created_at',{ascending:false}); if(error) throw error;
      content.innerHTML = `<div class="admin-panel"><h3>محادثات العملاء</h3>${(data||[]).map((c)=>`<button class="conversation-row" data-action="admin-chat" data-id="${c.id}"><strong>${escapeHtml(c.orders?.order_code||'محادثة')}</strong><span>${escapeHtml(c.orders?.customer_name||'عميل')}</span></button>`).join('') || '<p class="muted">لا توجد محادثات بعد.</p>'}</div>`;
    } else if (currentAdminTab === 'reviews') {
      const { data, error } = await supabase.from('reviews').select('id,rating,comment,is_published,created_at,profiles(full_name),books(title)').order('created_at',{ascending:false}); if(error) throw error;
      content.innerHTML = `<div class="admin-panel"><h3>مراجعات العملاء</h3>${(data||[]).map((r)=>`<article class="admin-review"><div><b>${escapeHtml(r.books?.title||'كتاب')}</b><span>${escapeHtml(r.profiles?.full_name||'قارئ')} · ${'★'.repeat(r.rating)}</span></div><p>${escapeHtml(r.comment)}</p><button class="mini-link" data-action="toggle-review" data-id="${r.id}" data-published="${r.is_published}">${r.is_published?'إخفاء المراجعة':'اعتماد المراجعة'}</button></article>`).join('') || '<p class="muted">لا توجد مراجعات.</p>'}</div>`;
    } else if (currentAdminTab === 'analytics') {
      const [ordersRes, visitsRes] = await Promise.all([supabase.from('orders').select('total,status,created_at'),supabase.from('visits').select('visited_on,visitor_key')]);
      if(ordersRes.error) throw ordersRes.error; if(visitsRes.error) throw visitsRes.error;
      const now = new Date(); const start = new Date(now); start.setDate(start.getDate()-29); start.setHours(0,0,0,0);
      const orders = ordersRes.data||[], visits=visitsRes.data||[];
      const days = Array.from({length:30},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i); const key=d.toISOString().slice(0,10);return {key,label:d.toLocaleDateString('ar-EG',{day:'numeric',month:'short'}),orders:orders.filter(o=>o.created_at.slice(0,10)===key).length,visits:visits.filter(v=>v.visited_on===key).length,total:orders.filter(o=>o.created_at.slice(0,10)===key).reduce((s,o)=>s+Number(o.total),0)}});
      const maxVisits=Math.max(1,...days.map(d=>d.visits)); const maxOrders=Math.max(1,...days.map(d=>d.orders));
      const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const previousStart=new Date(now.getFullYear(),now.getMonth()-1,1);const currentMonthOrders=orders.filter(o=>new Date(o.created_at)>=monthStart);const previousMonthOrders=orders.filter(o=>new Date(o.created_at)>=previousStart&&new Date(o.created_at)<monthStart);const currentMonthVisits=new Set(visits.filter(v=>v.visited_on>=monthStart.toISOString().slice(0,10)).map(v=>v.visitor_key)).size;const previousMonthVisits=new Set(visits.filter(v=>v.visited_on>=previousStart.toISOString().slice(0,10)&&v.visited_on<monthStart.toISOString().slice(0,10)).map(v=>v.visitor_key)).size;const pct=(a,b)=>b===0?(a?100:0):Math.round((a-b)/b*100);const weekDays=days.slice(-7);
      content.innerHTML = `<div class="admin-stat-grid"><article><span>زيارات آخر 30 يوم</span><strong>${days.reduce((s,d)=>s+d.visits,0)}</strong></article><article><span>طلبات آخر 30 يوم</span><strong>${days.reduce((s,d)=>s+d.orders,0)}</strong></article><article><span>قيمة الطلبات</span><strong>${money(days.reduce((s,d)=>s+d.total,0))}</strong></article><article><span>طلبات الشهر الحالي</span><strong>${currentMonthOrders.length}</strong><small>مقارنة بالشهر السابق: ${pct(currentMonthOrders.length,previousMonthOrders.length)>0?'+':''}${pct(currentMonthOrders.length,previousMonthOrders.length)}%</small></article><article><span>زيارات الشهر الحالي</span><strong>${currentMonthVisits.length}</strong><small>مقارنة بالشهر السابق: ${pct(currentMonthVisits.length,previousMonthVisits.length)>0?'+':''}${pct(currentMonthVisits.length,previousMonthVisits.length)}%</small></article><article><span>طلبات آخر 7 أيام</span><strong>${weekDays.reduce((s,d)=>s+d.orders,0)}</strong></article></div><div class="admin-panel"><h3>الأداء اليومي خلال آخر 30 يوماً</h3><div class="analytics-chart">${days.map(d=>`<div class="chart-column" title="${d.label}: ${d.visits} زيارة، ${d.orders} طلب"><div class="chart-bars"><i style="height:${Math.max(2,d.visits/maxVisits*100)}%"></i><b style="height:${Math.max(2,d.orders/maxOrders*100)}%"></b></div><small>${d.label}</small></div>`).join('')}</div><div class="chart-legend"><span><i></i> الزيارات</span><span><b></b> الطلبات</span></div></div><p class="muted">الأرقام مبنية على الزيارات الفريدة المسجلة والطلبات التي أنشئت في قاعدة البيانات.</p>`;
    } else if (currentAdminTab === 'settings') {
      const fields = [['whatsapp_number','رقم واتساب (بالصيغة الدولية دون +)'],['instapay_details','بيانات إنستاباي'],['vodafone_cash_number','رقم فودافون كاش'],['facebook_url','رابط فيسبوك'],['tiktok_url','رابط تيك توك'],['instagram_url','رابط إنستجرام'],['return_policy','سياسة الاستبدال والاسترجاع']];
      content.innerHTML = `<div class="admin-panel"><h3>بيانات المتجر ووسائل الدفع والتواصل</h3><form id="settings-form" class="stack-form">${fields.map(([key,label])=>`<label>${label}${key==='return_policy'?`<textarea name="${key}" rows="5">${escapeHtml(settings[key]||'الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.')}</textarea>`:`<input name="${key}" value="${escapeHtml(settings[key]||'')}">`}</label>`).join('')}<button class="button button-primary">حفظ الإعدادات</button></form></div>`;
    }
  } catch (error) { console.error(error); content.innerHTML = `<div class="setup-note"><strong>تعذر تحميل القسم.</strong><p>${escapeHtml(error.message)}</p></div>`; }
}

function adminBookForm(book = null) {
  const editing = Boolean(book);
  const linked = window._velvetAdminBookCategories || [];
  const selected = linked.filter((row)=>row.book_id===book?.id).map((row)=>row.category_id);
  showModal(`<div class="modal-heading"><div><span class="section-kicker">إدارة المكتبة</span><h2>${editing?'تعديل كتاب':'إضافة كتاب جديد'}</h2></div><button class="icon-button" data-action="close-modal">×</button></div><form id="admin-book-form" class="stack-form"><input type="hidden" name="id" value="${book?.id||''}"><label>اسم الكتاب<input name="title" required value="${escapeHtml(book?.title||'')}"></label><label>اسم الكاتب<input name="author" value="${escapeHtml(book?.author||'')}"></label><div class="form-row"><label>عدد الصفحات<input name="pages" type="number" min="1" value="${book?.pages??''}"></label><label>الكمية المتاحة<input name="stock_qty" type="number" min="0" required value="${book?.stock_qty??0}"></label></div><div class="form-row"><label>السعر الأصلي بالجنيه<input name="original_price" type="number" min="0.01" step="0.01" required value="${book?.original_price??''}"></label><label>السعر بعد الخصم (اختياري)<input name="sale_price" type="number" min="0.01" step="0.01" value="${book?.sale_price??''}"></label></div><label>وصف الكتاب<textarea name="description" rows="4">${escapeHtml(book?.description||'')}</textarea></label><label>صورة غلاف الكتاب<input id="admin-cover-file" name="cover" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><small>اختر صورة من جهازك. الحد الأقصى 5 ميجابايت، وستُرفع إلى مساحة أغلفة الكتب في Supabase.</small></label><div class="admin-cover-preview-wrap"><span>معاينة الغلاف</span><img id="admin-cover-preview" src="${book?.cover_path ? escapeHtml(storageUrl(book.cover_path)) : ''}" alt="معاينة غلاف الكتاب" class="${book?.cover_path ? '' : 'hidden'}"><p id="admin-cover-placeholder" class="${book?.cover_path ? 'hidden' : ''}">لم يتم اختيار صورة بعد</p></div><label>التصنيفات<select name="categories" multiple size="5">${categories.map((c)=>`<option value="${c.id}" ${selected.includes(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}</select><small>يمكن اختيار أكثر من تصنيف باستخدام Ctrl أو الضغط المطوّل على الهاتف.</small></label><label class="policy-check"><input name="is_active" type="checkbox" ${book?.is_active===false?'':'checked'}> عرض الكتاب في المتجر</label><button class="button button-primary">${editing?'حفظ التعديلات':'إضافة الكتاب'}</button></form>`, 'form-modal');
}

async function saveAdminBook(form) {
  const fd = new FormData(form); const id = String(fd.get('id')||''); const title=String(fd.get('title')).trim();
  const original = Number(fd.get('original_price')); const saleRaw=String(fd.get('sale_price')||'').trim(); const sale=saleRaw?Number(saleRaw):null;
  if (sale !== null && sale > original) return toast('سعر الخصم يجب أن يكون أقل من السعر الأصلي.', 'error');
  const data = { title, author:String(fd.get('author')||'').trim()||null, pages:fd.get('pages')?Number(fd.get('pages')):null, stock_qty:Number(fd.get('stock_qty')), description:String(fd.get('description')||''), original_price:original, sale_price:sale, is_active:fd.has('is_active') };
  try {
    const file = fd.get('cover'); if(file instanceof File && file.size>0) data.cover_path = await uploadCover(file);
    let saved;
    if(id){ const {data:updated,error}=await supabase.from('books').update(data).eq('id',id).select('id').single(); if(error)throw error; saved=updated; }
    else { const {data:inserted,error}=await supabase.from('books').insert(data).select('id').single(); if(error)throw error; saved=inserted; }
    const selected = [...form.elements.categories.selectedOptions].map((option)=>option.value);
    const {error:deleteError}=await supabase.from('book_categories').delete().eq('book_id',saved.id); if(deleteError)throw deleteError;
    if(selected.length){const {error:mapError}=await supabase.from('book_categories').insert(selected.map((category_id)=>({book_id:saved.id,category_id})));if(mapError)throw mapError;}
    closeModal(); toast(id?'تم تحديث الكتاب.':'تمت إضافة الكتاب.'); await loadPublicData(); currentAdminTab='books'; await renderAdmin();
  } catch(error){console.error(error);toast(error.message||'تعذر حفظ الكتاب.','error');}
}

async function addCategory() {
  showModal(`<div class="modal-heading"><h2>إضافة تصنيف</h2><button class="icon-button" data-action="close-modal">×</button></div><form id="category-form" class="stack-form"><label>اسم التصنيف<input name="name" required maxlength="80"></label><label>صورة التصنيف (اختياري)<input name="image" type="file" accept="image/*"></label><button class="button button-primary">إضافة</button></form>`);
}

async function editCategory(category) {
  showModal(`<div class="modal-heading"><h2>تعديل التصنيف</h2><button class="icon-button" data-action="close-modal">×</button></div><form id="category-form" class="stack-form"><input type="hidden" name="id" value="${category.id}"><label>اسم التصنيف<input name="name" required maxlength="80" value="${escapeHtml(category.name)}"></label><label>استبدال صورة التصنيف (اختياري)<input name="image" type="file" accept="image/*"></label><button class="button button-primary">حفظ التعديلات</button></form>`);
}

async function saveCategory(form) {
  const fd=new FormData(form); const name=String(fd.get('name')).trim(); if(!name)return;
  try{const data={name};const file=fd.get('image');if(file instanceof File&&file.size)data.image_path=await uploadCover(file,'categories');const id=String(fd.get('id')||'');const result=id?await supabase.from('categories').update(data).eq('id',id):await supabase.from('categories').insert(data);if(result.error)throw result.error;closeModal();toast(id?'تم تحديث التصنيف.':'تمت إضافة التصنيف.');await loadPublicData();currentAdminTab='categories';await renderAdmin();}catch(error){toast(error.message,'error');}
}

async function updateOrderStatus(orderId, status) {
  const { error } = await supabase.rpc('admin_update_order_status', { p_order_id: orderId, p_status: status });
  if (error) return toast(error.message, 'error');
  toast('تم تحديث حالة الطلب.'); await renderAdmin();
}

async function showOrderDetails(id) {
  const {data:order,error}=await supabase.from('orders').select('*,order_items(*),payments(*)').eq('id',id).single();
  if(error)return toast(error.message,'error');
  const payment=Array.isArray(order.payments)?order.payments[0]:order.payments;
  let proofUrl='';
  if(payment?.proof_path){const {data}=await supabase.storage.from('payment-proofs').createSignedUrl(payment.proof_path,300);proofUrl=data?.signedUrl||'';}
  showModal(`<div class="modal-heading"><div><span class="section-kicker">تفاصيل الطلب</span><h2>${escapeHtml(order.order_code)}</h2></div><button class="icon-button" data-action="close-modal">×</button></div><div class="order-detail-list"><p><b>العميل:</b> ${escapeHtml(order.customer_name||'')}</p><p><b>الهاتف:</b> ${escapeHtml(order.phone||'')}</p><p><b>العنوان:</b> ${escapeHtml(order.shipping_address||'')}</p><p><b>الإجمالي قبل الخصم:</b> ${money(order.subtotal)}</p><p><b>الخصم:</b> ${money(order.discount_total)}</p><p><b>الإجمالي:</b> ${money(order.total)}</p><p><b>طريقة الدفع:</b> ${escapeHtml(order.payment_method)}</p><p><b>حالة الدفع:</b> ${escapeHtml(order.payment_status)}</p><p><b>الكتب:</b></p>${(order.order_items||[]).map((i)=>`<div class="admin-list-row"><span>${escapeHtml(i.title_snapshot)} × ${i.quantity}</span><b>${money(i.unit_price*i.quantity)}</b></div>`).join('')}${payment?.transaction_reference?`<p><b>رقم العملية:</b> ${escapeHtml(payment.transaction_reference)}</p>`:''}${order.payment_method==='instapay'?`<p><b>بيانات إنستاباي:</b> ${escapeHtml(settings.instapay_details||'يرجى التواصل مع المتجر لمعرفة البيانات.')}</p>`:order.payment_method==='vodafone_cash'?`<p><b>فودافون كاش:</b> ${escapeHtml(settings.vodafone_cash_number||'يرجى التواصل مع المتجر لمعرفة البيانات.')}</p>`:''}${proofUrl?`<a class="button button-soft button-full" href="${proofUrl}" target="_blank" rel="noopener noreferrer">عرض إثبات الدفع (صالح 5 دقائق)</a>`:''}${payment && payment.status!=='approved' && order.status!=='cancelled' && currentUser?.id===order.user_id?`<form id="resubmit-proof-form" class="stack-form"><h3>إرسال إثبات الدفع أو تحديثه</h3><label>رقم العملية<input name="transaction_reference" maxlength="120" value="${escapeHtml(payment.transaction_reference||'')}"></label><label>إثبات الدفع (صورة أو PDF)<input name="payment_proof" type="file" accept="image/*,application/pdf"></label><button class="button button-primary">إرسال الإثبات</button></form>`:''}<p class="policy-copy">${escapeHtml(settings.return_policy||'الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.')}</p></div>`);
}

async function openChat(conversationId) {
  activeConversation=conversationId;
  const {data:rows,error}=await supabase.from('messages').select('id,sender_id,body,created_at').eq('conversation_id',conversationId).order('created_at');
  if(error)return toast(error.message,'error');
  const isOwner=profile?.role==='owner';
  showModal(`<div class="modal-heading"><div><span class="section-kicker">محادثة الطلب</span><h2>مراسلة Velvet</h2></div><button class="icon-button" data-action="close-modal">×</button></div><div id="chat-messages" class="chat-messages">${(rows||[]).map((r)=>`<div class="chat-bubble ${r.sender_id===currentUser.id?'mine':''}"><p>${escapeHtml(r.body)}</p><small>${new Date(r.created_at).toLocaleString('ar-EG')}</small></div>`).join('')||'<p class="muted">ابدأ المحادثة برسالة جديدة.</p>'}</div><form id="chat-form" class="chat-form"><input name="body" maxlength="2000" required placeholder="اكتب رسالتك…"><button class="button button-primary">إرسال</button></form>`);
  const chat = $('#chat-messages'); chat.scrollTop=chat.scrollHeight;
  subscribeConversation(conversationId);
}

function subscribeConversation(id) {
  const channel=supabase.channel(`chat-${id}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${id}`},(payload)=>{
    if(payload.new.sender_id===currentUser?.id)return;
    const chat=$('#chat-messages'); if(!chat)return;
    chat.insertAdjacentHTML('beforeend',`<div class="chat-bubble"><p>${escapeHtml(payload.new.body)}</p><small>${new Date(payload.new.created_at).toLocaleString('ar-EG')}</small></div>`);chat.scrollTop=chat.scrollHeight;toast('وصلتك رسالة جديدة.');
  }).subscribe(); realtimeChannels.push(channel);
}

async function sendChatMessage(form) {
  if(!activeConversation)return;
  const body=String(new FormData(form).get('body')||'').trim();if(!body)return;
  const {error}=await supabase.from('messages').insert({conversation_id:activeConversation,sender_id:currentUser.id,body});
  if(error)return toast(error.message,'error');
  const chat=$('#chat-messages');chat.insertAdjacentHTML('beforeend',`<div class="chat-bubble mine"><p>${escapeHtml(body)}</p><small>الآن</small></div>`);chat.scrollTop=chat.scrollHeight;form.reset();
}

function stopRealtime(){realtimeChannels.forEach((channel)=>supabase?.removeChannel(channel));realtimeChannels=[];}

function startOwnerRealtime(){
  if(!supabase||profile?.role!=='owner')return;
  if(realtimeChannels.length)return; // قناة واحدة فقط
  try{
    const channel=supabase.channel(`velvet-admin-orders-${Date.now()}`).on('postgres_changes',{event:'INSERT',schema:'public',table:'orders'},(payload)=>{toast(`طلب جديد وصل: ${payload.new.order_code}`);if(currentAdminTab==='orders'||currentAdminTab==='overview')renderAdmin();}).subscribe();
    realtimeChannels.push(channel);
  }catch(error){console.warn('Realtime:',error);}
}

async function trackVisit(){
  if(!supabase)return;
  let visitor=localStorage.getItem('velvet_visitor_key');if(!visitor){visitor=crypto.randomUUID();localStorage.setItem('velvet_visitor_key',visitor);}
  const {error}=await supabase.rpc('record_visit',{p_visitor_key:visitor});if(error)console.warn('Visit tracking:',error.message);
}

function openPolicy(){
  const text=String(settings.return_policy||'الطلبات التي تقل قيمتها عن 100 جنيه غير قابلة للإرجاع. ويحق للعميل فحص الكتاب والتأكد من سلامته وحالته قبل استلامه النهائي.');
  showModal(`<div class="modal-heading"><h2>سياسة الاستبدال والاسترجاع</h2><button class="icon-button" data-action="close-modal">×</button></div><div class="policy-modal-text">${escapeHtml(text).replace(/\n/g,'<br>')}</div><button class="button button-primary button-full" data-action="close-modal">حسناً</button>`);
}

async function handleAction(actionElement) {
  const action=actionElement.dataset.action;const id=actionElement.dataset.id;
  if(action==='close-modal'){closeModal();}
  else if(action==='toggle-store-sidebar'){const isOpen=$('#store-sidebar')?.classList.contains('is-open');isOpen?closeStoreSidebar():openStoreSidebar();}
  else if(action==='close-store-sidebar')closeStoreSidebar();
  else if(action==='close-panels')closePanels();
  else if(action==='open-cart'){closeStoreSidebar();openPanel('cart-panel');}
  else if(action==='open-wishlist'){closeStoreSidebar();openPanel('wishlist-panel');}
  else if(action==='account'){closeStoreSidebar();accountModal();}
  else if(action==='toggle-theme'){const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('velvet_theme',theme);}
  else if(action==='open-search'){$('#book-search').focus();document.getElementById('all-books').scrollIntoView({behavior:'smooth'});}
  else if(action==='add-cart')addToCart(id);
  else if(action==='toggle-wishlist')await toggleWishlist(id);
  else if(action==='cart-quantity'){const line=cart.find((x)=>x.id===id);if(line){line.quantity=Math.max(1,line.quantity+Number(actionElement.dataset.delta));writeStore('velvet_cart',cart);renderCart();}}
  else if(action==='remove-cart'){cart=cart.filter((x)=>x.id!==id);writeStore('velvet_cart',cart);renderCart();}
  else if(action==='checkout')renderCheckout();
  else if(action==='book-details')showBookDetails(id);
  else if(action==='select-category'){$('#category-filter').value=id;showDiscountOnly=false;renderCatalog();document.getElementById('all-books').scrollIntoView({behavior:'smooth'});}
  else if(action==='show-discounts'){showDiscountOnly=true;$('#category-filter').value='all';renderCatalog();document.getElementById('all-books').scrollIntoView({behavior:'smooth'});}
  else if(action==='show-policy')openPolicy();
  else if(action==='auth-tab')openAuthTab(actionElement.dataset.tab);
  else if(action==='forgot-password'){const email=$('#auth-form [name="email"]').value;if(!email)return toast('اكتب بريدك الإلكتروني أولاً.','error');const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});if(error)toast(error.message,'error');else toast('تم إرسال رابط استعادة كلمة المرور إلى بريدك.');}
  else if(action==='logout')await signOut();
  else if(action==='account-tab')await renderAccountTab(actionElement.dataset.tab);
  else if(action==='open-admin'){closeStoreSidebar();await openAdmin();}
  else if(action==='admin-tab'){currentAdminTab=actionElement.dataset.tab;await renderAdmin();}
  else if(action==='admin-add-book')adminBookForm();
  else if(action==='edit-book'){const {data,error}=await supabase.from('books').select('*').eq('id',id).single();if(error)toast(error.message,'error');else adminBookForm(data);}
  else if(action==='delete-book'){if(confirm('هل تريد حذف هذا الكتاب؟')){const {error}=await supabase.from('books').delete().eq('id',id);if(error)toast(error.message,'error');else{toast('تم حذف الكتاب.');await loadPublicData();await renderAdmin();}}}
  else if(action==='admin-add-category')addCategory();
  else if(action==='edit-category'){const category=categories.find((item)=>item.id===id);if(category)editCategory(category);}
  else if(action==='delete-category'){if(confirm('حذف التصنيف؟ ستُحذف علاقته بالكتب فقط.')){const {error}=await supabase.from('categories').delete().eq('id',id);if(error)toast(error.message,'error');else{await loadPublicData();await renderAdmin();toast('تم حذف التصنيف.');}}}
  else if(action==='view-order')showOrderDetails(id);
  else if(action==='review-payment'){const approve=actionElement.dataset.approved==='true';const {error}=await supabase.rpc('admin_review_payment',{p_order_id:id,p_approved:approve});if(error)toast(error.message,'error');else{toast(approve?'تم اعتماد الدفع.':'تم رفض الدفع.');await renderAdmin();}}
  else if(action==='toggle-review'){const isPublished=actionElement.dataset.published==='true';const {error}=await supabase.from('reviews').update({is_published:!isPublished}).eq('id',id);if(error)toast(error.message,'error');else{toast('تم تحديث حالة المراجعة.');await loadPublicData();await renderAdmin();}}
  else if(action==='open-chat'||action==='admin-chat')openChat(id);
  else if(action==='order-chat'){const {data,error}=await supabase.from('conversations').select('id').eq('order_id',id).single();if(error)toast(error.message,'error');else openChat(data.id);}
  else if(action==='customer-order-details')showOrderDetails(id);
  else if(action==='mobile-menu')$('#main-nav').classList.toggle('is-open');
}

$('#store-sidebar')?.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeStoreSidebar();
});

document.addEventListener('click', async (event) => {
  const actionElement=event.target.closest('[data-action]');
  if(actionElement){if(actionElement.classList.contains('modal-backdrop') && event.target.closest('.modal-card')) return;event.preventDefault();try{await handleAction(actionElement);}catch(error){console.error(error);toast(error.message||'حدث خطأ غير متوقع.','error');}}
});

document.addEventListener('submit', async (event) => {
  const form=event.target;
  if(form.id==='auth-form'){
    event.preventDefault();if(!supabase)return toast('أكمل إعداد Supabase أولاً.','error');
    const fd=new FormData(form);const mode=fd.get('mode');
    try{
      if(mode==='register'){
        const {data,error}=await supabase.auth.signUp({email:String(fd.get('email')),password:String(fd.get('password')),options:{data:{full_name:String(fd.get('full_name')||''),phone:String(fd.get('phone')||'')}}});if(error)throw error;
        if(data.session){currentUser=data.user;await loadProfile();closeModal();toast('تم إنشاء الحساب وتسجيل الدخول.');await loadWishlistFromAccount();if(resumeCartAfterAuth){resumeCartAfterAuth=false;openPanel('cart-panel');}}
        else toast('تم إنشاء الحساب. راجع بريدك لتأكيد التسجيل، ثم سجّل الدخول.');
      }else{
        const {data,error}=await supabase.auth.signInWithPassword({email:String(fd.get('email')),password:String(fd.get('password'))});if(error)throw error;currentUser=data.user;await loadProfile();closeModal();toast('تم تسجيل الدخول بنجاح.');await loadWishlistFromAccount();startOwnerRealtime();if(resumeCartAfterAuth){resumeCartAfterAuth=false;openPanel('cart-panel');}
      }
    }catch(error){toast(error.message,'error');}
  }else if(form.id==='profile-form'){
    event.preventDefault();const fd=new FormData(form);const {data,error}=await supabase.from('profiles').update({full_name:String(fd.get('full_name')),phone:String(fd.get('phone')),address:String(fd.get('address'))}).eq('id',currentUser.id).select().single();if(error)toast(error.message,'error');else{profile={...profile,...data};refreshHeader();toast('تم حفظ بياناتك.');}
  }else if(form.id==='checkout-form'){event.preventDefault();await processCheckout(form);}
  else if(form.id==='review-form'){event.preventDefault();await submitReview(form);}
  else if(form.id==='admin-book-form'){event.preventDefault();await saveAdminBook(form);}
  else if(form.id==='category-form'){event.preventDefault();await saveCategory(form);}
  else if(form.id==='settings-form'){
    event.preventDefault();const fd=new FormData(form);try{for(const [key,value] of fd.entries()){const {error}=await supabase.from('store_settings').upsert({key,value:String(value),is_public:true},{onConflict:'key'});if(error)throw error;}toast('تم حفظ إعدادات المتجر.');await loadPublicData();}catch(error){toast(error.message,'error');}
  }else if(form.id==='resubmit-proof-form'){
    event.preventDefault();const fd=new FormData(form);const proof=fd.get('payment_proof');const reference=String(fd.get('transaction_reference')||'').trim();const orderId=$('#modal-root [data-order-id]')?.dataset.orderId;
    const heading=$('#modal-root .modal-heading h2')?.textContent;
    const {data:ordersData,error:lookupError}=await supabase.from('orders').select('id').eq('order_code',heading).single();
    if(lookupError)return toast(lookupError.message,'error');
    if(!(proof instanceof File&&proof.size>0)&&!reference)return toast('أدخل رقم العملية أو اختر صورة إثبات الدفع.','error');
    if(proof instanceof File&&proof.size>5*1024*1024)return toast('حجم الإثبات يجب ألا يتجاوز 5 ميجابايت.','error');
    try{let path=null;if(proof instanceof File&&proof.size>0){const name=proof.name.replace(/[^\w.-]/g,'_').slice(-80);path=`${currentUser.id}/${ordersData.id}/${crypto.randomUUID()}-${name}`;const {error:uploadError}=await supabase.storage.from('payment-proofs').upload(path,proof,{contentType:proof.type,upsert:false});if(uploadError)throw uploadError;}const {error}=await supabase.rpc('submit_payment_proof',{p_order_id:ordersData.id,p_proof_path:path,p_transaction_reference:reference||null});if(error)throw error;toast('تم إرسال الإثبات للمراجعة.');await showOrderDetails(ordersData.id);}catch(error){toast(error.message,'error');}
  }else if(form.id==='chat-form'){event.preventDefault();await sendChatMessage(form);}
});

document.addEventListener('change', async (event) => {
  const target=event.target;
  if(target.matches('#book-search,#category-filter,#sort-books'))renderCatalog();
  if(target.matches('[data-order-status]'))await updateOrderStatus(target.dataset.orderStatus,target.value);
  if(target.matches('#order-search')){
    const query=target.value.trim().toLowerCase();$$('[data-order-search]').forEach((card)=>card.classList.toggle('hidden',!card.dataset.orderSearch.includes(query)));
  }
  if(target.matches('#admin-cover-file')){
    const file=target.files?.[0];
    if(file){
      if(!file.type.startsWith('image/') || file.size>5*1024*1024){target.value='';return toast('اختر صورة صالحة لا تتجاوز 5 ميجابايت.','error');}
      const preview=$('#admin-cover-preview');const placeholder=$('#admin-cover-placeholder');
      preview.src=URL.createObjectURL(file);preview.classList.remove('hidden');placeholder?.classList.add('hidden');
    }
  }
});

async function init() {
  $('#footer-year').textContent=new Date().getFullYear();
  const savedTheme=localStorage.getItem('velvet_theme')||'light';document.documentElement.dataset.theme=savedTheme;
  const intro=$('#intro');const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion)intro.remove();else window.setTimeout(()=>intro.classList.add('intro-hidden'),1500);
  window.setTimeout(()=>intro?.remove(),2300);
  await loadPublicData();
  if(!hasConfig)return;
  await trackVisit();
  const {data:{session}}=await supabase.auth.getSession();
  if(session){currentUser=session.user;try{await loadProfile();await loadWishlistFromAccount();startOwnerRealtime();}catch(error){console.error(error);}}
  let lastUserId=currentUser?.id||null;
  supabase.auth.onAuthStateChange((event,sessionNow)=>{
    const nextUser=sessionNow?.user||null;
    currentUser=nextUser;
    const nextId=nextUser?.id||null;
    // أحداث التحديث الدوري/عودة التبويب لا تعني تغيير المستخدم: تجاهلها
    if(nextId===lastUserId&&event!=='USER_UPDATED')return;
    lastUserId=nextId;
    // مهم: لا نستدعي Supabase داخل الـ callback مباشرة حتى لا يتعلق الاتصال
    window.setTimeout(async()=>{
      try{
        await loadProfile();
        if(currentUser){await loadWishlistFromAccount();startOwnerRealtime();}else{stopRealtime();}
      }catch(error){console.error(error);}
      refreshHeader();
    },0);
  });
}

init();