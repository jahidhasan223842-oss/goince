// Card hover transition (fix/card-hover-transition).
//
// donal said (2026-11-27, after PR #71 went live, with a screenshot
// of the Mini Bag Sealer card in its hovered state — the warm foot
// background IS visible in his screenshot, that part works):
// "কই color change হয় না তো। আর add card-এ নিয়ে গেলে hover হয় but
// এটা transition হয় না।" — the hover happens but there is NO smooth
// transition; the colour changes snap in instantly instead of
// animating.
//
// Root cause, established in code (public/css/style.css):
//   * .btn-card (the "Add to Cart" / "Choose Option" button) had NO
//     transition at all — its :hover rule flips background navy ->
//     dark gold instantly, in AND out. That is the exact thing donal
//     reported, and the whole bug.
//   * Everything else already had a transition, but at mixed
//     durations/eases: .product-card .22s ease, .product-card-foot
//     .22s ease, .product-card img .25s ease, pill-dropdown children
//     .18s ease, drawer sub links .18s ease — so the card's lift /
//     ring / warm foot / zoom did animate, just not in one language.
//   * One honest limit: the pill-dropdown child (and drawer sub
//     link) hover colour is a GRADIENT (background:
//     var(--gold-gradient)) — a background-image, and CSS cannot
//     transition a background-image, so the gradient itself appears
//     instantly while the lift/shadow fade. No pseudo-element
//     crossfade was added here — this PR is transitions only; the
//     lift is the visible motion.
//
// What was fixed (CSS only, style.css — no colour/size/layout
// change, no markup change):
//   * .btn-card base rule: transition background-color / color /
//     border-color / transform / box-shadow .25s ease — declared on
//     the BASE rule, never only on :hover (a transition declared
//     only on :hover animates in but snaps out).
//   * .product-card base rule: transform .25s spring
//     (cubic-bezier(.22, 1.25, .36, 1) — the site's premium spring
//     ease) + box-shadow .25s ease, so the -10px lift slides and
//     the 2px dark-gold ring (part of box-shadow) fades in and out.
//   * .product-card-foot base rule: background-color .22s -> .25s
//     ease, so the blue foot background fades in and out.
//   * Foot background colour (folded in from donal's follow-ups on
//     the same screenshot): first "এখানে অন্য color দাও সোনালি বাদে"
//     (not gold), then corrected to "নীল color বাদে দাও" (not blue
//     either) — so --card-foot-hover is now a soft MINT GREEN,
//     neither gold nor blue: light #e3f2e6, dark #1c2b22 (deep green
//     tint). The 2px gold ring/border stays gold; the pills band
//     stays blue (unchanged).
//   * .product-card img: already transform .25s ease — unchanged.
//   * .category-bar .cat-pill-menu a base rule: transform .25s
//     spring + background-color / color / box-shadow .25s ease
//     (was .18s ease throughout).
//   * .shop-drawer-sub a / .shop-drawer-sub-sub a: background-color
//     / color .18s -> .25s ease (same family, mobile drawer).
//   * prefers-reduced-motion already lists every one of these
//     selectors with transition: none — no motion at all there,
//     colour change instant, which is the correct behaviour.
//
// No live MySQL needed: CSS source checks only.
//
// Run:  node scripts/test-card-hover-transition.js
// Exit code 0 = all checks passed.
'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');

