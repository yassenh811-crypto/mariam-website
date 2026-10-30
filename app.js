// 1. بيانات Supabase (ضع رابطك ومفتاحك هنا)
const SUPABASE_URL = 'https://dfyctdfxwwokszvvgdix.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_atxSXfoMGnv7Kt1RDmyJmg_lHfi1O81';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);

let books = [], cart = JSON.parse(localStorage.getItem('cart') || '{}'), currentUser = null;

// 2. التحكم في شاشة الترحيب
setTimeout(() => { if($('#welcome')) $('#welcome').classList.add('in'); }, 500);
setTimeout(() => { if($('#loader')) $('#loader').classList.add('gone'); }, 2500);

// 3. الوضع الليلي
$('#themeBtn').onclick = () => {
    document.body.classList.toggle('dark-mode');
    $('#themeBtn').textContent = document.body.classList.contains('dark-mode') ? '☀️' : '🌙';
};

// 4. جلب الكتب وعرضها (مع صور حقيقية)
async function loadBooks() {
    const grid = $('#grid');
    try {
        const { data, error } = await sb.from('books').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        
        books = data || [];
        
        if (books.length === 0) {
            grid.innerHTML = '<p style="text-align:center; width:100%;">لا توجد كتب حالياً. سجل الدخول كمالك لإضافة كتب.</p>';
            return;
        }

        grid.innerHTML = books.map((b, index) => {
            // صورة عشوائية لكل كتاب (إذا لم يكن له غلاف مرفوع)
            const imgId = 100 + (index % 50); 
            const coverUrl = b.cover_url ? b.cover_url : `https://picsum.photos/id/${imgId}/300/400`;
            
            return `
            <div class="card">
                <div class="cover" onclick="openBook('${b.id}')" style="background-image: url('${coverUrl}');">
                    <!-- إذا لم توجد صورة، سيعرض النص، لكن الصورة ستعمل -->
                </div>
                <h4 onclick="openBook('${b.id}')">${b.title}</h4>
                <b>${b.discount_price ? b.discount_price : b.price} ج</b>
                <button onclick="addToCart('${b.id}')" class="btn-pri">أضف للسلة</button>
            </div>`;
        }).join('');
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<p style="text-align:center; color:red;">حدث خطأ في جلب البيانات.</p>';
    }
}

// 5. السلة
window.addToCart = (id) => {
    cart[id] = (cart[id] || 0) + 1;
    localStorage.setItem('cart', JSON.stringify(cart));
    $('#cartN').innerText = Object.values(cart).reduce((a, b) => a + b, 0);
    alert('تمت الإضافة للسلة بنجاح!');
};
$('#cartN').innerText = Object.values(cart).reduce((a, b) => a + b, 0);

// 6. عرض تفاصيل الكتاب والتقييمات
window.openBook = async (id) => {
    const book = books.find(x => x.id === id);
    const { data: reviews } = await sb.from('reviews').select('*').eq('book_id', id).order('created_at', { ascending: false });
    
    const reviewsHtml = (reviews || []).map(r => `
        <div class="review-item">
            <strong>${r.user_name}</strong> <span class="stars">${'★'.repeat(r.rating)}</span>
            <p>${r.comment}</p>
        </div>
    `).join('') || '<p>لا توجد تقييمات بعد. كن أول من يقيم!</p>';

    const addReviewHtml = currentUser ? `
        <div class="add-review">
            <h4>أضف تقييمك</h4>
            <select id="revRating">
                <option value="5">★★★★★ (ممتاز)</option>
                <option value="4">★★★★☆ (جيد جداً)</option>
                <option value="3">★★★☆☆ (جيد)</option>
                <option value="2">★★☆☆☆ (مقبول)</option>
                <option value="1">★☆☆☆☆ (سيء)</option>
            </select>
            <textarea id="revComment" placeholder="اكتب تعليقك هنا..."></textarea>
            <button onclick="submitReview('${id}')" class="btn-pri">إرسال التقييم</button>
        </div>
    ` : `<p class="note">يرجى <a href="#" onclick="openAuth('login'); document.getElementById('bookModal').close();">تسجيل الدخول</a> لإضافة تقييم.</p>`;

    $('#bookDetails').innerHTML = `
        <h2>${book.title}</h2>
        <p style="margin: 10px 0; color: var(--muted);">${book.description || 'لا يوجد وصف.'}</p>
        <h3 style="margin:1rem 0; color:var(--pri-dark);">السعر: ${book.discount_price || book.price} ج</h3>
        <hr style="border-color: var(--soft); margin: 20px 0;">
        <h3>التقييمات</h3>
        <div style="margin-top: 15px;">${reviewsHtml}</div>
        ${addReviewHtml}
    `;
    $('#bookModal').showModal();
};

