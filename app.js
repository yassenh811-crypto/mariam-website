const sb = supabase.createClient(window.ENV.VITE_SUPABASE_URL, window.ENV.VITE_SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
let books = [], cart = JSON.parse(localStorage.getItem('cart') || '{}'), currentUser = null;

$('#themeBtn').onclick = () => {
    document.body.classList.toggle('dark-mode');
    $('#themeBtn').textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
};

async function loadBooks() {
    const { data } = await sb.from('books').select('*').order('created_at', { ascending: false });
    books = data || [];
    $('#grid').innerHTML = books.length ? books.map(b => `
        <div class="card">
            <div class="cover" onclick="openBook('${b.id}')" style="cursor:pointer;">${b.title}</div>
            <h4 onclick="openBook('${b.id}')" style="cursor:pointer;">${b.title}</h4>
            <b>${b.discount_price || b.price} ج</b>
            <button onclick="addToCart('${b.id}')" class="btn-pri">أضف للسلة</button>
        </div>
    `).join('') : '<p>لا توجد كتب.</p>';
}

window.addToCart = (id) => {
    cart[id] = (cart[id] || 0) + 1;
    localStorage.setItem('cart', JSON.stringify(cart));
    $('#cartN').innerText = Object.values(cart).reduce((a, b) => a + b, 0);
};

$('#cartN').innerText = Object.values(cart).reduce((a, b) => a + b, 0);

window.openBook = async (id) => {
    const book = books.find(x => x.id === id);
    const { data: reviews } = await sb.from('reviews').select('*').eq('book_id', id).order('created_at', { ascending: false });
    
    const reviewsHtml = (reviews || []).map(r => `<div class="review-item"><strong>${r.user_name}</strong> ${'★'.repeat(r.rating)}<p>${r.comment}</p></div>`).join('') || '<p>لا توجد تقييمات.</p>';
    const addReviewHtml = currentUser ? `
        <div class="add-review">
            <select id="revRating"><option value="5">★★★★★</option><option value="4">★★★★☆</option><option value="3">★★★☆☆</option><option value="2">★★☆☆☆</option><option value="1">★☆☆☆☆</option></select>
            <textarea id="revComment" placeholder="اكتب تعليقك..."></textarea>
            <button onclick="submitReview('${id}')" class="btn-pri">إرسال</button>
        </div>` : `<p class="note">سجل <a href="#" onclick="openAuth('login'); document.getElementById('bookModal').close();">الدخول</a> للتقييم.</p>`;

    $('#bookDetails').innerHTML = `<h2>${book.title}</h2><p>${book.description || ''}</p><h3>${book.price} ج</h3><hr><h3>التقييمات</h3>${reviewsHtml}${addReviewHtml}`;
    $('#bookModal').showModal();
};

window.submitReview = async (bookId) => {
    const rating = +$('#revRating').value, comment = $('#revComment').value, userName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    await sb.from('reviews').insert([{ book_id: bookId, user_id: currentUser.id, user_name: userName, rating, comment }]);
    openBook(bookId);
};

window.openAuth = (mode) => {
    $('#authContent').innerHTML = mode === 'login' ? `
        <h2>تسجيل الدخول</h2>
        <input type="email" id="email" placeholder="البريد الإلكتروني">
        <input type="password" id="password" placeholder="كلمة المرور">
        <p id="authError" style="color:red;"></p>
        <button onclick="login()" class="btn-pri">دخول</button>
        <p style="text-align:center; margin-top:10px;">جديد؟ <a href="#" onclick="openAuth('signup')">إنشاء حساب</a></p>
    ` : `
        <h2>إنشاء حساب (المالك)</h2>
        <input type="text" id="fullName" placeholder="الاسم">
        <input type="email" id="email" placeholder="البريد الإلكتروني">
        <input type="password" id="password" placeholder="كلمة المرور">
        <p id="authError" style="color:red;"></p>
        <button onclick="signup()" class="btn-pri">إنشاء الحساب</button>
        <p style="text-align:center; margin-top:10px;">لديك حساب؟ <a href="#" onclick="openAuth('login')">دخول</a></p>
    `;
    $('#authModal').showModal();
};

$('#authBtn').onclick = () => currentUser ? sb.auth.signOut().then(() => location.reload()) : openAuth('login');

window.login = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value });
    if (error) $('#authError').innerText = error.message; else location.reload();
};

window.signup = async () => {
    const { data, error } = await sb.auth.signUp({
        email: $('#email').value, password: $('#password').value, options: { data: { full_name: $('#fullName').value } }
    });
    if (error) return $('#authError').innerText = error.message;
    // ترقية الحساب لمالك
    if (data.user) await sb.from('user_roles').insert([{ user_id: data.user.id, role: 'admin' }]);
    alert('تم إنشاء حساب المالك! سجل الدخول الآن.');
    openAuth('login');
};

async function checkUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        $('#authBtn').innerText = 'خروج';
        const { data: role } = await sb.from('user_roles').select('*').eq('user_id', currentUser.id).single();
        if (role) $('#adminLink').style.display = 'flex';
    }
    loadBooks();
}
checkUser();