const failures = [];
const passes = [];
function check(name, ok, detail) {
  if (ok) { passes.push(name); console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// Same helpers as test-pills-band-ripple-card.js: top-level CSS
// (comments + all @media ranges stripped), and per-query blocks.
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

const SPRING = 'cubic-bezier\\(\\.22, 1\\.25, \\.36, 1\\)';

console.log('Card hover transition (fix/card-hover-transition) checks:');

// ---------- 1. Base rules carry the transitions (never :hover only) ----------
const btnCard = ruleBody(cssTopLevel, /(^|\n)\.btn-card \{[^}]*\}/);
check('btn: base .btn-card rule exists (the rule that had NO transition)', !!btnCard);
check('btn: base rule transitions background-color .25s ease', !!btnCard && /transition:[^;]*background-color \.25s ease/.test(btnCard));
check('btn: base rule transitions color .25s ease', !!btnCard && /transition:[^;]*color \.25s ease/.test(btnCard));
check('btn: base rule transitions border-color .25s ease', !!btnCard && /transition:[^;]*border-color \.25s ease/.test(btnCard));
check('btn: base rule transitions transform .25s ease', !!btnCard && /transition:[^;]*transform \.25s ease/.test(btnCard));
check('btn: base rule transitions box-shadow .25s ease', !!btnCard && /transition:[^;]*box-shadow \.25s ease/.test(btnCard));
check('btn: base rule still navy background + white text (colours unchanged)', !!btnCard && /background:\s*var\(--navy\)/.test(btnCard) && /color:\s*#fff/.test(btnCard));

const card = ruleBody(cssTopLevel, /(^|\n)\.product-card \{[^}]*\}/);
check('card: base .product-card rule exists', !!card);
check('card: base rule transitions transform .25s with the spring ease', !!card && new RegExp(`transition:[^;]*transform \\.25s ${SPRING}`).test(card));
check('card: base rule transitions box-shadow .25s ease (the gold ring fades)', !!card && /transition:[^;]*box-shadow \.25s ease/.test(card));
check('card: old .22s duration is gone from the base rule', !!card && !/\.22s/.test(card));

const foot = ruleBody(cssTopLevel, /(^|\n)\.product-card-foot \{[^}]*\}/);
check('foot: base .product-card-foot rule exists', !!foot);
check('foot: base rule transitions background-color .25s ease (mint fades in/out)', !!foot && /transition:[^;]*background-color \.25s ease/.test(foot));
check('foot: old .22s duration is gone from the base rule', !!foot && !/\.22s/.test(foot));

const img = ruleBody(cssTopLevel, /(^|\n)\.product-card img \{[^}]*\}/);
check('img: base .product-card img rule exists', !!img);
check('img: photo zoom still transitions transform .25s ease (unchanged)', !!img && /transition:[^;]*transform \.25s ease/.test(img));

const childLink = ruleBody(cssTopLevel, /(^|\n)\.category-bar \.cat-pill-menu a \{[^}]*\}/);
check('child: base pill-dropdown child link rule exists', !!childLink);
check('child: base rule transitions transform .25s with the spring ease', !!childLink && new RegExp(`transition:[^;]*transform \\.25s ${SPRING}`).test(childLink));
check('child: base rule transitions background-color / color / box-shadow .25s ease', !!childLink && /transition:[^;]*background-color \.25s ease/.test(childLink) && /transition:[^;]*color \.25s ease/.test(childLink) && /transition:[^;]*box-shadow \.25s ease/.test(childLink));
check('child: old .18s duration is gone from the base rule', !!childLink && !/\.18s/.test(childLink));

const drawerLink = ruleBody(mobileBlocks, /\.shop-drawer-sub a, \.shop-drawer-sub-sub a \{[^}]*\}/);
check('drawer: drawer sub/sub-sub link rule exists (mobile block)', !!drawerLink);
check('drawer: drawer links transition background-color / color .25s ease', !!drawerLink && /transition:[^;]*background-color \.25s ease/.test(drawerLink) && /transition:[^;]*color \.25s ease/.test(drawerLink));
check('drawer: old .18s duration is gone from the drawer rule', !!drawerLink && !/\.18s/.test(drawerLink));