// 7. إرسال التقييم
window.submitReview = async (bookId) => {
    const rating = +$('#revRating').value;
    const comment = $('#revComment').value;
    const userName = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];

    const { error } = await sb.from('reviews').insert([{
        book_id: bookId, user_id: currentUser.id, user_name: userName, rating, comment
    }]);

    if (error) alert('حدث خطأ: ' + error.message);
    else {
        alert('تم إضافة تقييمك بنجاح!');
        openBook(bookId); 
    }
};

// 8. نظام تسجيل الدخول وإنشاء الحساب
window.openAuth = (mode) => {
    if (mode === 'login') {
        $('#authContent').innerHTML = `
            <h2>تسجيل الدخول</h2>
            <input type="email" id="email" placeholder="البريد الإلكتروني">
            <input type="password" id="password" placeholder="كلمة المرور">
            <p id="authError" style="color:red; font-size:0.9rem;"></p>
            <button onclick="login()" class="btn-pri" style="width:100%;">دخول</button>
            <p class="note" style="text-align:center; margin-top:15px;">ليس لديك حساب؟ <a href="#" onclick="openAuth('signup')">إنشاء حساب جديد</a></p>
        `;
    } else {
        $('#authContent').innerHTML = `
            <h2>إنشاء حساب جديد</h2>
            <input type="text" id="fullName" placeholder="الاسم بالكامل">
            <input type="email" id="email" placeholder="البريد الإلكتروني">
            <input type="password" id="password" placeholder="كلمة المرور (6 أحرف على الأقل)">
            <p id="authError" style="color:red; font-size:0.9rem;"></p>
            <button onclick="signup()" class="btn-pri" style="width:100%;">إنشاء الحساب</button>
            <p class="note" style="text-align:center; margin-top:15px;">لديك حساب بالفعل؟ <a href="#" onclick="openAuth('login')">تسجيل الدخول</a></p>
        `;
    }
    $('#authModal').showModal();
};

$('#authBtn').onclick = () => {
    if (currentUser) {
        sb.auth.signOut();
        location.reload();
    } else {
        openAuth('login');
    }
};

window.login = async () => {
    const { data, error } = await sb.auth.signInWithPassword({
        email: $('#email').value, password: $('#password').value
    });
    if (error) $('#authError').innerText = error.message;
    else location.reload();
};

window.signup = async () => {
    const { data, error } = await sb.auth.signUp({
        email: $('#email').value, 
        password: $('#password').value,
        options: { data: { full_name: $('#fullName').value } }
    });
    if (error) return $('#authError').innerText = error.message;
    
    // إضافة الصلاحيات (لأول حساب)
    if (data.user) await sb.from('user_roles').insert([{ user_id: data.user.id, role: 'admin' }]);
    
    alert('تم إنشاء الحساب! يرجى تفعيل بريدك الإلكتروني إذا لزم الأمر، ثم تسجيل الدخول.');
    openAuth('login');
};

// 9. التحقق من حالة المستخدم (لإظهار زر لوحة المالك)
async function checkUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        currentUser = session.user;
        $('#authBtn').innerText = 'خروج';
        
        // التحقق من أن المستخدم مالك
        const { data: role } = await sb.from('user_roles').select('*').eq('user_id', currentUser.id).single();
        if (role) {
            $('#adminLink').style.display = 'flex';
        }
    }
    loadBooks();
}

// تشغيل
checkUser();