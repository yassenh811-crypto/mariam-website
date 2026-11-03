// Velvet FX — تأثيرات الحركة (ظهور عند التمرير، ميل الكروت، شريط التقدم)
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const header = document.querySelector('.site-header');
const bar = document.getElementById('scroll-progress');

function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  if (bar) bar.style.width = (max > 0 ? (scrollY / max) * 100 : 0) + '%';
  header?.classList.toggle('is-scrolled', scrollY > 12);
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

if (!reduce) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  const SELECTOR = '.section-heading, .book-card, .category-card, .review-card, .discount-banner, .about-section, .marquee';
  const watch = (root = document) => {
    root.querySelectorAll?.(SELECTOR).forEach((el, i) => {
      if (el.dataset.fx) return;
      el.dataset.fx = '1';
      el.classList.add('reveal');
      el.style.transitionDelay = Math.min((i % 8) * 60, 360) + 'ms';
      io.observe(el);
    });
  };
  watch();
  // الكروت تتولد ديناميكياً بعد تحميل Supabase
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType === 1) { if (n.matches?.(SELECTOR)) watch(n.parentElement); watch(n); }
  }))).observe(document.getElementById('storefront') || document.body, { childList: true, subtree: true });

  // ميل ثلاثي الأبعاد للكروت (للماوس فقط)
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    document.addEventListener('pointermove', (e) => {
      const card = e.target.closest?.('.book-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `translateY(-8px) perspective(800px) rotateY(${x * 9}deg) rotateX(${-y * 9}deg)`;
    });
    document.addEventListener('pointerout', (e) => {
      const card = e.target.closest?.('.book-card');
      if (card && !card.contains(e.relatedTarget)) card.style.transform = '';
    });
    // باراليكس خفيف لكتب الواجهة
    const art = document.querySelector('.hero-art');
    art?.addEventListener('pointermove', (e) => {
      const r = art.getBoundingClientRect();
      art.style.setProperty('--rx', ((e.clientY - r.top) / r.height - 0.5) * -10 + 'deg');
      art.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 14 + 'deg');
      art.querySelector('.book-stack').style.rotate = `y ${art.style.getPropertyValue('--ry')}`;
    });
    art?.addEventListener('pointerleave', () => { const s = art.querySelector('.book-stack'); if (s) s.style.rotate = ''; });
  }
}
