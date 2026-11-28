// Discovery & search (feat/discovery-search, PR #85) — pure helpers for
// the shop listing. No DB, no Express here, so the test suite can call
// these directly.
//
//   C1  Faceted filters (brand / rating / in-stock / discount /
//       category) — the SQL lives in routes/shop.js; the shop-page
//       URL builder here keeps filter + search + sort + page in one
//       linkable query string, so a filtered page 2 is a real URL.
//   C2  Typo-tolerant search — Damerau-Levenshtein (optimal string
//       alignment) over product name / tags / brand words, in code:
//       at this catalogue size (5 products) no external search
//       service is warranted. A transposed pair ("sweing" vs
//       "sewing") costs 1, not 2 — plain Levenshtein would need two
//       substitutions for a simple slip of the fingers. Exact search
//       still runs first and is untouched when it matches; fuzzy
//       only kicks in when exact returns fewer than
//       EXACT_RESULTS_TO_TRUST results.
//   C4  Server-side pagination, page size 12, linkable via ?page=.
'use strict';

const PAGE_SIZE = 12;
// Exact search is trusted on its own at this many hits; below it the
// fuzzy fallback also runs and its extra matches are appended after
// the exact ones (never ahead of them, never instead of them).
const EXACT_RESULTS_TO_TRUST = 3;
// Only these keys survive into a shop listing URL — anything else a
// caller passes (page is handled separately, _csrf never) is dropped.
const SHOP_QUERY_KEYS = ['category', 'search', 'sort', 'audience', 'min_price', 'max_price', 'brand', 'rating', 'in_stock', 'discount'];
// Facet keys only — the "Clear filters" link drops these but keeps the
// category / search / sort context the shopper is inside.
const FACET_KEYS = ['min_price', 'max_price', 'brand', 'rating', 'in_stock', 'discount'];

function normalizeTerm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function wordsOf(s) {
  const n = normalizeTerm(s);
  return n ? n.split(' ') : [];
}

// Damerau-Levenshtein, optimal-string-alignment variant: insertion,
// deletion, substitution and one adjacent transposition each cost 1.
// Small strings, small catalogue — the O(n*m) table is trivial here.
function damerauLevenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; }
  for (let j = 0; j <= n; j++) { d[0][j] = j; }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        best = Math.min(best, d[i - 2][j - 2] + 1);
      }
      d[i][j] = best;
    }
  }
  return d[m][n];
}

// How far a typed word may sit from a catalogue word and still count
// as the same word: 1 for short words, 2 for longer ones (never more
// — at this catalogue size a looser bound starts matching unrelated
// products, e.g. "dress" for "press").
function fuzzyLimit(word) {
  const len = String(word || '').length;
  if (len <= 3) return 1;
  return 2;
}

// Best (smallest) distance between a typed word and any word of a
// product's searchable text. 0 = exact; 1 = a word the typed word is
// a prefix of (or vice versa — "sew" for "sewing", "sewingg" for
// "sewing"); otherwise the Damerau distance. Infinity = no word close
// enough to compare (empty haystack). Two guards keep close matches
// honest: the candidate must share the typed word's first letter
// (otherwise "press" would "correct" to "dress"), and a prefix only
// counts when the shorter side is at least 3 letters (otherwise a
// one-letter catalogue word such as the "z" in "A.T.Z" would match
// any word starting with that letter).
function bestWordDistance(termWord, hayWords) {
  const tw = String(termWord || '');
  if (!tw) return Infinity;
  let best = Infinity;
  for (const hw of hayWords || []) {
    if (!hw || hw[0] !== tw[0]) continue;
    if (hw === tw) return 0;
    if ((hw.startsWith(tw) || tw.startsWith(hw)) && Math.min(hw.length, tw.length) >= 3) { best = Math.min(best, 1); continue; }
    const d = damerauLevenshtein(tw, hw);
    if (d < best) best = d;
  }
  return best;
}

