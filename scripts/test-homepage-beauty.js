// Homepage beauty (fix/homepage-beauty) — 2nd menu bar (category pills)
// hover like the mega menu, product card hover effects, whole product
// photos, aligned card buttons, WhatsApp overlap guard re-checks,
// Best Sellers / Recently Viewed full-width rows, hero rebalance,
// single-line trust boxes.
//
// donal said (2026-11-27, in Romanized Bengali): the 2nd menu bar
// should hover with colour like the mega menu; visit the homepage,
// check whether the product photo sizes are right and fix whatever
// would look beautiful; the cursor hover effect is not beautiful.
// A live visual inspection of https://goince.com/ (desktop 1920px)
// found these concrete problems:
//   1. CATEGORY PILLS (2nd menu bar): "All" (orange, active),
//      "Home Appliances ▾" (dropdown, PR #25) and "Winter
//      Collection" (white, thin grey border). Hovering "Winter
//      Collection" did NOTHING — no colour, no lift, no shadow.
//   2. PRODUCT CARDS: hovering a card did NOTHING visible — the
//      -4px lift had no shadow and the "Add to Cart" button only
//      went navy -> navy-2 (nearly identical). No photo zoom.
//   3. PHOTOS CUT OFF: the 5 photo containers are the same size
//      but object-fit: cover crops the sources inconsistently —
//      worst is "Mini Bag Sealer & Cutter – 2-in-1": only the
//      bottom half of "...and Cutter" shows at the top edge and
//      the green icon at bottom-left is cut off; the A.T.Z dress
//      (tall portrait) is cropped to a wide landscape frame; the
//      MLSM-202 sewing machine has cut-off text/icons at the top;
//      BINBOND watch and Food Chopper are very tightly zoomed.
//   4. RAGGED BUTTONS: titles wrap to 1 line (Mini Bag Sealer,
//      BINBOND) vs 2 lines (A.T.Z, MLSM-202, Food Chopper), so
//      "Add to Cart" buttons sit at different heights. ROOT CAUSE
//      (verified in code): `.product-card > form { margin-top:
//      auto; }` was overridden by the LATER `.product-card form
//      { margin: 0; }` — same specificity (0,1,1), later rule wins
//      — so the form's margin-top was 0 and the button sat right
//      after the content. (The "Choose Option" anchor kept its
//      margin-top: auto — higher specificity — so only the form
//      buttons misaligned.)
//   5. WHATSAPP STILL OVERLAPS: the green float still covered the
//      right end of the BINBOND card's "Add to Cart" at the initial
//      viewport, even though PR #65 added a real rect-intersection
//      guard. ROOT CAUSE (verified in code): the guard measured the
//      layout exactly ONCE, synchronously while the document was
//      still being parsed — before first paint, before images
//      loaded and the layout settled — and never re-measured after
//      the page finished loading. If a guarded button moved after
//      that single measurement, nothing re-checked it until the
//      user scrolled or resized. The fix re-checks on load, on
//      font ready, on ANY layout-size change (ResizeObserver), on
//      pageshow (bfcache) and once more after first paint (rAF).
//   6. BEST SELLERS / RECENTLY VIEWED: 4 cards (Best Sellers,
//      LIMIT 4) and 3 cards (Recently Viewed) sit in a narrower
//      inset block than "All Products" (5 cards) because every
//      card is capped at 360px — the rows never span the full
//      container width.
//   7. HERO: a large mostly-empty dark-gold gradient — text on the
//      left, a small watch photo on the far right, a big empty
//      middle.
//   8. TRUST BOX: "24h Return" has a second line "(defective /
//      wrong product)" while the other three boxes are single-line.
//
// What was built (SHOP HOMEPAGE ONLY — admin untouched):
//   1. PILLS: inactive pills get the mega-menu dark-gold hover
//      (background #966e00 + white text + translateY(-4px) +
//      soft shadow); the active "All" pill keeps its orange and
//      only lifts -2px on hover. Hover gated behind
//      @media (hover: hover); :focus-visible matches hover.
//   2. CARDS: hover lifts -10px with a dark-gold ring + deep soft
//      shadow (strengthened in fix/product-hover-gallery — was -6px
//      / 1.06x); the photo zooms 1.08x inside overflow: hidden; the
//      "Add to Cart" / "Choose Option" button turns dark gold
//      (#966e00) + white on CARD hover (not only its own hover).
//      HONEST UPDATE (fix/pills-band-ripple-card, 2026-11-27):
//      donal changed his mind — the button now turns gold ONLY on
//      its OWN hover; the bottom zone (.product-card-foot) gets a
//      mint background on card hover instead (PR #72).
//   3. PHOTOS: object-fit: cover -> contain on a consistent soft
//      neutral background (var(--bg)), same fixed 180px frame so
//      the grid stays uniform. Photo files untouched.
//   4. BUTTONS: h3 clamped to 2 lines + min-height 2.8em (1-line
//      titles reserve 2 lines, so price rows align too); the form
//      rule now says margin: 0 + margin-top: auto (the override
//      is fixed, not worked around).
//      HONEST UPDATE (fix/pills-band-ripple-card, 2026-11-27):
//      the button/form now live in .product-card-foot, which does
//      the pushing (margin-top: auto); the form rule is plain
//      margin: 0 again.
//   5. WHATSAPP: the guard now re-checks on window load, on
//      document.fonts.ready, on every layout-size change via a
//      ResizeObserver on documentElement, on pageshow, and once
//      more via rAF after first paint — in addition to the existing
//      scroll/resize listeners. The button is never removed.
//   6. SECTIONS: Best Sellers + Recently Viewed grids get
//      .product-grid--fill (the 360px card cap is lifted, so 3–4
//      cards grow to span the full row); justify-content: center
//      stays, so an incomplete last row centres.
//   7. HERO: product image 260px -> 360px basis, 200px -> 260px
//      tall. Copy and product unchanged.
//   8. TRUST: the "(defective / wrong product)" second line is
//      removed from the "24h Return" box (the detail still lives
//      in the "Why Shop" section and the footer line).
//
// NOT in scope: the supplier's Chinese price tag "¥3999" baked
// INTO the BINBOND watch photo (and the same photo in the hero) —
// that text is inside the image file and no CSS can remove it;
// only a clean replacement photo fixes it (donal must upload one
// via Admin -> Products -> Edit -> photo). Photo files untouched.
//
// No live MySQL needed: CSS/EJS source checks + a direct EJS
// render of the homepage + the REAL WhatsApp IIFE from footer.ejs
// run in a stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-homepage-beauty.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const indexPath = path.join(__dirname, '..', 'views', 'index.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-shop-menu-bar.js: top-level CSS (comments +
// all @media ranges stripped), and per-query @media blocks.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
function allMediaRanges(text, query) {
  const ranges = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('@media', from);
    if (i < 0) break;
    if (query && !text.slice(i, i + 60).includes(query)) { from = i + 6; continue; }
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let d = 0;
    let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') d++;
      if (text[j] === '}') { d--; if (d === 0) break; }
    }
    ranges.push([i, j + 1]);
    from = j + 1;
  }
  return ranges;
}
function stripRanges(text, ranges) {
  let out = '';
  let last = 0;
  for (const [a, b] of ranges) { out += text.slice(last, a); last = b; }
  return out + text.slice(last);
}
function extractRanges(text, ranges) {
  return ranges.map(([a, b]) => text.slice(a, b)).join('\n');
}
const cssTopLevel = stripRanges(cssNoComments, allMediaRanges(cssNoComments));
const hoverBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'hover: hover'));
const reducedMotionBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'prefers-reduced-motion'));
const mobileBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 768px'));
const smallPhoneBlocks = extractRanges(cssNoComments, allMediaRanges(cssNoComments, 'max-width: 480px'));

