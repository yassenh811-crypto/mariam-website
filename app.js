import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/+esm';
const env = window.ENV ?? {};
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n).toLocaleString('ar-EG') + ' ج';

let books = [], cart = JSON.parse(localStorage.getItem('cart') || '{}'), user = null, isAdmin = false, orderCode = '';

// 1. شاشة الترحيب
setTimeout(() => { $('#welcome').classList.add('in'); }, 500);
setTimeout(() => { $('#loader').classList.add('gone'); }, 2500);

// 2. الوضع الليلي
$('#themeBtn').onclick = () => { document.body.classList.toggle('dark-mode'); $('#themeBtn').textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙'; };

// 3. جلب الكتب
async function fetchBooks() {
    const { data } = await sb.from('books').select('*').order('created_at', { ascending: false });
    books = data || [];
    render();
}

function render() {
    const grid = $('#grid');
    grid.innerHTML = books.map(b => `
        <div class="card">
            <div class="cover">${esc(b.title)}</div>
            <h4>${esc(b.title)}</h4>
            <div>${b.discount_price ? `<s>${money(b.price)}</s> <b>${money(b.discount_price)}</b>` : `<b>${money(b.price)}</b>`}</div>
            ${b.quantity === 0 ? '<span class="bd out">نفذت الكمية</span>' : b.quantity <= 3 ? '<span class="bd low">قاربت على النفاذ</span>' : ''}
            <button onclick="addToCart('${b.id}')" ${b.quantity === 0 ? 'disabled' : ''} style="margin-top:1rem; justify-content:center;">أضف للسلة</button>
        </div>
    `).join('');
    $('#cartN').innerText = Object.values(cart).reduce((a, b) => a + b, 0);
}

// 4. السلة
window.addToCart = (id) => { cart[id] = (cart[id] || 0) + 1; localStorage.setItem('cart', JSON.stringify(cart)); render(); };

$('#cartBtn').onclick = () => {
    const items = Object.entries(cart).map(([id, qty]) => {
        const b = books.find(x => x.id === id);
        return b ? `<div style="display:flex; justify-content:space-between; margin-bottom:10px;"><span>${b.title} (x${qty})</span><b>${money((b.discount_price || b.price) * qty)}</b></div>` : '';
    }).join('');
    const total = Object.entries(cart).reduce((sum, [id, qty]) => { const b = books.find(x => x.id === id); return sum + (b ? (b.discount_price || b.price) * qty : 0); }, 0);
    
    $('#dlgBody').innerHTML = `
        <h3>سلة الشراء 🛒</h3>
        <div style="margin: 1.5rem 0;">${items || '<p>السلة فارغة</p>'}</div>
        <h4>الإجمالي: ${money(total)}</h4>
        ${total > 0 ? `<button onclick="checkout()" style="width:100%; justify-content:center; background:var(--pri); color:white; margin-top:1rem;">إتمام الطلب</button>` : ''}
    `;
    $('#dlg').showModal();
};

// 5. إتمام الطلب وتوليد الكود
window.checkout = async () => {
    if (!user) {
        alert('يجب تسجيل الدخول أولاً لإتمام الطلب.');
        return;
    }
    
    const total = Object.entries(cart).reduce((sum, [id, qty]) => { const b = books.find(x => x.id === id); return sum + (b ? (b.discount_price || b.price) * qty : 0); }, 0);
    
    if (total < 100) {
        alert('عذراً، الحد الأدنى للطلب هو 100 جنيه.');
        return;
    }

    // توليد كود الأوردر
    orderCode = 'VEL-' + Math.floor(1000 + Math.random() * 9000);
    
    // حفظ الأوردر في Supabase
    const items = Object.entries(cart).map(([id, qty]) => ({ book_id: id, qty }));
    const { data, error } = await sb.from('orders').insert({
        user_id: user.id,
        total: total,
        order_code: orderCode,
        status: 'pending'
    }).select().single();

    if (error) return alert('حدث خطأ: ' + error.message);

    // حفظ عناصر الأوردر
    await sb.from('order_items').insert(items.map(i => ({ order_id: data.id, book_id: i.book_id, qty: i.qty, unit_price: books.find(b => b.id === i.book_id).discount_price || books.find(b => b.id === i.book_id).price })));

    // إرسال إشعار للمالك (Real-time)
    sb.channel('orders').send({ type: 'broadcast', event: 'new_order', payload: { code: orderCode, total } });

    // رسالة الواتساب
    const waMsg = `طلب جديد: ${orderCode}\nالإجمالي: ${total} ج\nالعميل: ${user.email}`;
    window.open(`https://wa.me/${env.VITE_WHATSAPP_NUMBER}?text=${encodeURIComponent(waMsg)}`, '_blank');

    // تفريغ السلة
    cart = {};
    localStorage.removeItem('cart');
    render();
    $('#dlg').close();
    alert(`تم تأكيد طلبك! كود الأوردر: ${orderCode}`);
};

// 6. تسجيل الدخول والتحقق من المالك
$('#authBtn').onclick = async () => {
    const email = prompt('البريد الإلكتروني:');
    const password = prompt('كلمة المرور:');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return alert(error.message);
    user = data.user;
    $('#authBtn').innerText = 'خروج';
    
    // التحقق إذا كان مالكاً
    const { data: adminData } = await sb.rpc('is_admin');
    isAdmin = !!adminData;
    if (isAdmin) {
        $('#dash').hidden = false;
        loadDashboard();
    }
};

// 7. لوحة التحكم
async function loadDashboard() {
    $('#dc').innerHTML = '<p>جاري تحميل البيانات...</p>';
    const { data: orders } = await sb.from('orders').select('*').order('created_at', { ascending: false });
    
    $('#dc').innerHTML = `
        <h2>الأوردرات الأخيرة</h2>
        <table style="width:100%; text-align:right; border-collapse:collapse;">
            <tr><th>الكود</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr>
            ${orders.map(o => `<tr style="border-bottom:1px solid #eee;"><td>${o.order_code}</td><td>${money(o.total)}</td><td>${o.status}</td><td>${new Date(o.created_at).toLocaleDateString('ar-EG')}</td></tr>`).join('')}
        </table>
    `;
}

// الاستماع للأوردرات الجديدة
sb.channel('orders').on('broadcast', { event: 'new_order' }, payload => {
    if (isAdmin) {
        $('#notifBadge').hidden = false;
        alert(`🔔 أوردر جديد: ${payload.payload.code} بقيمة ${payload.payload.total} ج`);
    }
}).subscribe();

// التشغيل الأولي
fetchBooks();