// Fuzzy search over the catalogue: products are { id, name, tags,
// brand }. Every typed word must match some word of the product
// (AND semantics — "sweing machine" must not return a watch), within
// fuzzyLimit per word. Returns [{ id, score }] ordered best first
// (lowest total distance); ties fall back to id order so the result
// is deterministic.
function fuzzySearchProducts(term, products) {
  const termWords = wordsOf(term);
  if (!termWords.length) return [];
  const scored = [];
  for (const p of products || []) {
    const hayWords = [...wordsOf(p.name), ...wordsOf(p.tags), ...wordsOf(p.brand)];
    if (!hayWords.length) continue;
    let total = 0;
    let ok = true;
    for (const tw of termWords) {
      const best = bestWordDistance(tw, hayWords);
      if (!Number.isFinite(best) || best > fuzzyLimit(tw)) { ok = false; break; }
      total += best;
    }
    if (ok) scored.push({ id: p.id, score: total });
  }
  scored.sort((a, b) => (a.score - b.score) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return scored;
}

// "Did you mean" correction for a typed query: each mistyped word is
// replaced by the closest word in the catalogue vocabulary (name /
// tags / brand words, length 3+). Words already in the vocabulary
// stay untouched; words under 3 letters are never "corrected" (too
// easy to misfire on "at", "tv", ...). Returns the corrected query
// string, or null when nothing needs correcting / nothing is close
// enough. The caller shows it as a link that re-runs that search.
function didYouMean(term, products) {
  const termWords = wordsOf(term);
  if (!termWords.length) return null;
  const vocab = new Map(); // word -> how many products use it (tie-break)
  for (const p of products || []) {
    for (const w of [...wordsOf(p.name), ...wordsOf(p.tags), ...wordsOf(p.brand)]) {
      if (w.length < 3) continue;
      vocab.set(w, (vocab.get(w) || 0) + 1);
    }
  }
  if (vocab.size === 0) return null;
  let changed = false;
  const corrected = termWords.map((tw) => {
    if (tw.length < 3 || vocab.has(tw)) return tw;
    let bestWord = null;
    let bestDist = Infinity;
    for (const [w, count] of vocab) {
      // Same first-letter guard as bestWordDistance (see above):
      // "press" must never "correct" to "dress".
      if (w[0] !== tw[0]) continue;
      if (Math.abs(w.length - tw.length) > 2) continue;
      const d = damerauLevenshtein(tw, w);
      if (d < bestDist || (d === bestDist && bestWord !== null && count > (vocab.get(bestWord) || 0))) {
        bestDist = d;
        bestWord = w;
      }
    }
    if (bestWord !== null && bestDist <= fuzzyLimit(tw)) { changed = true; return bestWord; }
    return tw;
  });
  if (!changed) return null;
  const out = corrected.join(' ');
  return out === normalizeTerm(term) ? null : out;
}

// ?page= parsing: page 1 unless a positive integer is given.
function parsePage(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function clampPage(page, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  return Math.min(Math.max(1, parsePage(page)), total);
}

function totalPagesFor(total, pageSize) {
  return Math.max(1, Math.ceil(Math.max(0, Number(total) || 0) / (pageSize || PAGE_SIZE)));
}

// Linkable shop-listing URL: allow-listed query keys only, ?page=
// included only past page 1 (page 1 is the bare listing URL).
// `dropKeys` removes keys first (used for "Clear filters").
function shopPageUrl(query, page, dropKeys) {
  const drop = new Set(dropKeys || []);
  const params = new URLSearchParams();
  if (page && parsePage(page) > 1) params.set('page', String(parsePage(page)));
  for (const k of SHOP_QUERY_KEYS) {
    if (drop.has(k)) continue;
    const v = query ? query[k] : undefined;
    if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? '/?' + qs : '/';
}

module.exports = {
  PAGE_SIZE,
  EXACT_RESULTS_TO_TRUST,
  SHOP_QUERY_KEYS,
  FACET_KEYS,
  normalizeTerm,
  wordsOf,
  damerauLevenshtein,
  fuzzyLimit,
  bestWordDistance,
  fuzzySearchProducts,
  didYouMean,
  parsePage,
  clampPage,
  totalPagesFor,
  shopPageUrl
};