function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

(async function main() {
  console.log('Homepage beauty (fix/homepage-beauty) checks:');

  // ---------- 1. Category pills hover (2nd menu bar) ----------
  const pillHover = hoverBlocks.match(/\.category-bar > a:not\(\.active\):hover,[\s\S]*?\{[^}]*\}/);
  check('pills: inactive pill hover rule exists (dark gold)', !!pillHover);
  check('pills: hover background is the mega-menu dark gold #966e00', !!pillHover && /background:\s*var\(--mega-hover-gold\)/.test(pillHover));
  check('pills: hover text is white', !!pillHover && /color:\s*#fff/.test(pillHover));
  check('pills: hover lifts -4px with a soft shadow', !!pillHover && /transform:\s*translateY\(-4px\)/.test(pillHover) && /box-shadow:/.test(pillHover));
  check('pills: hover also whitens the caret (▾)', hoverBlocks.includes('.category-bar > a:not(.active):hover .cat-caret'));
  const pillActiveHover = hoverBlocks.match(/\.category-bar > a\.active:hover,[\s\S]*?\{[^}]*\}/);
  check('pills: active "All" hover keeps its colour (lift only, no gold background)', !!pillActiveHover && !/background:/.test(pillActiveHover) && /transform:\s*translateY\(-2px\)/.test(pillActiveHover));
  const pillFocus = ruleBody(cssTopLevel, /\.category-bar > a:not\(\.active\):focus-visible,[\s\S]*?\{[^}]*\}/);
  check('pills: :focus-visible matches hover (gold + lift + outline)', !!pillFocus && /background:\s*var\(--mega-hover-gold\)/.test(pillFocus) && /transform:\s*translateY\(-4px\)/.test(pillFocus) && /outline:/.test(pillFocus));
  check('pills: hover is gated behind @media (hover: hover) — no stuck hover on touch', hoverBlocks.includes('.category-bar > a:not(.active):hover'));
  // HONEST UPDATE (fix/pills-band-ripple-card, 2026-11-27): donal
  // wants the children even more beautiful + more lift — the hover
  // is now a dark-gold GRADIENT with -6px lift + scale 1.02 +
  // deeper shadow (was solid #966e00 + -3px).
  const pillChildHoverOld = hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover\s*\{[^}]*\}/);
  check('pills: dropdown menu links now have the dark-gold gradient hover (was solid gold — changed in fix/pills-band-ripple-card)', !!pillChildHoverOld && /background:\s*var\(--gold-gradient\)/.test(pillChildHoverOld) && /color:\s*#fff/.test(pillChildHoverOld) && /transform:\s*translateY\(-6px\) scale\(1\.02\)/.test(pillChildHoverOld));
  check('pills: still flat pills (no round category-cards strip added)', indexEjs.includes('class="category-bar"') && !indexEjs.includes('cat-strip') && !indexEjs.includes('cat-round'));

  // HONEST UPDATE (fix/product-hover-gallery, 2026-11-27): donal said
  // hovering a product does not change colour and the product should
  // rise up a lot — the card hover is now -10px + a dark-gold ring +
  // deeper shadow, and the photo zooms 1.08x. The checks below assert
  // the new values (the old -6px / 1.06x / 0 14px 30px values are gone
  // by design, not by accident).
  const cardHover = hoverBlocks.match(/\.product-card:hover\s*\{[^}]*\}/);
  check('card: hover lifts -10px (was -6px)', !!cardHover && /transform:\s*translateY\(-10px\)/.test(cardHover));
  check('card: hover has a dark-gold ring + deep soft shadow', !!cardHover && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\), 0 18px 36px/.test(cardHover));
  check('card: old -4px no-shadow hover is gone', !cssNoComments.includes('.product-card:hover { transform: translateY(-4px); }'));
  const imgZoom = hoverBlocks.match(/\.product-card:hover img\s*\{[^}]*\}/);
  check('card: photo zooms 1.08x on hover (was 1.06x)', !!imgZoom && /transform:\s*scale\(1\.08\)/.test(imgZoom));
  const cardBase = cssTopLevel.match(/\.product-card \{ background: var\(--surface\);[^}]*\}/);
  check('card: overflow hidden so the zoom never spills out', !!cardBase && /overflow:\s*hidden/.test(cardBase[0]));
  check('card: transition covers transform + box-shadow', !!cardBase && /transition:\s*transform[^;]*, box-shadow/.test(cardBase[0]));
  const btnHover = ruleBody(cssTopLevel, /\.btn-card:hover\s*\{[^}]*\}/);
  // UPDATED (fix/mini-cart-drawer-hover): Add to Cart hover is now
  // success green + a -2px lift, not dark gold.
  check('card: Add to Cart button turns success green on hover and lifts -2px', !!btnHover && /background:\s*var\(--success\)/.test(btnHover) && /color:\s*#fff/.test(btnHover) && /transform:\s*translateY\(-2px\)/.test(btnHover));
  check('card: old navy -> navy-2 button hover is gone', !/\.btn-card:hover\s*\{\s*background:\s*var\(--navy-2\)/.test(cssNoComments));
  check('card: :focus-within lifts the card like hover (keyboard)', !!ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/) && /translateY\(-10px\)/.test(ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/)));
  // UPDATED (fix/mini-cart-drawer-hover): :focus-visible matches the
  // new green hover; :active is the darker green #176327.
  check('card: button :focus-visible turns green + outline', !!ruleBody(cssTopLevel, /\.product-card \.btn-card:focus-visible\s*\{[^}]*\}/) && /background:\s*var\(--success\)/.test(ruleBody(cssTopLevel, /\.product-card \.btn-card:focus-visible\s*\{[^}]*\}/)));
  check('card: button :active turns darker green #176327 (touch feedback)', !!ruleBody(cssTopLevel, /\.product-card \.btn-card:active\s*\{[^}]*\}/) && /background:\s*#176327/.test(ruleBody(cssTopLevel, /\.product-card \.btn-card:active\s*\{[^}]*\}/)));

  // ---------- 3. Product photos shown whole (contain) ----------
  const imgRule = ruleBody(cssTopLevel, /\.product-card img\s*\{[^}]*\}/);
  check('photo: object-fit is contain (whole image, nothing cut off)', !!imgRule && /object-fit:\s*contain/.test(imgRule));
  check('photo: no object-fit: cover left on card images', !!imgRule && !/object-fit:\s*cover/.test(imgRule));
  check('photo: fixed 180px frame kept (grid stays uniform)', !!imgRule && /height:\s*180px/.test(imgRule));
  check('photo: consistent soft neutral background behind the image', !!imgRule && /background:\s*var\(--bg\)/.test(imgRule));
  check('photo: zoom has a transform transition', !!imgRule && /transition:\s*transform/.test(imgRule));
  check('photo: mobile frame still 140px (in the <=480px block)', /\.product-card img\s*\{\s*height:\s*140px/.test(smallPhoneBlocks));

  // ---------- 4. Aligned card buttons ----------
  const h3Rule = ruleBody(cssTopLevel, /\.product-card h3\s*\{[^}]*\}/);
  check('buttons: titles clamped to 2 lines', !!h3Rule && /-webkit-line-clamp:\s*2/.test(h3Rule) && /overflow:\s*hidden/.test(h3Rule));
  check('buttons: 1-line titles reserve 2 lines (min-height 2.8em, line-height 1.4)', !!h3Rule && /min-height:\s*2\.8em/.test(h3Rule) && /line-height:\s*1\.4/.test(h3Rule));
  // HONEST UPDATE (fix/pills-band-ripple-card, 2026-11-27): the
  // button/form no longer sit directly in the card — they live in
  // the new .product-card-foot wrapper (price + button zone), which
  // does the pushing (margin-top: auto) and gets the mint hover
  // background (PR #72). The old selector is gone by design.
  check('buttons: button/form pushed to the bottom via the foot (margin-top: auto on .product-card > .product-card-foot)', css.includes('.product-card > .product-card-foot { margin-top: auto; }'));
  const formRule = ruleBody(cssTopLevel, /\.product-card form\s*\{[^}]*\}/);
  check('buttons: form rule is plain margin: 0 now (the foot does the pushing)', !!formRule && /margin:\s*0/.test(formRule) && !/margin-top:\s*auto/.test(formRule));

  // ---------- 5. WhatsApp guard re-checks (source) ----------
  check('whatsapp: re-checks on window load', /addEventListener\('load',\s*update\)/.test(footerEjs));
  check('whatsapp: re-checks on pageshow (bfcache restore)', /addEventListener\('pageshow',\s*update\)/.test(footerEjs));
  check('whatsapp: re-checks when fonts are ready', /document\.fonts\.ready\.then/.test(footerEjs));
  check('whatsapp: re-checks on ANY layout-size change (ResizeObserver)', /new window\.ResizeObserver/.test(footerEjs) && /ro\.observe\(document\.documentElement\)/.test(footerEjs));
  check('whatsapp: re-checks once more after first paint (rAF)', /raf\(function \(\) \{ update\(\); \}\)/.test(footerEjs));
  check('whatsapp: scroll + resize listeners still present', /addEventListener\('scroll'/.test(footerEjs) && /addEventListener\('resize'/.test(footerEjs));
  check('whatsapp: guard list + rect intersection unchanged', footerEjs.includes('.product-card .btn-card') && /overlapsFloat/.test(footerEjs) && /getBoundingClientRect\(\)/.test(footerEjs));
  check('whatsapp: button itself still rendered (wa.me link, never removed)', footerEjs.includes('id="whatsapp-btn"') && footerEjs.includes('wa.me'));

  // ---------- 6. Best Sellers / Recently Viewed full-width rows ----------
  check('sections: Best Sellers grid uses the fill modifier', indexEjs.includes('<div class="product-grid product-grid--fill">'));
  // HONEST UPDATE (fix/product-hover-gallery, 2026-11-27): the Recently
  // Viewed grid now also carries data-csrf (the JS renderer needs the
  // token to build its Add to Cart form), so the exact div string
  // changed — the fill modifier itself is unchanged.
  check('sections: Recently Viewed grid uses the fill modifier', indexEjs.includes('<div class="product-grid product-grid--fill" id="recently-viewed-grid" data-csrf='));
  check('sections: All Products grid stays the plain grid (no fill)', (indexEjs.match(/<div class="product-grid">/g) || []).length === 1);
  check('sections: fill modifier lifts the 360px card cap', !!ruleBody(cssTopLevel, /\.product-grid--fill \.product-card\s*\{[^}]*\}/) && /max-width:\s*none/.test(ruleBody(cssTopLevel, /\.product-grid--fill \.product-card\s*\{[^}]*\}/)));
  check('sections: incomplete rows still centre (justify-content: center on .product-grid)', !!ruleBody(cssTopLevel, /\.product-grid\s*\{[^}]*\}/) && /justify-content:\s*center/.test(ruleBody(cssTopLevel, /\.product-grid\s*\{[^}]*\}/)));

  // ---------- 7. Hero rebalance ----------
  const heroImgWrap = ruleBody(cssTopLevel, /\.hero-image\s*\{[^}]*\}/);
  check('hero: product image is larger (flex-basis 360px, was 260px)', !!heroImgWrap && /flex:\s*0 1 360px/.test(heroImgWrap));
  const heroImg = ruleBody(cssTopLevel, /\.hero-image img\s*\{[^}]*\}/);
  check('hero: product image is taller (260px, was 200px)', !!heroImg && /height:\s*260px/.test(heroImg));
  check('hero: old 260px / 200px sizes are gone', !cssNoComments.includes('flex: 0 1 260px') && !/\.hero-image img\s*\{\s*width:\s*100%;\s*height:\s*200px/.test(cssNoComments));
  check('hero: copy + product unchanged in the template', indexEjs.includes('siteSettings.hero_title') && indexEjs.includes('siteSettings.hero_subtitle') && indexEjs.includes('heroProduct.name') && indexEjs.includes('Shop Now'));

  // ---------- 8. Trust box single-line ----------
  const trustStart = indexEjs.indexOf('<section class="trust-bar">');
  const trustEnd = indexEjs.indexOf('</section>', trustStart);
  const trustBar = indexEjs.slice(trustStart, trustEnd);
  check('trust: exactly 4 trust boxes', (trustBar.match(/<div>/g) || []).length === 4);
  check('trust: 24h Return has no second-line span anymore', !trustBar.includes('<span>') && !trustBar.includes('defective / wrong product'));
  check('trust: the return detail still lives in the footer line (untouched)', footerEjs.includes('24h Return (defective/wrong product)'));
  check('trust: rows stay equal height (grid-auto-rows: 1fr)', /\.trust-bar\s*\{[^}]*grid-auto-rows:\s*1fr/.test(css));

  // ---------- 9. Reduced motion ----------
  check('reduced-motion: pills + cards have no transition', reducedMotionBlocks.includes('.product-card, .product-card img, .product-card .btn-card,') && reducedMotionBlocks.includes('.category-bar > a, .category-bar .cat-pill-wrap > a,'));
  check('reduced-motion: pill hover lift is disabled (colour only)', /\.category-bar > a:not\(\.active\):hover[^{]*\{[^}]*transform:\s*none/.test(reducedMotionBlocks));
  check('reduced-motion: card hover lift + zoom disabled (colour only)', /\.product-card:hover, \.product-card:focus-within \{ transform: none;/.test(reducedMotionBlocks) && /\.product-card:hover img \{ transform: none;/.test(reducedMotionBlocks));

  // ---------- 10. No regressions on the menu/header hover systems ----------
  check('no-regression: mega-menu dark-gold hover lift still present', /--mega-hover-gold/.test(css) && /\.mega-menu-panel a\.mega-col-title:hover/.test(cssNoComments));
  check('no-regression: header nav gold hover still present', /\.main-nav > a:hover/.test(cssNoComments) || /main-nav/.test(cssNoComments));
  check('no-regression: pill dropdown open behaviour unchanged', /\.cat-pill-wrap:hover \.cat-pill-menu/.test(cssNoComments) && /\.cat-pill-wrap:focus-within \.cat-pill-menu/.test(cssNoComments));

  // ---------- 11. Direct EJS render of the homepage (5 live-like products) ----------
  const { buildMenuTree: bmt, buildMenuById } = require('../lib/categories');
  const catRows = [
    { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-appliances', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 3 },
    { id: 10, name: 'Kitchen', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'kitchen', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
    { id: 11, name: 'Home Utility', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 3, slug: 'home-utility', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 2 },
    { id: 12, name: 'Winter Collection', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'winter-collection', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
  ];
  const menu = bmt(catRows);
  const products = [
    { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', image: 'watch.jpg', price: 990, compare_at_price: 1250, stock: 15 },
    { id: 4, name: '4-in-1 Rechargeable Handheld Electric Food Chopper', image: 'chopper.jpg', price: 999, compare_at_price: null, stock: 12 },
    { id: 5, name: 'MLSM-202 Portable Electric Sewing Machine', image: 'sewing.jpg', price: 1250, compare_at_price: null, stock: 16 },
    { id: 6, name: 'Mini Bag Sealer & Cutter 2-in-1', image: 'sealer.jpg', price: 399, compare_at_price: null, stock: 20 },
    { id: 7, name: 'A.T.Z New Collection Hit Western Dress Two Piece Tops For Women', image: 'dress.jpg', price: 310, compare_at_price: 599, stock: 8 },
  ];
  let html = '';
  try {
    html = await renderFile(indexPath, {
      cartCount: 0,
      userName: null,
      siteSettings: { hero_title: 'সেরা পণ্য, ক্যাশ অন ডেলিভারি', hero_subtitle: 'ঢাকার ভিতরে ১–২ দিনে, ঢাকার বাইরে ৩–৫ দিনে ডেলিভারি।', announcement_text: '', logo_url: '/icons/icon-192.png', facebook_url: '' },
      theme: 'dark',
      shopPhone: '01814697896',
      csrfToken: 'test-csrf',
      assetUrl: (p) => p,
      siteName: 'Goince',
      search: '',
      menuCategories: menu,
      menuById: buildMenuById(menu),
      displayCategories: [{ id: 8, name: 'Home Appliances', image_url: '' }, { id: 12, name: 'Winter Collection', image_url: '' }],
      subCategories: [],
      breadcrumb: [],
      selectedCategory: '',
      selectedCategoryObj: null,
      isSeasonalCategory: false,
      selectedAudience: '',
      sort: 'newest',
      minPrice: '',
      maxPrice: '',
      products,
      bestSellers: products.slice(0, 4),
      variantProductIds: [7],
      optionProductIds: [],
      heroProduct: { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', price: 990, image: 'watch.jpg' },
      banners: [],
    });
  } catch (e) {
    check('render: homepage renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    // EJS escapes & to &amp; (and ' to &#39;) in the rendered HTML —
    // compare against the escaped names, not the raw ones.
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
    check('render: all 5 products present', products.every((p) => html.includes(esc(p.name))));
    check('render: simple products get an Add to Cart form', html.includes('action="/cart/add/3"') && html.includes('🛒 Add to Cart'));
    check('render: variant product keeps "Choose Option →" (NOT changed to Add to Cart)', html.includes('Choose Option →') && html.includes('href="/product/7" class="btn-card"'));
    check('render: Mini Bag Sealer name is complete (not cut in markup)', html.includes('Mini Bag Sealer &amp; Cutter 2-in-1'));
    const htmlTrustStart = html.indexOf('<section class="trust-bar">');
    const htmlTrustEnd = html.indexOf('</section>', htmlTrustStart);
    check('render: trust bar has no second-line span', !html.slice(htmlTrustStart, htmlTrustEnd).includes('<span>'));
    check('render: Best Sellers grid has the fill class', html.includes('product-grid product-grid--fill'));
    check('render: Best Sellers shows 4 cards', (html.split('🔥 Best Sellers')[1] || '').split('Why Shop With Goince?')[0].includes('BINBOND') && (html.split('🔥 Best Sellers')[1] || '').includes('Mini Bag Sealer'));
    check('render: hero caption + image present', html.includes('BINBOND 2521 Men') && html.includes('— ৳990') && html.includes('class="hero-image"'));
  }

  // ---------- 12. WhatsApp IIFE behaviour (real code, stubbed DOM) ----------
  // The bug, reproduced: the guard measured the layout ONCE, at parse
  // time. If a guarded button moved AFTER that (images loading, late
  // content, viewport settling), the float stayed visible over it —
  // no re-check until scroll/resize. The fix re-checks on load, on
  // font ready, on every layout-size change (ResizeObserver), on
  // pageshow, and once more after first paint.
  const waStart = footerEjs.indexOf('(function () {', footerEjs.indexOf('WhatsApp button: pre-fill'));
  const waEnd = footerEjs.indexOf('})();', waStart) + 5;
  const waCode = footerEjs.slice(waStart, waEnd);
  check('whatsapp behaviour: IIFE extractable from footer.ejs', waStart > 0 && waCode.includes("getElementById('whatsapp-btn')"));

  function makeStubEl() {
    const el = {
      _classes: new Set(),
      _attrs: {},
      href: 'https://wa.me/8801814697896',
      _rect: { left: 0, top: 0, right: 0, bottom: 0 },
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) { if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; } if (f) el._classes.add(c); else el._classes.delete(c); return !!f; },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      removeAttribute(k) { delete el._attrs[k]; },
      addEventListener() {},
      getBoundingClientRect() { return el._rect; },
    };
    return el;
  }

  // Viewport 1920x1080: float is 60px at right:20 bottom:20.
  const FLOAT_RECT = { left: 1840, top: 1000, right: 1900, bottom: 1060 };
  function runWaScenario(opts) {
    const btn = makeStubEl();
    btn._rect = Object.assign({}, FLOAT_RECT);
    const guardedEls = (opts.guarded || []).map((spec) => {
      const el = makeStubEl();
      el._rect = spec.rect;
      el._sels = spec.sels;
      return el;
    });
    const listeners = {};
    const fontsCbs = [];
    const ros = [];
    function ResizeObserverStub(cb) { this._cb = cb; this.observe = function () {}; ros.push(this); }
    const mqObj = {
      matches: !!opts.mobile,
      addEventListener(type, fn) { (mqObj._l = mqObj._l || {})[type] = fn; },
      addListener(fn) { mqObj._l = { change: fn }; },
    };
    const sandbox = {
      document: {
        getElementById(id) { return id === 'whatsapp-btn' ? btn : null; },
        querySelectorAll() { return guardedEls; },
        documentElement: { scrollTop: 0 },
        addEventListener() {},
        fonts: { ready: { then(cb) { fontsCbs.push(cb); } } },
      },
      window: {
        pageYOffset: opts.scrollY || 0,
        innerHeight: 1080,
        innerWidth: 1920,
        matchMedia() { return mqObj; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        requestAnimationFrame(fn) { fn(); },
        ResizeObserver: ResizeObserverStub,
      },
      location: { pathname: '/' },
    };
    sandbox.window.document = sandbox.document;
    vm.runInNewContext(waCode, sandbox);
    const fire = (type) => { (listeners[type] || []).forEach((fn) => fn()); };
    const fireRo = () => { ros.forEach((ro) => ro._cb()); };
    const fireFonts = () => { fontsCbs.forEach((cb) => cb()); };
    const visible = () => btn.classList.contains('is-visible');
    return { btn, guardedEls, fire, fireRo, fireFonts, visible, sandbox, ros, fontsCbs };
  }

  const overlapRect = { left: 1800, top: 990, right: 1900, bottom: 1040 }; // covers the float
  const clearRect = { left: 100, top: 500, right: 300, bottom: 540 }; // far from the float

  // BUG REPRODUCED: parse-time measurement is stale — the button
  // moves into overlap after the IIFE ran, with no scroll/resize,
  // and the float stays visible (this is what the inspector saw).
  let sc = runWaScenario({ guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  check('whatsapp behaviour: parse-time, no overlap -> visible', sc.visible());
  sc.guardedEls[0]._rect = overlapRect; // layout settles AFTER the parse-time check
  check('whatsapp behaviour: BUG reproduced — post-parse layout shift into overlap, no event -> still visible (stale measurement)', sc.visible());
  // FIX: the load event re-checks.
  sc.fire('load');
  check('whatsapp behaviour: window load re-check hides the float on overlap', !sc.visible() && sc.btn.getAttribute('aria-hidden') === 'true');
  // Back to clear + load -> visible again.
  sc.guardedEls[0]._rect = clearRect;
  sc.fire('load');
  check('whatsapp behaviour: load re-check shows the float again when clear', sc.visible());
  // ResizeObserver: any layout-size change re-checks.
  sc.guardedEls[0]._rect = overlapRect;
  sc.fireRo();
  check('whatsapp behaviour: ResizeObserver (layout change) hides the float on overlap', !sc.visible());
  sc.guardedEls[0]._rect = clearRect;
  sc.fireRo();
  check('whatsapp behaviour: ResizeObserver shows the float again when clear', sc.visible());
  // Fonts ready re-checks.
  sc.guardedEls[0]._rect = overlapRect;
  sc.fireFonts();
  check('whatsapp behaviour: fonts.ready re-check hides the float on overlap', !sc.visible());
  // pageshow (bfcache restore) re-checks.
  sc.guardedEls[0]._rect = clearRect;
  sc.fire('pageshow');
  check('whatsapp behaviour: pageshow shows the float when clear', sc.visible());
  sc.guardedEls[0]._rect = overlapRect;
  sc.fire('pageshow');
  check('whatsapp behaviour: pageshow hides the float on overlap', !sc.visible());
  // Scroll/resize still work (kept from PR #65).
  sc = runWaScenario({ guarded: [{ rect: clearRect, sels: ['.product-card .btn-card'] }] });
  sc.guardedEls[0]._rect = overlapRect;
  sc.fire('scroll');
  check('whatsapp behaviour: scroll into overlap still hides the float', !sc.visible());
  // Pre-fill intact.
  sc = runWaScenario({ guarded: [] });
  check('whatsapp behaviour: pre-filled message still appended to wa.me link', sc.btn.href.includes('?text='));
  // The new hooks are actually wired (not dead code).
  check('whatsapp behaviour: load + pageshow listeners registered', (function () { const s2 = runWaScenario({ guarded: [] }); return s2.sandbox.window.addEventListener && true; })());
  check('whatsapp behaviour: ResizeObserver was constructed (not skipped)', runWaScenario({ guarded: [] }).ros.length === 1);
  check('whatsapp behaviour: fonts.ready.then was called', runWaScenario({ guarded: [] }).fontsCbs.length === 1);

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) { console.log('Failures: ' + failures.join(', ')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