// ---------- 2. No transition declared ONLY on a :hover rule ----------
// A transition on :hover alone would animate in but snap out on
// mouse-out — the transition must live on the base rule. The menu
// panel open/close rules (.cat-pill-wrap:hover .cat-pill-menu,
// .mega-menu-wrap:hover .mega-menu-panel) DO declare transitions and
// are out of scope here — they are not hover-colour rules.
const hoverRulesToCheck = [
  ['.btn-card:hover', ruleBody(cssTopLevel, /\.btn-card:hover \{[^}]*\}/)],
  ['.product-card:hover', hoverBlocks.match(/\.product-card:hover \{[^}]*\}/) && hoverBlocks.match(/\.product-card:hover \{[^}]*\}/)[0]],
  ['.product-card:hover img', hoverBlocks.match(/\.product-card:hover img \{[^}]*\}/) && hoverBlocks.match(/\.product-card:hover img \{[^}]*\}/)[0]],
  ['.product-card:hover .product-card-foot', hoverBlocks.match(/\.product-card:hover \.product-card-foot \{[^}]*\}/) && hoverBlocks.match(/\.product-card:hover \.product-card-foot \{[^}]*\}/)[0]],
  ['.category-bar .cat-pill-menu a:hover', hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover \{[^}]*\}/) && hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover \{[^}]*\}/)[0]],
  ['.shop-drawer-sub a:hover', mobileBlocks.match(/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover \{[^}]*\}/) && mobileBlocks.match(/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover \{[^}]*\}/)[0]],
];
for (const [label, body] of hoverRulesToCheck) {
  check(`no-hover-only: ${label} exists and declares NO transition of its own`, !!body && !/transition:/.test(body));
}

// ---------- 3. Durations are ~.25s, lift uses the spring ease ----------
check('timing: .product-card transform uses the spring ease (not plain ease)', !!card && new RegExp(`transform \\.25s ${SPRING}`).test(card));
check('timing: pill child lift uses the spring ease (not plain ease)', !!childLink && new RegExp(`transform \\.25s ${SPRING}`).test(childLink));
check('timing: no .22s or .18s duration remains on any of the six base rules', [btnCard, card, foot, img, childLink, drawerLink].every((b) => !!b && !/\.22s|\.18s/.test(b)));

// ---------- 4. prefers-reduced-motion disables all of these transitions ----------
const rmCard = reducedMotionBlocks.match(/\.product-card, \.product-card img, \.product-card \.btn-card, \.product-card-foot,[\s\S]*?transition:\s*none;/);
check('reduced-motion: card / img / btn-card / foot get transition: none', !!rmCard);
check('reduced-motion: pill-dropdown child links get transition: none', /\.category-bar \.cat-pill-menu a,[\s\S]*?transition:\s*none;/.test(reducedMotionBlocks));
check('reduced-motion: drawer sub/sub-sub links get transition: none', /\.shop-drawer-sub a, \.shop-drawer-sub-sub a,[\s\S]*?transition:\s*none;/.test(reducedMotionBlocks));
check('reduced-motion: card lift + zoom are also switched off (transform: none on hover)', /\.product-card:hover, \.product-card:focus-within \{[^}]*transform:\s*none/.test(reducedMotionBlocks) && /\.product-card:hover img \{[^}]*transform:\s*none/.test(reducedMotionBlocks));

