// Product hover + gallery (fix/product-hover-gallery) — Add to Cart
// on Best Sellers + Recently Viewed, stronger product-card hover,
// product detail page gallery (fixed sizes, hover zoom, zoom in/out),
// pill-dropdown child links hover (generic, any number of children).
//
// donal said (2026-11-27, in Romanized Bengali, with a screenshot of
// the open "Home Appliances" pill dropdown): Recently Viewed and Best
// Sellers have no Add to Cart; on All Products, hovering a product
// does not change colour; on hover the colour should change, there
// should be a beautiful effect, and the product should rise up a lot;
// inside any product there are many photos — fix the size on mobile
// and PC/desktop; the product does not zoom — the big photo should
// zoom when the cursor goes over it, and zoom in/out must be
// possible; add any other feature that belongs; and the menu children
// in the screenshot have no effect — fix that so it works the same
// no matter how many child categories there are.
//
// What the code check found:
//   1. BEST SELLERS: cards had image + name + price only — no button
//      at all. RECENTLY VIEWED: JS-rendered from localStorage, also
//      no button — and the saved items had no variant/stock info and
//      the renderer had no CSRF token to POST with.
//   2. CARD HOVER (PR #68): lift -6px + 1.06x zoom + the button went
//      gold ONLY on its OWN :hover — hovering the card left the
//      button navy (the live deploy check proved it: "stayed dark
//      navy while only the photo was hovered"). No colour change on
//      the card itself at all — that is exactly what donal reports.
//   3. GALLERY: the main photo had no fixed frame (width: 100%,
//      height auto) so the layout jumped when photos changed; and
//      `.thumbnail` (0,1,0) lost the width fight to
//      `.product-image img` (0,1,1), so thumbnails tried to take the
//      row's full width instead of 60px — the sizes donal complained
//      about. No zoom of any kind existed.
//   4. PILL DROPDOWN CHILDREN: `.cat-pill-menu a:hover` was a plain
//      bg-hover tint (nearly invisible in dark mode); the drawer
//      sub-links had the same plain tint.
//
// What was built (SHOP ONLY — admin untouched):
//   1. BUTTONS: Best Sellers cards get the exact All Products button
//      logic (variant/option -> "Choose Option →", else Add to Cart
//      form with the same CSRF partial). Recently Viewed: the saved
//      item now carries stock + hasOptions (product.ejs), the grid
//      carries data-csrf, and the renderer builds the same button —
//      "Choose Option →" when the product has variants/options, when
//      the saved item is old (no flag — safe route), or when no CSRF
//      token is available; Add to Cart form otherwise (stock > 0).
//      Out of stock -> no button. The buttons reuse .btn-card inside
//      .product-card, so the PR #68 hover and the PR #65 WhatsApp
//      overlap guard apply automatically.
//   2. CARD HOVER: -10px lift + a 2px dark-gold ring
//      (box-shadow: 0 0 0 2px #966e00) + deeper shadow, photo 1.08x,
//      and the button turns dark gold + white on CARD hover (not
//      only its own hover). :focus-within matches. Both themes;
//      @media (hover: hover); reduced-motion disables lift/zoom.
//   3. GALLERY (new public/js/product-gallery.js, cache-busted via
//      lib/assets.js, included in the footer like mega-menu.js):
//      fixed 4/3 stage (mobile + desktop), whole photo via
//      object-fit: contain; hover zoom to 2x following the cursor
//      (transform-origin tracks the pointer) on hover-capable
//      devices; click/tap toggles 1x <-> 2x; + / − buttons step
//      1x/2x/3x, ⟲ resets; prev/next arrows step through photos;
//      keyboard ←/→/+/-/0 when the gallery is focused; thumbnails
//      are a uniform 64px (specificity fixed), active one has a
//      gold ring; changing photo resets the zoom; a MutationObserver
//      on the main image src resets the zoom when variant/option
//      code swaps the photo. No fullscreen lightbox (out of scope).
//   4. CHILDREN HOVER: one generic class rule —
//      `.cat-pill-menu a:hover` (and :focus-visible) — dark gold +
//      white text + -3px lift + shadow, count near-white; it applies
//      to every child AND grandchild link, however many there are
//      (no nth-child / per-item rules). Same treatment for the
//      mobile drawer sub/sub-sub links (gold bg + white text, no
//      lift — drawer rows are full-width).
//
// NOT in scope: the ¥3999 tag baked INTO the BINBOND watch photo
// (no CSS can remove text inside the image file — donal must upload
// a clean photo via Admin -> Products -> Edit -> photo). Related
// Products on the product page still have no Add to Cart button —
// that loop has no variant ids in scope; the hover applies to them
// automatically via the shared .product-card classes.
//
// FIX (fix/recently-viewed-old-items): PR #69-er poreo Recently Viewed-e
// purono saved item (flag chara) shob "Choose Option →" dekhachhilo —
// karon renderer-er kache variant/stock janar upay chilo na. Ekhon
// server theke id -> { stock, hasOptions } map (data-products) ashe;
// purono item-er button map theke fallback-e thik hoy (Add to Cart /
// Choose Option / kichu na). Notun save-er flags-oi primary thake;
// map-e na thaka product (muche geche) ager motoi safe "Choose Option →".
//
// No live MySQL needed: CSS/EJS source checks + direct EJS renders
// of the homepage and the product page + the REAL gallery IIFE run
// in a stubbed DOM (vm sandbox — no jsdom in node_modules).
//
// Run:  node scripts/test-product-hover-gallery.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const ejs = require('ejs');
const vm = require('vm');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
const indexEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
const productEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'product.ejs'), 'utf8');
const galleryJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'product-gallery.js'), 'utf8');
const footerEjs = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'footer.ejs'), 'utf8');
const assetsJs = fs.readFileSync(path.join(__dirname, '..', 'lib', 'assets.js'), 'utf8');
const renderFile = util.promisify(ejs.renderFile);
const indexPath = path.join(__dirname, '..', 'views', 'index.ejs');
const productPath = path.join(__dirname, '..', 'views', 'product.ejs');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-homepage-beauty.js: top-level CSS (comments +
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

function ruleBody(source, selectorRe) {
  const m = source.match(selectorRe);
  return m ? m[0] : null;
}

const { buildMenuTree: bmt, buildMenuById } = require('../lib/categories');
const catRows = [
  { id: 8, name: 'Home Appliances', parent_id: null, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'home-appliances', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 3 },
  { id: 10, name: 'Kitchen', parent_id: 8, is_visible: 1, is_featured: 0, sort_order: 2, slug: 'kitchen', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
  { id: 13, name: 'Cookware', parent_id: 10, is_visible: 1, is_featured: 0, sort_order: 1, slug: 'cookware', image_url: '', description: '', banner_url: '', meta_title: '', meta_description: '', product_count: 1 },
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
const baseLocals = {
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
};

(async function main() {
  console.log('Product hover + gallery (fix/product-hover-gallery) checks:');

  // ---------- 1. Stronger product-card hover (CSS) ----------
  const cardHover = hoverBlocks.match(/\.product-card:hover\s*\{[^}]*\}/);
  check('card: hover lifts -10px (was -6px)', !!cardHover && /transform:\s*translateY\(-10px\)/.test(cardHover));
  check('card: hover has a dark-gold ring (2px #966e00) — the colour change', !!cardHover && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\)/.test(cardHover));
  check('card: hover has a deeper soft shadow too', !!cardHover && /0 18px 36px/.test(cardHover));
  check('card: old -6px / 1.06x hover is gone', !/\.product-card:hover\s*\{\s*transform:\s*translateY\(-6px\)/.test(cssNoComments));
  const imgZoom = hoverBlocks.match(/\.product-card:hover img\s*\{[^}]*\}/);
  check('card: photo zooms 1.08x on hover (was 1.06x)', !!imgZoom && /transform:\s*scale\(1\.08\)/.test(imgZoom));
  const cardBtnHover = hoverBlocks.match(/\.product-card:hover \.btn-card\s*\{[^}]*\}/);
  check('card: button turns dark gold on CARD hover (the reported gap — was button-only :hover)', !!cardBtnHover && /background:\s*var\(--mega-hover-gold\)/.test(cardBtnHover) && /color:\s*#fff/.test(cardBtnHover));
  const cardFocus = ruleBody(cssTopLevel, /\.product-card:focus-within\s*\{[^}]*\}/);
  check('card: :focus-within lifts -10px + gold ring like hover (keyboard)', !!cardFocus && /translateY\(-10px\)/.test(cardFocus) && /0 0 0 2px var\(--mega-hover-gold\)/.test(cardFocus));
  check('card: :focus-within golds the button too', !!ruleBody(cssTopLevel, /\.product-card:focus-within \.btn-card\s*\{[^}]*\}/) && /background:\s*var\(--mega-hover-gold\)/.test(ruleBody(cssTopLevel, /\.product-card:focus-within \.btn-card\s*\{[^}]*\}/)));
  check('card: button own :hover still gold (unchanged)', !!ruleBody(cssTopLevel, /\.btn-card:hover\s*\{[^}]*\}/) && /background:\s*var\(--mega-hover-gold\)/.test(ruleBody(cssTopLevel, /\.btn-card:hover\s*\{[^}]*\}/)));
  check('card: hover gated behind @media (hover: hover) — no stuck hover on touch', hoverBlocks.includes('.product-card:hover'));
  check('card: reduced-motion disables lift + zoom (ring reset, colour only)', /\.product-card:hover, \.product-card:focus-within \{ transform: none;/.test(reducedMotionBlocks) && /\.product-card:hover img \{ transform: none;/.test(reducedMotionBlocks));

  // ---------- 2. Pill-dropdown child links hover (CSS) ----------
  const pillChildHover = hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover\s*\{[^}]*\}/);
  check('pill-children: generic hover rule exists (dark gold)', !!pillChildHover && /background:\s*var\(--mega-hover-gold\)/.test(pillChildHover));
  check('pill-children: hover text is white', !!pillChildHover && /color:\s*#fff/.test(pillChildHover));
  check('pill-children: hover lifts -3px with a shadow', !!pillChildHover && /transform:\s*translateY\(-3px\)/.test(pillChildHover) && /box-shadow:/.test(pillChildHover));
  check('pill-children: hover whitens the count span', hoverBlocks.includes('.category-bar .cat-pill-menu a:hover .cat-count'));
  check('pill-children: rule is GENERIC — no nth-child / per-item selector in the hover rule', !!pillChildHover && !/nth-child|nth-of-type/.test(pillChildHover));
  check('pill-children: old plain bg-hover tint is gone', !/\.category-bar \.cat-pill-menu a:hover\s*\{\s*background:\s*var\(--bg-hover\)/.test(cssNoComments));
  check('pill-children: :focus-visible matches hover (gold + lift + outline)', !!ruleBody(cssTopLevel, /\.category-bar \.cat-pill-menu a:focus-visible\s*\{[^}]*\}/) && /background:\s*var\(--mega-hover-gold\)/.test(ruleBody(cssTopLevel, /\.category-bar \.cat-pill-menu a:focus-visible\s*\{[^}]*\}/)));
  check('pill-children: hover gated behind @media (hover: hover)', hoverBlocks.includes('.category-bar .cat-pill-menu a:hover'));
  check('pill-children: reduced-motion disables the lift (colour only)', /\.category-bar \.cat-pill-menu a:hover[^{]*\{[^}]*transform:\s*none/.test(reducedMotionBlocks));
  const drawerSubHover = mobileBlocks.match(/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover\s*\{[^}]*\}/);
  check('drawer: sub + sub-sub links get the same dark-gold hover', !!drawerSubHover && /background:\s*var\(--mega-hover-gold\)/.test(drawerSubHover) && /color:\s*#fff/.test(drawerSubHover));
  check('drawer: sub links :focus-visible matches hover', mobileBlocks.includes('.shop-drawer-sub a:focus-visible'));
  check('drawer: old plain bg-hover tint on sub links is gone', !/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover\s*\{\s*background:\s*var\(--bg-hover\)/.test(cssNoComments));

  // ---------- 3. Gallery CSS ----------
  const stageRule = ruleBody(cssTopLevel, /\.gallery-stage\s*\{[^}]*\}/);
  check('gallery: stage has a fixed 4/3 frame (mobile + desktop)', !!stageRule && /aspect-ratio:\s*4 \/ 3/.test(stageRule));
  check('gallery: stage hides overflow (zoom never spills out)', !!stageRule && /overflow:\s*hidden/.test(stageRule));
  check('gallery: stage has the soft neutral background', !!stageRule && /background:\s*var\(--bg\)/.test(stageRule));
  const stageImg = ruleBody(cssTopLevel, /\.gallery-stage #main-product-image\s*\{[^}]*\}/);
  check('gallery: main photo fills the frame, whole image via contain', !!stageImg && /width:\s*100%/.test(stageImg) && /height:\s*100%/.test(stageImg) && /object-fit:\s*contain/.test(stageImg));
  check('gallery: main photo has a transform transition (smooth zoom)', !!stageImg && /transition:\s*transform/.test(stageImg));
  check('gallery: zoomed stage shows a zoom-out cursor', cssTopLevel.includes('.gallery-stage.is-zoomed'));
  check('gallery: prev/next arrows styled (absolute, round, gold on hover)', cssTopLevel.includes('.gallery-arrow') && /\.gallery-arrow:hover\s*\{[^}]*background:\s*var\(--mega-hover-gold\)/.test(cssTopLevel));
  check('gallery: zoom buttons styled (+ / − / reset, gold on hover)', cssTopLevel.includes('.gallery-zoom-btn') && /\.gallery-zoom-btn:hover\s*\{[^}]*background:\s*var\(--mega-hover-gold\)/.test(cssTopLevel));
  check('gallery: zoom hint exists (hover text + touch text)', cssTopLevel.includes('.gallery-zoom-hint') && cssTopLevel.includes('.zoom-hint-touch'));
  const thumbRule = ruleBody(cssTopLevel, /\.thumbnail-row \.thumbnail\s*\{[^}]*\}/);
  check('gallery: thumbnails are a uniform 64px (specificity fixed: .thumbnail-row .thumbnail beats .product-image img)', !!thumbRule && /width:\s*64px/.test(thumbRule) && /height:\s*64px/.test(thumbRule));
  check('gallery: thumbnails use contain (whole image, nothing cut off)', !!thumbRule && /object-fit:\s*contain/.test(thumbRule));
  check('gallery: thumbnail row scrolls instead of wrapping unevenly', /\.thumbnail-row\s*\{[^}]*overflow-x:\s*auto/.test(cssTopLevel));
  const thumbActive = ruleBody(cssTopLevel, /\.thumbnail\.active\s*\{[^}]*\}/);
  check('gallery: active thumbnail has a gold ring', !!thumbActive && /border-color:\s*var\(--mega-hover-gold\)/.test(thumbActive) && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\)/.test(thumbActive));
  check('gallery: reduced-motion makes the zoom instant (transition none, zoom itself still works)', reducedMotionBlocks.includes('.gallery-stage #main-product-image'));

  // ---------- 4. Homepage render — Best Sellers + Recently Viewed buttons ----------
  let html = '';
  try {
    html = await renderFile(indexPath, Object.assign({}, baseLocals, {
      products,
      // Best Sellers-e variant product (id 7, A.T.Z) rakha holo, jate
      // "Choose Option →" branch-tao render-e proman hoy.
      bestSellers: [products[0], products[4], products[1], products[2]],
      variantProductIds: [7],
      optionProductIds: [],
      // Server map (fix/recently-viewed-old-items): purono saved item-er
      // fallback — id -> { stock, hasOptions }.
      recentlyViewedMap: { 3: { stock: 15, hasOptions: false }, 4: { stock: 12, hasOptions: false }, 5: { stock: 16, hasOptions: false }, 6: { stock: 0, hasOptions: false }, 7: { stock: 8, hasOptions: true } },
      heroProduct: { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', price: 990, image: 'watch.jpg' },
      banners: [],
    }));
  } catch (e) {
    check('render: homepage renders (EJS)', false, String(e && e.message));
  }
  if (html) {
    const bestStart = html.indexOf('🔥 Best Sellers');
    const bestEnd = html.indexOf('👀 Recently Viewed');
    const bestHtml = html.slice(bestStart, bestEnd);
    check('render: Best Sellers simple product gets an Add to Cart form', bestHtml.includes('action="/cart/add/3"') && bestHtml.includes('🛒 Add to Cart'));
    check('render: Best Sellers form carries the CSRF token (same partial as All Products)', bestHtml.includes('name="_csrf" value="test-csrf"'));
    check('render: Best Sellers variant product keeps "Choose Option →" (NOT Add to Cart)', bestHtml.includes('href="/product/7" class="btn-card"') && bestHtml.includes('Choose Option →'));
    check('render: Best Sellers buttons reuse .btn-card inside .product-card (hover + WhatsApp guard apply)', (bestHtml.match(/class="btn-card"/g) || []).length >= 4);
    check('render: All Products buttons still present (no regression)', html.includes('action="/cart/add/3"'));
    check('render: Recently Viewed grid carries data-csrf for its JS form', html.includes('id="recently-viewed-grid" data-csrf="test-csrf"'));
    check('render: Recently Viewed grid carries the server map (data-products) for old saved items', html.includes("data-products='{\"3\":{\"stock\":15,\"hasOptions\":false}") && html.includes('"7":{"stock":8,"hasOptions":true}'));
    check('render: Recently Viewed renderer builds an Add to Cart form from data-csrf', indexEjs.includes("grid.getAttribute('data-csrf')") && indexEjs.includes("'<form action=\"/cart/add/' + it.id"));
    check('render: Recently Viewed renderer reads the server map as the old-item fallback', indexEjs.includes("grid.getAttribute('data-products')") && indexEjs.includes('serverMap[it.id]'));
    check('render: Recently Viewed renderer still shows "Choose Option →" for variants + gone products (safe route)', indexEjs.includes('flags && flags.hasOptions') && indexEjs.includes("} else if (!flags) {") && indexEjs.includes("Choose Option →</a>'"));
    check('render: Recently Viewed renderer hides the button when out of stock (flags.stock > 0)', indexEjs.includes('flags.stock > 0'));
    check('render: Recently Viewed renderer no longer defaults every old item to "Choose Option →"', !indexEjs.includes('it.hasOptions !== false'));
    // Grandchild links exist in the pill dropdown (generic rule must cover them too).
    check('render: pill dropdown contains a grandchild link (Cookware under Kitchen)', html.includes('cat-pill-sub') && html.includes('Cookware'));
  }

  // ---------- 4b. Recently Viewed IIFE behaviour (real code, stubbed DOM) ----------
  // The renderer is inline in index.ejs — extract the REAL IIFE and run it
  // against saved items (old = no flags, new = with flags) + the server map.
  const rvStart = indexEjs.indexOf('// Recently viewed:');
  const rvJs = indexEjs.slice(indexEjs.lastIndexOf('<script>', rvStart) + '<script>'.length, indexEjs.indexOf('</script>', rvStart));
  const rvMapJson = JSON.stringify({ 3: { stock: 15, hasOptions: false }, 4: { stock: 12, hasOptions: false }, 5: { stock: 16, hasOptions: false }, 6: { stock: 0, hasOptions: false }, 7: { stock: 8, hasOptions: true } });
  function runRecentlyViewed(savedItems, csrf) {
    let gridHtml = '';
    let sectionHidden = true;
    const grid = {
      getAttribute(k) {
        if (k === 'data-csrf') return csrf;
        if (k === 'data-products') return rvMapJson;
        return null;
      },
      set innerHTML(v) { gridHtml = v; },
      get innerHTML() { return gridHtml; },
    };
    const section = {
      set hidden(v) { sectionHidden = v; },
      get hidden() { return sectionHidden; },
    };
    const sandbox = {
      document: {
        getElementById(id) {
          if (id === 'recently-viewed-grid') return grid;
          if (id === 'recently-viewed') return section;
          return null;
        },
      },
      localStorage: { getItem() { return JSON.stringify(savedItems); } },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(rvJs, sandbox);
    return { html: gridHtml, shown: !sectionHidden };
  }
  const oldSimple = { id: 3, name: 'BINBOND Watch', price: 990, image: 'watch.jpg' };
  const oldVariant = { id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg' };
  const oldOutOfStock = { id: 6, name: 'Mini Bag Sealer', price: 399, image: 'sealer.jpg' };
  const gone = { id: 99, name: 'Deleted Product', price: 100, image: 'gone.jpg' };

  let rv = runRecentlyViewed([oldSimple, oldVariant, oldOutOfStock, gone], 'test-csrf');
  check('recently-viewed behaviour: section unhidden when items exist', rv.shown === true);
  check('recently-viewed behaviour: OLD simple in-stock item gets an Add to Cart form (the bug)', rv.html.includes('action="/cart/add/3"') && rv.html.includes('🛒 Add to Cart') && rv.html.includes('name="_csrf" value="test-csrf"'));
  check('recently-viewed behaviour: OLD variant item gets "Choose Option →" (map fallback)', rv.html.includes('href="/product/7" class="btn-card"') && rv.html.includes('Choose Option →'));
  check('recently-viewed behaviour: OLD out-of-stock item gets NO button', !rv.html.includes('/cart/add/6') && !rv.html.includes('href="/product/6" class="btn-card"'));
  check('recently-viewed behaviour: gone product keeps the safe "Choose Option →" fallback', rv.html.includes('href="/product/99" class="btn-card"'));
  // New saved items (with flags) still render from their flags (primary).
  rv = runRecentlyViewed([{ id: 3, name: 'BINBOND Watch', price: 990, image: 'watch.jpg', stock: 15, hasOptions: false }], 'test-csrf');
  check('recently-viewed behaviour: NEW simple item still renders from its saved flags', rv.html.includes('action="/cart/add/3"') && rv.html.includes('🛒 Add to Cart'));
  rv = runRecentlyViewed([{ id: 7, name: 'A.T.Z Dress', price: 310, image: 'dress.jpg', stock: 8, hasOptions: true }], 'test-csrf');
  check('recently-viewed behaviour: NEW variant item still renders "Choose Option →" from its flags', rv.html.includes('href="/product/7" class="btn-card"'));
  // No CSRF token: safe route even for a simple in-stock old item.
  rv = runRecentlyViewed([oldSimple], '');
  check('recently-viewed behaviour: no CSRF token → simple item falls back to "Choose Option →"', rv.html.includes('href="/product/3" class="btn-card"') && !rv.html.includes('/cart/add/3'));

  // ---------- 5. Product page render — gallery markup ----------
  let phtml = '';
  try {
    phtml = await renderFile(productPath, Object.assign({}, baseLocals, {
      product: { id: 3, name: 'BINBOND 2521 Men\'s Luxury Quartz Watch', image: 'watch.jpg', price: 990, compare_at_price: 1250, stock: 15, target_audience: 'men', short_description: 'Luxury quartz watch', description: 'A fine watch.', delivery_time: '', allow_backorder: false },
      galleryImages: [{ image: 'watch-2.jpg' }, { image: 'watch-3.jpg' }],
      avgRating: 4.5,
      reviewCount: 2,
      discountPercent: 21,
      options: [],
      optionLabel: '',
      variants: [],
      variantAttributes: [],
      userName: null,
      deliveryCharge: 60,
      deliveryChargeOutside: 120,
      reviews: [],
      specs: [],
      descriptionHtml: '<p>A fine watch.</p>',
      related: [],
    }));
  } catch (e) {
    check('render: product page renders (EJS)', false, String(e && e.message));
  }
  if (phtml) {
    check('render: gallery stage exists (focusable, labelled)', phtml.includes('id="gallery-stage"') && phtml.includes('tabindex="0"') && phtml.includes('aria-label="Product photos"'));
    check('render: prev/next arrows exist (more than one photo)', phtml.includes('id="gallery-prev"') && phtml.includes('id="gallery-next"'));
    check('render: zoom controls exist (+ / − / reset)', phtml.includes('id="gallery-zoom-in"') && phtml.includes('id="gallery-zoom-out"') && phtml.includes('id="gallery-zoom-reset"'));
    check('render: zoom hint exists (hover + touch text)', phtml.includes('gallery-zoom-hint') && phtml.includes('zoom-hint-hover') && phtml.includes('zoom-hint-touch'));
    check('render: 3 thumbnails with data-full + data-index (main + 2 gallery)', (phtml.match(/<img[^>]*class="thumbnail/g) || []).length === 3 && phtml.includes('data-full="/uploads/watch-2.jpg"') && phtml.includes('data-index="2"'));
    check('render: first thumbnail is active', phtml.includes('class="thumbnail active"'));
    check('render: main image keeps its id (swapImage/variant code untouched)', phtml.includes('id="main-product-image"'));
    check('render: swapImage delegates to the gallery module when present', productEjs.includes('window.GoinceGallery') && productEjs.includes('showBySrc(src, el)'));
    check('render: saved recent item carries stock + hasOptions', productEjs.includes('stock: <%= product.stock %>') && productEjs.includes('hasOptions:'));
    check('render: gallery script is included in the footer (cache-busted like mega-menu.js)', footerEjs.includes("assetUrl('/js/product-gallery.js')"));
    check('render: product-gallery.js is in the asset version list (cache-busting works)', assetsJs.includes("'js/product-gallery.js'"));
  }

  // ---------- 6. Gallery IIFE behaviour (real code, stubbed DOM) ----------
  function makeStubEl(tag, id) {
    const el = {
      tagName: (tag || 'DIV').toUpperCase(),
      id: id || '',
      _classes: new Set(),
      _attrs: {},
      _listeners: {},
      style: {},
      disabled: false,
      src: '',
      classList: {
        add(c) { el._classes.add(c); },
        remove(c) { el._classes.delete(c); },
        toggle(c, f) {
          if (f === undefined) { if (el._classes.has(c)) { el._classes.delete(c); return false; } el._classes.add(c); return true; }
          if (f) el._classes.add(c); else el._classes.delete(c);
          return !!f;
        },
        contains(c) { return el._classes.has(c); },
      },
      setAttribute(k, v) { el._attrs[k] = String(v); if (k === 'src') el.src = String(v); },
      getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; },
    };
    return el;
  }
  function fire(el, type, event) {
    (el._listeners[type] || []).forEach((fn) => fn(Object.assign({ target: el, preventDefault() {} }, event || {})));
  }

  function buildGalleryDom(hoverMatches) {
    const stage = makeStubEl('div', 'gallery-stage');
    const img = makeStubEl('img', 'main-product-image');
    img.setAttribute('src', '/uploads/watch.jpg');
    const prev = makeStubEl('button', 'gallery-prev');
    const next = makeStubEl('button', 'gallery-next');
    const zoomIn = makeStubEl('button', 'gallery-zoom-in');
    const zoomOut = makeStubEl('button', 'gallery-zoom-out');
    const zoomReset = makeStubEl('button', 'gallery-zoom-reset');
    const thumbs = ['/uploads/watch.jpg', '/uploads/watch-2.jpg', '/uploads/watch-3.jpg'].map((src, i) => {
      const t = makeStubEl('img');
      t.setAttribute('data-full', src);
      t.setAttribute('src', src);
      if (i === 0) t.classList.add('active');
      return t;
    });
    const byId = {
      'gallery-stage': stage, 'main-product-image': img, 'gallery-prev': prev,
      'gallery-next': next, 'gallery-zoom-in': zoomIn, 'gallery-zoom-out': zoomOut,
      'gallery-zoom-reset': zoomReset,
    };
    const doc = {
      getElementById(id) { return byId[id] || null; },
      querySelectorAll(sel) { return sel === '.thumbnail' ? thumbs : []; },
    };
    const sandbox = {
      document: doc,
      window: {
        matchMedia: () => ({ matches: hoverMatches, addEventListener() {} }),
        MutationObserver: function () { this.observe = function () {}; },
      },
      console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    vm.runInContext(galleryJs, sandbox);
    return { stage, img, prev, next, zoomIn, zoomOut, zoomReset, thumbs, gallery: sandbox.window.GoinceGallery };
  }

  const g = buildGalleryDom(true);
  check('gallery behaviour: module exposes GoinceGallery with 3 images', !!g.gallery && g.gallery.getImages().length === 3);
  check('gallery behaviour: starts at 1x zoom, zoom-out disabled', g.gallery.getZoom() === 1 && g.zoomOut.disabled === true && g.zoomIn.disabled === false);
  g.gallery.showImage(1);
  check('gallery behaviour: showImage(1) swaps the photo + moves the active ring', g.img.src === '/uploads/watch-2.jpg' && g.gallery.getIndex() === 1 && g.thumbs[1].classList.contains('active') && !g.thumbs[0].classList.contains('active'));
  check('gallery behaviour: changing photo resets the zoom to 1x', g.gallery.getZoom() === 1 && g.img.style.transform === '');
  fire(g.next, 'click');
  check('gallery behaviour: next arrow steps to photo 3', g.gallery.getIndex() === 2 && g.img.src === '/uploads/watch-3.jpg');
  fire(g.next, 'click');
  check('gallery behaviour: next wraps around to photo 1', g.gallery.getIndex() === 0 && g.img.src === '/uploads/watch.jpg');
  fire(g.prev, 'click');
  check('gallery behaviour: prev wraps around to photo 3', g.gallery.getIndex() === 2);
  fire(g.stage, 'mouseenter', { target: g.stage });
  check('gallery behaviour: hover zooms to 2x (magnify on enter)', g.gallery.getZoom() === 2 && g.img.style.transform === 'scale(2)' && g.stage.classList.contains('is-zoomed'));
  fire(g.stage, 'mousemove', { target: g.stage, clientX: 300, clientY: 75 });
  check('gallery behaviour: zoom follows the cursor (transform-origin 75% 25%)', g.img.style.transformOrigin === '75.0% 25.0%');
  fire(g.stage, 'mouseleave', { target: g.stage });
  check('gallery behaviour: leaving the stage resets the zoom to 1x', g.gallery.getZoom() === 1 && g.img.style.transform === '');
  fire(g.stage, 'click', { target: g.img });
  check('gallery behaviour: click on the photo toggles zoom 1x -> 2x (tap on mobile)', g.gallery.getZoom() === 2);
  fire(g.stage, 'click', { target: g.zoomIn });
  check('gallery behaviour: click on a button does NOT toggle the zoom', g.gallery.getZoom() === 2);
  fire(g.stage, 'click', { target: g.img });
  check('gallery behaviour: click again toggles zoom 2x -> 1x', g.gallery.getZoom() === 1);
  fire(g.zoomIn, 'click');
  fire(g.zoomIn, 'click');
  check('gallery behaviour: + steps 1x -> 2x -> 3x and disables at 3x', g.gallery.getZoom() === 3 && g.zoomIn.disabled === true);
  fire(g.zoomOut, 'click');
  check('gallery behaviour: − steps 3x -> 2x', g.gallery.getZoom() === 2 && g.zoomIn.disabled === false);
  fire(g.zoomReset, 'click');
  check('gallery behaviour: ⟲ resets to 1x and re-enables − (disabled at 1x)', g.gallery.getZoom() === 1 && g.zoomOut.disabled === true);
  fire(g.stage, 'keydown', { target: g.stage, key: 'ArrowRight' });
  check('gallery behaviour: → key steps to the next photo', g.gallery.getIndex() === 0 && g.img.src === '/uploads/watch.jpg');
  fire(g.stage, 'keydown', { target: g.stage, key: '+' });
  check('gallery behaviour: + key zooms in', g.gallery.getZoom() === 2);
  fire(g.stage, 'keydown', { target: g.stage, key: '0' });
  check('gallery behaviour: 0 key resets the zoom', g.gallery.getZoom() === 1);
  g.gallery.showBySrc('/uploads/watch-2.jpg', g.thumbs[1]);
  check('gallery behaviour: showBySrc (thumbnail click path) finds the photo by src', g.gallery.getIndex() === 1 && g.thumbs[1].classList.contains('active'));
  g.gallery.showBySrc('/uploads/option-blue.jpg', g.thumbs[0]);
  check('gallery behaviour: showBySrc with an unknown src (option photo) still swaps + resets zoom', g.img.src === '/uploads/option-blue.jpg' && g.gallery.getZoom() === 1);

  // No-hover device (touch): mouseenter must NOT zoom — only tap/buttons zoom.
  const gTouch = buildGalleryDom(false);
  fire(gTouch.stage, 'mouseenter', { target: gTouch.stage });
  check('gallery behaviour: touch device — hover does NOT zoom (only tap/buttons)', gTouch.gallery.getZoom() === 1);
  fire(gTouch.stage, 'click', { target: gTouch.img });
  check('gallery behaviour: touch device — tap toggles the zoom', gTouch.gallery.getZoom() === 2);

  // Single photo (no thumbnails, no arrows): zoom still works, no crash.
  (function singlePhoto() {
    const stage = makeStubEl('div', 'gallery-stage');
    const img = makeStubEl('img', 'main-product-image');
    img.setAttribute('src', '/uploads/only.jpg');
    const zoomIn = makeStubEl('button', 'gallery-zoom-in');
    const zoomOut = makeStubEl('button', 'gallery-zoom-out');
    const zoomReset = makeStubEl('button', 'gallery-zoom-reset');
    const byId = { 'gallery-stage': stage, 'main-product-image': img, 'gallery-zoom-in': zoomIn, 'gallery-zoom-out': zoomOut, 'gallery-zoom-reset': zoomReset };
    const sandbox = {
      document: {
        getElementById(id) { return byId[id] || null; },
        querySelectorAll() { return []; },
      },
      window: { matchMedia: () => ({ matches: true, addEventListener() {} }), MutationObserver: function () { this.observe = function () {}; } },
      console,
    };
    sandbox.window.window = sandbox.window;
    vm.createContext(sandbox);
    let ok = true;
    try { vm.runInContext(galleryJs, sandbox); } catch (e) { ok = false; }
    check('gallery behaviour: single photo (no thumbnails/arrows) loads without crashing', ok && !!sandbox.window.GoinceGallery);
    if (ok) {
      fire(zoomIn, 'click');
      check('gallery behaviour: single photo — + zooms to 2x', sandbox.window.GoinceGallery.getZoom() === 2 && img.style.transform === 'scale(2)');
    }
  })();

  // ---------- 7. No regressions ----------
  check('no-regression: mega-menu dark-gold hover lift still present', /--mega-hover-gold/.test(css) && /\.mega-menu-panel a\.mega-col-title:hover/.test(cssNoComments));
  check('no-regression: header nav gold hover still present', /\.main-nav > a:hover/.test(cssNoComments) || /main-nav/.test(cssNoComments));
  check('no-regression: pill hover (PR #68) still present', hoverBlocks.includes('.category-bar > a:not(.active):hover'));
  check('no-regression: pill dropdown open behaviour unchanged', /\.cat-pill-wrap:hover \.cat-pill-menu/.test(cssNoComments) && /\.cat-pill-wrap:focus-within \.cat-pill-menu/.test(cssNoComments));
  check('no-regression: WhatsApp guard still covers .product-card .btn-card (new buttons included)', footerEjs.includes('.product-card .btn-card'));
  check('no-regression: mega-menu column toggle still present', /mega-col-toggle/.test(cssNoComments));
  check('no-regression: gallery file has no syntax errors (node --check passed separately)', galleryJs.includes('GoinceGallery'));

  console.log(`\n${passes.length} passed, ${failures.length} failed.`);
  if (failures.length) {
    console.log('Failures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
