// Scroll-reveal (feat/animations-delight, A7): [data-reveal] element
// gulo scroll-e ekbar fade/slide-in hoy (IntersectionObserver).
// FRUGAL: shudhu homepage-er koyekta section heading + Why Shop
// card-e data-reveal ache — grid/product card-e nei.
//   - JS-i .reveal class lagay (shuru theke lukano NOY): JS na
//     cholle ba load na hole content ager motoi dekha jay.
//   - Opacity/transform SHUDHU — layout shift hoy na, jayga age
//     thekei reserve thake.
//   - prefers-reduced-motion hole kichui lukano hoy na.
//   - IntersectionObserver na thakle sob sathe sathe dekha jay.
(function () {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  var els = document.querySelectorAll('[data-reveal]');
  if (!els || !els.length) return;
  var reduced = false;
  try {
    reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { reduced = false; }
  if (reduced) return;
  function show(el) {
    if (el.classList) el.classList.add('is-visible');
  }
  var i;
  for (i = 0; i < els.length; i++) {
    if (els[i].classList) els[i].classList.add('reveal');
  }
  if (typeof IntersectionObserver === 'function') {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          show(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    for (i = 0; i < els.length; i++) io.observe(els[i]);
  } else {
    for (i = 0; i < els.length; i++) show(els[i]);
  }
})();