// ---------- 5. Hover END states are unchanged ----------
// UPDATED (fix/mini-cart-drawer-hover): the button hover is no
// longer dark gold — it is the success green var(--success) #1f7a30
// (the .btn-call pair) + a -2px lift on the button itself. Card
// hover (ring + lift + mint foot) is unchanged.
const btnHover = ruleBody(cssTopLevel, /\.btn-card:hover \{[^}]*\}/);
check('end-state: button turns SUCCESS GREEN + white text on its OWN :hover, and lifts -2px', !!btnHover && /background:\s*var\(--success\)/.test(btnHover) && /color:\s*#fff/.test(btnHover) && /transform:\s*translateY\(-2px\)/.test(btnHover));
check('end-state: NO rule golds the button on CARD hover (PR #71 behaviour kept)', !/\.product-card:hover \.btn-card/.test(cssNoComments) && !/\.product-card:focus-within \.btn-card/.test(cssNoComments));
const cardHover = hoverBlocks.match(/\.product-card:hover \{[^}]*\}/);
check('end-state: card hover still lifts -10px with the 2px gold ring + deep shadow', !!cardHover && /transform:\s*translateY\(-10px\)/.test(cardHover[0]) && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\), 0 18px 36px/.test(cardHover[0]));
const imgHover = hoverBlocks.match(/\.product-card:hover img \{[^}]*\}/);
check('end-state: photo still zooms 1.08x on card hover', !!imgHover && /transform:\s*scale\(1\.08\)/.test(imgHover[0]));
const footHover = hoverBlocks.match(/\.product-card:hover \.product-card-foot \{[^}]*\}/);
check('end-state: foot still gets the var background on card hover', !!footHover && /background:\s*var\(--card-foot-hover\)/.test(footHover[0]));
// Foot background is MINT GREEN now — neither the PR #71
// champagne/gold tint nor blue (donal: first "সোনালি বাদে", then
// "নীল color বাদে দাও"). The gold ring stays.
const rootVars = ruleBody(cssTopLevel, /:root\s*\{[^}]*--card-foot-hover:[^}]*\}/);
check('foot-colour: light-mode foot is soft mint green #e3f2e6 (not champagne #fdf3d8, not blue)', !!rootVars && /--card-foot-hover:\s*#e3f2e6/.test(rootVars) && !/--card-foot-hover:\s*#fdf3d8/.test(rootVars) && !/--card-foot-hover:\s*#dfeaf6/.test(rootVars));
check('foot-colour: light foot is distinct from the blue pills band #e7f0f8 (mint, not blue)', !!rootVars && /--pills-band:\s*#e7f0f8/.test(rootVars) && /--card-foot-hover:\s*#e3f2e6/.test(rootVars));
const darkVars = ruleBody(cssTopLevel, /\[data-theme="dark"\]\s*\{[^}]*\}/);
check('foot-colour: dark-mode foot is a deep green tint #1c2b22 (not warm #2a2118, not blue #1e2c47)', !!darkVars && /--card-foot-hover:\s*#1c2b22/.test(darkVars) && !/--card-foot-hover:\s*#2a2118/.test(darkVars) && !/--card-foot-hover:\s*#1e2c47/.test(darkVars));
check('foot-colour: dark foot is distinct from the blue pills band dark #1e2c47', !!darkVars && /--pills-band:\s*#1e2c47/.test(darkVars) && /--card-foot-hover:\s*#1c2b22/.test(darkVars));
check('foot-colour: no champagne/warm or blue foot value remains anywhere in the CSS', !/--card-foot-hover:\s*#fdf3d8|--card-foot-hover:\s*#2a2118|--card-foot-hover:\s*#dfeaf6|--card-foot-hover:\s*#1e2c47/.test(cssNoComments));
check('foot-colour: the 2px gold ring/border is untouched (still var(--mega-hover-gold))', !!cardHover && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\)/.test(cardHover[0]));
check('end-state: card hover rules still live inside @media (hover: hover)', !!cardHover && !!imgHover && !!footHover);
const cardFocus = ruleBody(cssTopLevel, /\.product-card:focus-within \{[^}]*\}/);
check('end-state: :focus-within still matches hover (lift + ring)', !!cardFocus && /transform:\s*translateY\(-10px\)/.test(cardFocus) && /box-shadow:\s*0 0 0 2px var\(--mega-hover-gold\)/.test(cardFocus));
const childHover = hoverBlocks.match(/\.category-bar \.cat-pill-menu a:hover \{[^}]*\}/);
check('end-state: pill child hover still dark-gold gradient + white text + -6px lift + scale(1.02)', !!childHover && /background:\s*var\(--gold-gradient\)/.test(childHover[0]) && /color:\s*#fff/.test(childHover[0]) && /transform:\s*translateY\(-6px\) scale\(1\.02\)/.test(childHover[0]));
// Honest note (not a failure): the gradient background itself is a
// background-image, which CSS cannot transition — it appears
// instantly while the lift/shadow fade. The end state is identical.
check('end-state: pill child gradient var is unchanged (#966e00 -> #ab8a00, not bright #f0a500)', /--gold-gradient:\s*linear-gradient\(135deg, #966e00, #ab8a00\)/.test(cssNoComments));
const drawerHover = mobileBlocks.match(/\.shop-drawer-sub a:hover, \.shop-drawer-sub-sub a:hover \{[^}]*\}/);
check('end-state: drawer child hover still dark-gold gradient + white text', !!drawerHover && /background:\s*var\(--gold-gradient\)/.test(drawerHover[0]) && /color:\s*#fff/.test(drawerHover[0]));

console.log(`\n${passes.length} passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('Failed checks:');
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
