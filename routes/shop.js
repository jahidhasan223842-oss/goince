// Customer side er shob route: Home, Product Details, Reviews, Cart, Coupon, Checkout
const express = require('express');
const router = express.Router();
const ejs = require('ejs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const upload = require('../config/upload');
const pp = require('../lib/product-page');
const { marked } = require('marked');
const { sendOrderConfirmation } = require('../config/email');
const { notifyAdmins } = require('../config/push');
const { buildCategoryTree, ancestorChain, visibleSubtreeIds, isEffectivelyVisible } = require('../lib/categories');

// ---------- PRODUCT-PAGE BATCH (feat/product-page, PR #83) ----------
// Session key for G1 live viewers + D3 guest helpful votes: the
// express-session id when there is one, else a random key kept in the
// session itself. Never a name, phone or anything identifying.
function viewerSessionKey(req) {
  if (req.sessionID) return String(req.sessionID);
  if (req.session) {
    if (!req.session.viewKey) {
      req.session.viewKey = crypto.randomUUID
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    }
    return String(req.session.viewKey);
  }
  return 'anonymous';
}

// Settings table theke delivery charge load kora — admin panel theke change korle
// ei function shathe shathe notun value niye ashbe (server restart lagbe na)
async function getDeliveryCharges() {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('delivery_charge_inside', 'delivery_charge_outside')"
  );
  const get = (key, fallback) => {
    const found = rows.find(r => r.setting_key === key);
    return found ? parseFloat(found.setting_value) : fallback;
  };
  return {
    inside_dhaka: get('delivery_charge_inside', 60),
    outside_dhaka: get('delivery_charge_outside', 120)
  };
}

// Admin-er "Payment Methods" page theke active (bKash/Nagad/Rocket/etc) gulo load kora
async function getPaymentMethods() {
  const [rows] = await db.query(
    'SELECT method_name, number, payment_type, instructions FROM payment_methods WHERE is_active = 1 ORDER BY sort_order, id'
  );
  return rows;
}

// Delivery zone (Inside Dhaka / Outside Dhaka / nijer jog kora zone) —
// Admin > Delivery Zones theke add/edit kora jay; table khali thakle purono
// inside/outside charge diye fallback
async function getDeliveryZones() {
  try {
    const [rows] = await db.query('SELECT * FROM delivery_zones WHERE is_active = 1 ORDER BY sort_order, id');
    if (rows.length) return rows.map(r => ({ id: r.id, name: r.name, slug: r.slug, charge: parseFloat(r.charge), delivery_time: r.delivery_time || '' }));
  } catch (e) {}
  const c = await getDeliveryCharges();
  return [
    { id: 0, name: 'Inside Dhaka', slug: 'inside_dhaka', charge: c.inside_dhaka, delivery_time: '1–2 days' },
    { id: 0, name: 'Outside Dhaka', slug: 'outside_dhaka', charge: c.outside_dhaka, delivery_time: '3–5 days' }
  ];
}

// Payment gateway config (Admin > Settings): gateway chalale manual method
// off kora jay, na chalale gateway website-e dekhabei na
async function getGatewayConfig() {
  const [rows] = await db.query(
    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('payment_mode', 'gateway_provider', 'gateway_enabled', 'gateway_store_id', 'gateway_mode')"
  );
  const get = (k, fb) => { const r = rows.find(x => x.setting_key === k); return r ? r.setting_value : fb; };
  const provider = get('gateway_provider', 'none');
  const enabled = get('gateway_enabled', '0') === '1' && provider !== 'none';
  const storeId = get('gateway_store_id', '');
  return {
    mode: get('payment_mode', 'manual'),
    provider,
    enabled,
    // Gateway sotti cholbe sudhu jodi enable kora + store ID deya thake
    configured: enabled && storeId.length > 0,
    mode_label: get('gateway_mode', 'sandbox')
  };
}
const GATEWAY_LABELS = { sslcommerz: 'SSLCommerz', shurjopay: 'ShurjoPay', bkash: 'bKash PGW' };

// Card hover-e 2nd chobi (feat/animations-delight, A5): prottek
// product-er product_images table-er PROTHOM chobi (main image-er
// porer chobi) — ekta query-tei map banano hoy (id -> filename).
// Jader gallery chobi nei, tader map-e kichu thake na — card tokhon
// ektai chobi dekhay, kono bodol hoy na. productIds dile shudhu
// oi product gulor chobi ase (product page-er Related), na dile
// shob product-er (homepage).
async function firstGalleryImages(productIds) {
  try {
    let rows;
    if (productIds && productIds.length) {
      [rows] = await db.query(
        `SELECT product_id, image FROM product_images WHERE product_id IN (${productIds.map(() => '?').join(',')}) ORDER BY id ASC`,
        productIds
      );
    } else {
      [rows] = await db.query('SELECT product_id, image FROM product_images ORDER BY id ASC');
    }
    const map = {};
    for (const r of rows) { if (!(r.product_id in map)) map[r.product_id] = r.image; }
    return map;
  } catch (e) { return {}; }
}

// Bangladeshi mobile number: 01XXXXXXXXX ba +8801XXXXXXXXX — 013-019 diye shuru hote hobe
// (shared lib/bd-phone.js — shop checkout ar admin profile ek-i niyom-e jachai kore)
const { normalizeBdPhone, isValidBdPhone } = require('../lib/bd-phone');

// Only Published products that are not scheduled for the future are visible
// to customers (Draft products stay hidden)
const VISIBLE_PRODUCT_SQL = "(products.status IS NULL OR products.status = 'published') AND (products.scheduled_at IS NULL OR products.scheduled_at <= NOW())";

// ---------- HOMEPAGE ----------
router.get('/', async (req, res) => {
  try {
    const categoryId = req.query.category || '';
    const search = req.query.search || '';
    const sort = req.query.sort || 'newest';
    const requestedAudience = String(req.query.audience || '').toLowerCase();
    const allowedAudiences = ['men', 'women', 'kids', 'unisex'];

    // Per-category product count soho neya — khali category (nijer +
    // descendant mile 0 product) pill/sub-bar-e dekhabe na. Count-ta
    // header mega menu-r (server.js middleware) query-r motoi: shob
    // product dhora hoy, status nirbisheshe.
    const [categories] = await db.query(`SELECT categories.*, COUNT(products.id) AS product_count
         FROM categories
         LEFT JOIN products ON products.category_id = categories.id
         GROUP BY categories.id
         ORDER BY categories.is_featured DESC, categories.sort_order ASC, categories.id ASC`);
    // Website-e shudhu visible category dekhabe: ekta category tokhon-i
    // dekhabe jokhon se nije ar tar shob ancestor visible (lib/categories.js
    // dekhun — hide korle puro subtree navigation theke lukay). Featured
    // age, tarpor sort order.
    const { byId } = buildCategoryTree(categories);
    const visibleCategories = categories.filter(c => isEffectivelyVisible(byId, c.id));
    const mainCategories = visibleCategories.filter(c => !c.parent_id);
    const seasonalRoot = mainCategories.find(c => String(c.name).trim().toLowerCase() === 'seasonal products');
    // Seasonal parent menu-te na dekhiye season-gulo direct dekhano.
    // Khali category pill-e dekhabe na: totalProductCount (nijer +
    // descendant) 0 hole bad — buildCategoryTree categories query-r
    // product_count theke ei total hisab kore.
    const hasProducts = (c) => (byId.get(c.id) ? byId.get(c.id).totalProductCount : 0) > 0;
    const displayCategories = mainCategories.flatMap(c => {
      if (seasonalRoot && c.id === seasonalRoot.id) {
        return visibleCategories
          .filter(sub => sub.parent_id == seasonalRoot.id)
          .filter(hasProducts)
          .map(sub => ({ ...sub, display_name: sub.name.replace(/ Collection$/i, ' Products') }));
      }
      return hasProducts(c) ? [c] : [];
    });

    // Selected category ta main category naki sub-category, ebong tar sub-category gulo ki ki eta ber kora
    let subCategories = [];
    let categoryIdsToFilter = [];
    let isSeasonalCategory = false;
    let selected = null;
    let breadcrumb = [];
    if (categoryId) {
      selected = categories.find(c => c.id == categoryId);
      if (selected) {
        breadcrumb = ancestorChain(byId, selected.id);
        if (seasonalRoot) {
          // Seasonal tree-r jekono level-e thakle audience filter cholbe
          isSeasonalCategory = breadcrumb.some(b => b.id == seasonalRoot.id);
        }
        // Jekono level-er category select korle tar shob sub-category
        // (joto govir-e hok) filter-e jog hobe, kintu lukano (hidden)
        // sub-category-r product parent-e dekhabe na — lukano shudhu bar
        // theke noy, listing thekeo bad jay. Khali sub-category-o
        // bar-e dekhabe na (total 0 hole bad).
        subCategories = categories.filter(c => c.parent_id == selected.id && c.is_visible !== 0 && hasProducts(c));
        categoryIdsToFilter = visibleSubtreeIds(byId, selected.id);
      }
    }

    const minPrice = parseFloat(req.query.min_price);
    const maxPrice = parseFloat(req.query.max_price);
    let sql = `SELECT products.*,
                 COUNT(reviews.id) AS review_count,
                 AVG(reviews.rating) AS avg_rating
               FROM products
               LEFT JOIN reviews ON reviews.product_id = products.id AND reviews.status = 'approved'
               WHERE 1=1 AND ${VISIBLE_PRODUCT_SQL}`;
    const params = [];
    const selectedAudience = isSeasonalCategory && allowedAudiences.includes(requestedAudience) ? requestedAudience : '';

    if (categoryIdsToFilter.length > 0) {
      sql += ` AND products.category_id IN (${categoryIdsToFilter.map(() => '?').join(',')})`;
      params.push(...categoryIdsToFilter);
    }
    if (selectedAudience) {
      const audienceMatches = ['men', 'women'].includes(selectedAudience)
        ? [selectedAudience, 'unisex', 'all']
        : [selectedAudience, 'all'];
      sql += ` AND products.target_audience IN (${audienceMatches.map(() => '?').join(', ')})`;
      params.push(...audienceMatches);
    }
    if (search) {
      sql += ' AND (products.name LIKE ? OR products.tags LIKE ? OR products.brand LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (!isNaN(minPrice)) { sql += ' AND products.price >= ?'; params.push(minPrice); }
    if (!isNaN(maxPrice)) { sql += ' AND products.price <= ?'; params.push(maxPrice); }

    sql += ' GROUP BY products.id';

    // Sort option অনুযায়ী ORDER BY বদলানো
    if (sort === 'price_low') {
      sql += ' ORDER BY products.price ASC';
    } else if (sort === 'price_high') {
      sql += ' ORDER BY products.price DESC';
    } else if (sort === 'popular') {
      sql += ' ORDER BY review_count DESC, products.created_at DESC';
    } else {
      sql += ' ORDER BY products.created_at DESC'; // newest (default)
    }

    const [products] = await db.query(sql, params);
    // Kon product-e variant/option ache — oigulote homepage theke direct
    // "Add to Cart" na diye "Choose option" dekhano hobe
    let variantProductIds = new Set(), optionProductIds = new Set();
    try {
      const [vrows] = await db.query('SELECT DISTINCT product_id FROM product_variants');
      const [orows] = await db.query('SELECT DISTINCT product_id FROM product_options');
      variantProductIds = new Set(vrows.map(r => r.product_id));
      optionProductIds = new Set(orows.map(r => r.product_id));
    } catch (e) {}

    // Recently Viewed: purono saved item-e (PR #69-er age save kora)
    // stock + hasOptions flag nei — tai server theke shob visible
    // product-er id -> { stock, hasOptions } map pathano hoy, jate
    // purono item-eo thik button (Add to Cart / Choose Option /
    // kichu na) dekhano jay. `products` filter kora thakte pare
    // (category/search), tai map-er jonno alada query.
    let recentlyViewedMap = {};
    try {
      const [allRows] = await db.query(`SELECT id, stock, free_shipping FROM products WHERE ${VISIBLE_PRODUCT_SQL}`);
      recentlyViewedMap = Object.fromEntries(allRows.map((r) => [r.id, { stock: r.stock, hasOptions: variantProductIds.has(r.id) || optionProductIds.has(r.id), freeDelivery: !!r.free_shipping }]));
    } catch (e) { recentlyViewedMap = {}; }

    // Best sellers: shobcheye beshi bikri hoya product (homepage hero-r niche)
    let bestSellers = [];
    if (!categoryId && !search) {
      try {
        const [rows] = await db.query(
          `SELECT products.*, COALESCE(SUM(order_items.quantity), 0) AS sold
           FROM products LEFT JOIN order_items ON order_items.product_id = products.id
           WHERE products.stock > 0 AND ${VISIBLE_PRODUCT_SQL}
           GROUP BY products.id ORDER BY sold DESC, products.created_at DESC LIMIT 4`);
        bestSellers = rows;
      } catch (e) { bestSellers = []; }
    }

    // Hero banner-er product: Admin > Settings theke jeta beche deya, na thakle Best Seller
    let heroProduct = (typeof bestSellers !== 'undefined' && bestSellers.length) ? bestSellers[0] : null;
    try {
      const [[heroRow]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'hero_product_id'");
      const heroId = heroRow ? parseInt(heroRow.setting_value, 10) : NaN;
      if (!isNaN(heroId)) {
        const [[hp]] = await db.query('SELECT * FROM products WHERE id = ?', [heroId]);
        if (hp) heroProduct = hp;
      }
    } catch (e) {}
    let banners = [];
    try {
      const [bannerRows] = await db.query("SELECT * FROM banners WHERE is_active = 1 ORDER BY sort_order ASC, id DESC");
      banners = bannerRows;
    } catch (e) { banners = []; }
    // Card hover-e 2nd chobi (feat/animations-delight, A5): main grid
    // + Best Sellers — ektai map, du jaygatei use hoy.
    const secondImages = await firstGalleryImages();
    // Card-er delivery badge (feat/cart-buying, B4): Free Delivery
    // na Delivery Charge — zone charge-gulo settings theke ase.
    const deliveryCharges = await getDeliveryCharges();
    res.render('index', {
      banners,
      secondImages,
      deliveryCharges,
      heroProduct,
      variantProductIds: [...variantProductIds],
      optionProductIds: [...optionProductIds],
      recentlyViewedMap,
      minPrice: isNaN(minPrice) ? '' : minPrice,
      maxPrice: isNaN(maxPrice) ? '' : maxPrice,
      bestSellers,
      pageTitle: search
        ? `Search: ${search} - Goince`
        : (selected ? (selected.meta_title || `${selected.name} - Goince`) : 'Goince - Online Shop | Cash on Delivery in Bangladesh'),
      metaDescription: search
        ? 'Goince - Bangladesh-er online shop. Cash on Delivery, Dhaka-r vitore 1-2 din, Dhaka-r baire 3-5 dine delivery.'
        : (selected ? (selected.meta_description || selected.description || 'Goince - Bangladesh-er online shop. Cash on Delivery, Dhaka-r vitore 1-2 din, Dhaka-r baire 3-5 dine delivery.') : 'Goince - Bangladesh-er online shop. Cash on Delivery, Dhaka-r vitore 1-2 din, Dhaka-r baire 3-5 dine delivery.'),
      products,
      categories,
      mainCategories,
      displayCategories,
      subCategories,
      selectedCategory: categoryId,
      selectedCategoryObj: selected,
      breadcrumb,
      isSeasonalCategory,
      selectedAudience,
      search,
      sort,
      siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong loading the homepage.');
  }
});

// ---------- PRODUCT DETAILS PAGE (with reviews) ----------
router.get('/product/:id', async (req, res) => {
  try {
    // /product/3 (id) and /product/binbond-watch (slug) both work
    const idOrSlug = req.params.id;
    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? OR slug = ?',
      [isNaN(parseInt(idOrSlug, 10)) ? 0 : parseInt(idOrSlug, 10), idOrSlug]
    );
    if (rows.length === 0) return res.status(404).send('Product not found');
    const product = rows[0];
    // Draft or not-yet-scheduled products are hidden from customers
    if ((product.status && product.status !== 'published') ||
        (product.scheduled_at && new Date(product.scheduled_at) > new Date())) {
      return res.status(404).send('Product not found');
    }

    const [reviews] = await db.query(
      `SELECT reviews.*, users.name AS user_name FROM reviews
       JOIN users ON reviews.user_id = users.id
       WHERE product_id = ? AND reviews.status = 'approved' ORDER BY reviews.created_at DESC`,
      [req.params.id]
    );
    const [[avgRow]] = await db.query(
      'SELECT AVG(rating) AS avgRating, COUNT(*) AS reviewCount FROM reviews WHERE product_id = ? AND status = \'approved\'',
      [req.params.id]
    );

    // Gallery images (main image chara extra chobi)
    const [galleryImages] = await db.query('SELECT * FROM product_images WHERE product_id = ?', [req.params.id]);

    // Options (Color/Size/Weight — apni nijei label ঠিক korte parben) — thakle
    // product page e selector dekhabo
    const [options] = await db.query('SELECT * FROM product_options WHERE product_id = ? ORDER BY sort_order, id', [req.params.id]);
    const optionLabel = options.length > 0 ? options[0].option_label : null;

    // Variants (Size/Color combination) — thakle product page e selector dekhabo
    const [variantRows] = await db.query('SELECT * FROM product_variants WHERE product_id = ?', [req.params.id]);
    let variants = [];
    if (variantRows.length > 0) {
      const [variantAttrs] = await db.query(
        `SELECT pva.variant_id, av.id AS value_id, av.value, a.id AS attribute_id, a.name AS attribute_name
         FROM product_variant_attributes pva
         JOIN attribute_values av ON pva.attribute_value_id = av.id
         JOIN attributes a ON av.attribute_id = a.id
         WHERE pva.variant_id IN (${variantRows.map(() => '?').join(',')})`,
        variantRows.map(v => v.id)
      );
      variants = variantRows.map(v => ({
        id: v.id,
        sku: v.sku,
        price: v.price !== null ? Number(v.price) : Number(product.price),
        compare_at_price: v.compare_at_price !== null && v.compare_at_price !== undefined ? Number(v.compare_at_price) : null,
        image: v.image || null,
        stock: v.stock,
        attrs: variantAttrs.filter(va => va.variant_id === v.id),
        label: variantAttrs.filter(va => va.variant_id === v.id).map(va => `${va.attribute_name}: ${va.value}`).join(', ')
      }));
    }
    // Product-e ki ki Attribute (jemon Size, Color) use hoyeche shegulo alada kore ber kora,
    // jate dropdown selector banano jay
    const attributeMap = {};
    variants.forEach(v => {
      v.attrs.forEach(a => {
        if (!attributeMap[a.attribute_id]) attributeMap[a.attribute_id] = { id: a.attribute_id, name: a.attribute_name, values: new Map() };
        attributeMap[a.attribute_id].values.set(a.value_id, a.value);
      });
    });
    const variantAttributes = Object.values(attributeMap).map(a => ({
      id: a.id, name: a.name,
      values: Array.from(a.values.entries()).map(([id, value]) => ({ id, value }))
    }));

    // Specifications text ke line-by-line "Key: Value" theke array e convert kora
    let specs = [];
    if (product.specifications) {
      specs = product.specifications.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          const idx = line.indexOf(':');
          return idx > -1
            ? { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() }
            : { key: line, value: '' };
        });
    }

    // Discount percent calculate kora (compare_at_price thakle)
    let discountPercent = null;
    if (product.compare_at_price && product.compare_at_price > product.price) {
      discountPercent = Math.round((1 - product.price / product.compare_at_price) * 100);
    }

    // Related products: Admin-er beche deya gulo age, tarpor eki category theke
    let related = [];
    let adminRelated = [];
    try {
      const [chosen] = await db.query(
        `SELECT p.* FROM related_products rp JOIN products p ON p.id = rp.related_id
         WHERE rp.product_id = ? AND ${VISIBLE_PRODUCT_SQL.replace(/products\./g, 'p.')}`,
        [product.id]
      );
      related = chosen;
      // D2 bundle box: SUDHU admin-er beche deya related product
      // (related_products table) — category theke auto-bhora gulo
      // bundle-e dhoke na, donal nije jader complement hisebe
      // bechechen tarai ase.
      adminRelated = chosen.slice();
    } catch (e) { related = []; }
    if (related.length < 4 && product.category_id) {
      const [relRows] = await db.query(
        'SELECT * FROM products WHERE category_id = ? AND id != ? LIMIT 4',
        [product.category_id, product.id]
      );
      const seen = new Set(related.map(r => r.id));
      related = related.concat(relRows.filter(r => !seen.has(r.id))).slice(0, 4);
    }

    const deliveryCharges = await getDeliveryCharges();

    // ---------- PRODUCT-PAGE BATCH (feat/product-page, PR #83) ----------
    // D1 — product video (Admin > Products > Edit-er video field,
    // product_videos table, PR #7): thakle gallery-te player ase,
    // na thakle kichui bodlay na. Video file ekhane upload kora
    // hoy na — donal-ke ashol phone-e tola video upload korte hobe.
    // (Admin upload multer-er public/uploads-e rakhe, tai /uploads/.)
    let productVideo = null;
    try {
      const [vrows] = await db.query(
        'SELECT filename FROM product_videos WHERE product_id = ? ORDER BY created_at DESC LIMIT 1',
        [product.id]
      );
      if (vrows.length) productVideo = vrows[0].filename;
    } catch (e) { productVideo = null; }

    // D2 — "Frequently bought together": admin-er beche deya
    // related (max 3), shudhu jegulo stock-e ache AR variant/option
    // nei — "Add all to cart"-e variant bechha lage, tai variant
    // product bundle-e dhoke na. Kono admin-related na thakle
    // bundle box-ta ekebarei dekhabe na (khali box noy).
    let bundleProducts = [];
    try {
      const inStock = adminRelated.filter((r) => r.stock > 0).slice(0, 3);
      if (inStock.length > 0) {
        const ids = inStock.map((r) => r.id);
        const inList = `(${ids.map(() => '?').join(',')})`;
        const [vrows] = await db.query(`SELECT DISTINCT product_id FROM product_variants WHERE product_id IN ${inList}`, ids);
        const [orows] = await db.query(`SELECT DISTINCT product_id FROM product_options WHERE product_id IN ${inList}`, ids);
        const withChoices = new Set([...vrows.map((r) => r.product_id), ...orows.map((r) => r.product_id)]);
        bundleProducts = inStock.filter((r) => !withChoices.has(r.id));
      }
    } catch (e) { bundleProducts = []; }

    // G5 — "X sold": ashol order count (order_items). 0 hole view-e
    // kichu dekhabe na — kokhono banano count noy.
    let soldCount = 0;
    try {
      const [[srow]] = await db.query(
        'SELECT COALESCE(SUM(quantity), 0) AS sold FROM order_items WHERE product_id = ?',
        [product.id]
      );
      soldCount = Number(srow.sold) || 0;
    } catch (e) { soldCount = 0; }
    const soldLine = pp.soldDisplay(soldCount);
    // D8 — honest low-stock bar: sold / (sold + remaining), ashol
    // number diye. Stock plentiful hole null (bar dekhabe na).
    const stockBar = pp.lowStockBar(soldCount, product.stock, product.low_stock_threshold);

    // D5 — size guide (FIX PR #84): variant attribute Size thakle
    // to botei, Size OPTION (product_options, option_label "Size")
    // thakleo dekhabe — A.T.Z (/product/7)-er S/M/L/XL option-e
    // ase, variant-e noy, tai age guide-ta lukiye thakto.
    const showSizeGuide = pp.hasSizeChoice(variantAttributes, options, optionLabel);

    // D3 — review photos + helpful votes + verified-buyer badge.
    // Photo: review_photos table; helpful: count + ei visitor
    // age vote diyechhe kina; verified: ei product-ta sotti
    // kinechhe kina (orders + order_items diye jachai — kokhono
    // dhore neoa hoy na).
    let reviewPhotos = {};
    let helpfulCounts = {};
    let votedReviewIds = [];
    let verifiedBuyerIds = [];
    if (reviews.length > 0) {
      const rids = reviews.map((r) => r.id);
      const inRids = `(${rids.map(() => '?').join(',')})`;
      try {
        const [prows] = await db.query(`SELECT review_id, filename FROM review_photos WHERE review_id IN ${inRids}`, rids);
        prows.forEach((p) => { (reviewPhotos[p.review_id] = reviewPhotos[p.review_id] || []).push(p.filename); });
      } catch (e) {}
      try {
        const [hrows] = await db.query(`SELECT review_id, COUNT(*) AS c FROM review_helpful_votes WHERE review_id IN ${inRids} GROUP BY review_id`, rids);
        hrows.forEach((h) => { helpfulCounts[h.review_id] = Number(h.c) || 0; });
      } catch (e) {}
      try {
        const sessionKey = viewerSessionKey(req);
        const [vrows] = await db.query(
          `SELECT review_id FROM review_helpful_votes WHERE review_id IN ${inRids} AND (user_id = ? OR session_key = ?)`,
          [...rids, req.session.userId || null, sessionKey]
        );
        votedReviewIds = vrows.map((v) => v.review_id);
      } catch (e) {}
      try {
        const uids = [...new Set(reviews.map((r) => r.user_id))];
        const [brows] = await db.query(
          `SELECT DISTINCT o.user_id FROM orders o JOIN order_items oi ON oi.order_id = o.id
           WHERE oi.product_id = ? AND o.user_id IN (${uids.map(() => '?').join(',')})`,
          [product.id, ...uids]
        );
        verifiedBuyerIds = brows.map((b) => b.user_id);
      } catch (e) {}
    }

    // D4 — Q&A: shudhu admin-er uttor deoa proshno-guloi public-e
    // dekhabe (status='answered'); uttor na deoa proshno admin-er
    // kachhe pending thake, shop-e othe na.
    let answeredQuestions = [];
    try {
      const [qrows] = await db.query(
        `SELECT asker_name, question, answer, answered_at FROM product_questions
         WHERE product_id = ? AND status = 'answered' AND answer IS NOT NULL
         ORDER BY answered_at DESC`,
        [product.id]
      );
      answeredQuestions = qrows;
    } catch (e) { answeredQuestions = []; }

    // D7 — delivery-date estimate: customer-er bechha zone
    // (?zone=inside_dhaka/outside_dhaka, session-e mone rakha),
    // na bechhle Dhaka (inside) default. Cut-off 5pm, window
    // 1–2 din (Dhaka) / 3–5 din (baire) — lib/product-page.js.
    const zoneParam = String(req.query.zone || '');
    if (zoneParam === 'inside_dhaka' || zoneParam === 'outside_dhaka') req.session.deliveryZone = zoneParam;
    const deliveryZone = req.session.deliveryZone === 'outside_dhaka' ? 'outside_dhaka' : 'inside_dhaka';
    const deliveryEstimate = pp.deliveryEstimate(deliveryZone, new Date());

    // G1 — REAL live viewers: ei page load-e session-ta record
    // kora hoy (product_views), tarpor goto 5 minute-e kotogulo
    // alada session ei product dekhchhe gona hoy. 10 minute-er
    // purono row muche fela hoy. Table na thakle / query fail
    // hole page kokhono vangbe na — viewer line shudhu dekhabe na.
    let viewerLine = null;
    try {
      const sessionKey = viewerSessionKey(req);
      await db.query(
        'INSERT INTO product_views (product_id, session_key, viewed_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE viewed_at = NOW()',
        [product.id, sessionKey]
      );
      await db.query('DELETE FROM product_views WHERE viewed_at < NOW() - INTERVAL 10 MINUTE');
      const [[vrow]] = await db.query(
        'SELECT COUNT(DISTINCT session_key) AS c FROM product_views WHERE product_id = ? AND viewed_at >= NOW() - INTERVAL 5 MINUTE',
        [product.id]
      );
      viewerLine = pp.viewerDisplay(Number(vrow.c) || 0);
    } catch (e) { viewerLine = null; }

    // G2 — recent-purchase popup: SUDHU ashol order theke (goto
    // 7 din, ei product-ta kena). Naam-er prothom ongsho +
    // delivery zone + ashol time-ago — kokhono banano order noy.
    // Kono recent order na thakle kichu dekhabe na.
    let recentPurchase = null;
    try {
      const [orows] = await db.query(
        `SELECT o.customer_name, o.delivery_zone, o.created_at, oi.product_name
         FROM orders o JOIN order_items oi ON oi.order_id = o.id
         WHERE oi.product_id = ? AND o.created_at >= NOW() - INTERVAL 7 DAY
           AND (o.status IS NULL OR o.status NOT IN ('Cancelled', 'cancelled'))
         ORDER BY o.created_at DESC LIMIT 1`,
        [product.id]
      );
      if (orows.length) recentPurchase = pp.recentPurchaseLine(orows[0], new Date());
    } catch (e) { recentPurchase = null; }

    // Related-er 2nd chobi (feat/animations-delight, A5): shudhu
    // Related product gulor prothom gallery chobi.
    const secondImages = await firstGalleryImages(related.map(r => r.id));

    // Long Description-e Admin jodi Markdown (#, ##, *, ** ityadi) use kore
    // thaken, eta ekhane real HTML-e convert kore dilam jate website-e
    // shothikvabe Heading/Bold/List hisebe dekhay, raw # * chinho na dekhiye
    const descriptionHtml = product.description ? marked.parse(product.description) : '';

    res.render('product', {
      notify: req.query.notify || null,
      pageTitle: product.meta_title || `${product.name} - Goince`,
      metaDescription: (product.meta_description || product.short_description || product.name).slice(0, 160),
      product,
      productVideo,
      bundleProducts,
      reviewPhotos,
      helpfulCounts,
      votedReviewIds,
      verifiedBuyerIds,
      answeredQuestions,
      questionPending: req.query.question === 'pending',
      recentPurchase,
      viewerLine,
      deliveryZone,
      deliveryEstimate,
      stockBar,
      soldLine,
      showSizeGuide,
      galleryImages,
      options,
      optionLabel,
      variants,
      variantAttributes,
      specs,
      discountPercent,
      related,
      secondImages,
      reviews,
      avgRating: avgRow.avgRating ? parseFloat(avgRow.avgRating).toFixed(1) : null,
      reviewCount: avgRow.reviewCount,
      reviewPending: req.query.review === 'pending',
      deliveryCharge: deliveryCharges.inside_dhaka,
      deliveryChargeOutside: deliveryCharges.outside_dhaka,
      descriptionHtml,
      siteName: 'Goince'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong loading the product.');
  }
});

// ---------- SUBMIT A REVIEW (login required) ----------
// D3 (feat/product-page): review-er sathe ekta photo-o deoa jay.
// Multipart form bole action URL-e ?_csrf= thaktei hobe (lib/csrf.js
// — multipart body route-er age pora jay na); photo upload.single +
// convertToWebP diye /uploads-e WebP hisebe jay, review_photos
// table-e filename save hoy. Photo na dile ager motoi shudhu text
// review joma hoy. Review age-r motoi 'pending' — admin approve
// na korle shop-e dekhabe na.
router.post('/product/:id/review', upload.single('review_photo'), upload.convertToWebP, async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const { rating, comment } = req.body;
    const [result] = await db.query(
      'INSERT INTO reviews (product_id, user_id, rating, comment, status) VALUES (?, ?, ?, ?, \'pending\')',
      [req.params.id, req.session.userId, rating, comment]
    );
    if (req.file) {
      try {
        await db.query(
          'INSERT INTO review_photos (review_id, filename) VALUES (?, ?)',
          [result.insertId, req.file.filename]
        );
      } catch (e) { /* photo row na bosleo review-ta thakbe */ }
    }
    res.redirect('/product/' + req.params.id + '?review=pending');
  } catch (err) {
    console.error(err);
    res.status(500).send('Review submit korte problem hoyeche.');
  }
});

// ---------- REVIEW "HELPFUL" VOTE (D3, feat/product-page) ----------
// Ekjon customer/guest ekta review-ke ekbar-i helpful bolte pare —
// toggle: age vote diye thakle tule neoa hoy. Login kora thakle
// user_id diye, guest hole session key diye chena hoy; DB-r UNIQUE
// key dutoi (review_id, user_id) / (review_id, session_key) ei
// niyom-ta jore diye rakhe. CSRF: JSON fetch x-csrf-token header-e
// token pathay (lib/csrf.js seta mane). Uttor: { ok, helpful, count }.
router.post('/product/review/:reviewId/helpful', async (req, res) => {
  try {
    const reviewId = parseInt(req.params.reviewId, 10);
    if (!reviewId) return res.status(404).json({ ok: false, error: 'Review not found.' });
    const [[rv]] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
    if (!rv) return res.status(404).json({ ok: false, error: 'Review not found.' });
    const userId = req.session.userId || null;
    const sessionKey = viewerSessionKey(req);
    const [existing] = await db.query(
      'SELECT id FROM review_helpful_votes WHERE review_id = ? AND (user_id = ? OR session_key = ?)',
      [reviewId, userId, sessionKey]
    );
    let voted;
    if (existing.length > 0) {
      await db.query('DELETE FROM review_helpful_votes WHERE id = ?', [existing[0].id]);
      voted = false;
    } else {
      try {
        await db.query(
          'INSERT INTO review_helpful_votes (review_id, user_id, session_key) VALUES (?, ?, ?)',
          [reviewId, userId, sessionKey]
        );
      } catch (e) {
        // Race-e duibar click hole UNIQUE key badha dey — tokhon
        // vote-ta agei boshe geche bole dhora hoy.
        if (!/Duplicate entry/.test(String(e && e.message))) throw e;
      }
      voted = true;
    }
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) AS count FROM review_helpful_votes WHERE review_id = ?',
      [reviewId]
    );
    res.json({ ok: true, helpful: voted, count: Number(count) || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Could not save your vote. Please try again.' });
  }
});

// ---------- ASK A PRODUCT QUESTION (D4, feat/product-page) ----------
// Shopper proshno kore — 'pending' hisebe joma hoy, shop-e othe na.
// Shudhu admin uttor dile (Admin > Reviews > Product Q&A) tobei
// public-e dekhabe. Login lage (review-er motoi — spam atkate).
router.post('/product/:id/question', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const question = String(req.body.question || '').trim();
    if (!question) return res.redirect('/product/' + req.params.id);
    const [prows] = await db.query(
      'SELECT id FROM products WHERE id = ? OR slug = ?',
      [isNaN(parseInt(req.params.id, 10)) ? 0 : parseInt(req.params.id, 10), req.params.id]
    );
    if (prows.length === 0) return res.status(404).send('Product not found');
    const [[u]] = await db.query('SELECT name FROM users WHERE id = ?', [req.session.userId]);
    await db.query(
      'INSERT INTO product_questions (product_id, user_id, asker_name, question, status) VALUES (?, ?, ?, ?, \'pending\')',
      [prows[0].id, req.session.userId, (u && u.name) || 'Customer', question.slice(0, 1000)]
    );
    res.redirect('/product/' + prows[0].id + '?question=pending');
  } catch (err) {
    console.error(err);
    res.status(500).send('Question submit korte problem hoyeche.');
  }
});

// ---------- NOTIFY ME (stock asle janano) ----------
router.post('/product/:id/notify-me', async (req, res) => {
  const phone = normalizeBdPhone(req.body.phone || '');
  if (!isValidBdPhone(req.body.phone || '')) {
    return res.redirect('/product/' + req.params.id + '?notify=invalid');
  }
  try {
    const [[p]] = await db.query('SELECT id, stock FROM products WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).send('Product not found');
    if (p.stock > 0) return res.redirect('/product/' + req.params.id);
    await db.query(
      'INSERT INTO stock_alerts (product_id, phone) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM stock_alerts WHERE product_id = ? AND phone = ? AND notified = 0)',
      [req.params.id, phone, req.params.id, phone]
    );
    res.redirect('/product/' + req.params.id + '?notify=ok');
  } catch (e) {
    res.redirect('/product/' + req.params.id + '?notify=error');
  }
});

// ---------- ADD TO CART ----------
// Mini-cart drawer-er JSON uttor (feat/cart-buying, B5): POST
// /cart/add/:id (PR #80), /cart/update/:cartKey ar
// /cart/remove/:cartKey — tintei AJAX hole eki akarer uttor dey:
// { ok, cartCount, subtotal, drawerHtml }. Drawer HTML-ta eki
// shared partial (views/partials/mini-cart-content.ejs) theke ase,
// tai add/stepper/remove-er pore drawer-e sob somoy TAZA cart
// dekhay — delivery line-soho (partial-ta cart item-er
// freeDelivery flag theke bojhe sob item free kina; charge-gulo
// settings theke ase, hardcode noy).
async function miniCartPayload(req, res) {
  const cart = req.session.cart || [];
  const cartCount = cart.reduce((s, it) => s + it.quantity, 0);
  const subtotal = cart.reduce((s, it) => s + (Number(it.price) || 0) * it.quantity, 0);
  const charges = await getDeliveryCharges();
  const drawerHtml = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'partials', 'mini-cart-content.ejs'),
    { miniCart: cart, miniCartSubtotal: subtotal, cartCount, csrfToken: res.locals.csrfToken,
      miniCartDeliveryInside: charges.inside_dhaka, miniCartDeliveryOutside: charges.outside_dhaka }
  );
  return { cartCount, subtotal, drawerHtml };
}

router.post('/cart/add/:id', async (req, res) => {
  // AJAX add-to-cart (fix/ajax-add-to-cart): donal — Add to Cart
  // chaple cart-er page-e chole jay, erokom jaoa jabe na. JS
  // fetch POST pathay X-Requested-With: XMLHttpRequest header
  // diye (req.xhr) — tokhon redirect noy, JSON uttor ashe
  // (cartCount + drawer HTML), ar page eki jaygay thake. JS na
  // cholle ager motoi redirect hoy /cart-e (no-JS fallback).
  const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
  const ajaxError = (status, message) => res.status(status).json({ ok: false, error: message });
  try {
    const productId = req.params.id;
    const quantity = parseInt(req.body.quantity) || 1;
    const variantId = req.body.variant_id ? parseInt(req.body.variant_id) : null;
    const optionId = req.body.option_id ? parseInt(req.body.option_id) : null;

    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) {
      if (isAjax) return ajaxError(404, 'Product not found');
      return res.status(404).send('Product not found');
    }
    const product = rows[0];

    // Variant select kora thakle, tar price/label niye ashi
    let price = product.price;
    let variantLabel = null;
    if (variantId) {
      const [[variant]] = await db.query('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', [variantId, productId]);
      if (!variant) {
        if (isAjax) return ajaxError(400, 'Selected variant not found.');
        return res.status(400).send('Selected variant not found.');
      }
      price = variant.price !== null ? variant.price : product.price;
      const [attrs] = await db.query(
        `SELECT a.name AS attribute_name, av.value FROM product_variant_attributes pva
         JOIN attribute_values av ON pva.attribute_value_id = av.id
         JOIN attributes a ON av.attribute_id = a.id
         WHERE pva.variant_id = ?`,
        [variantId]
      );
      variantLabel = attrs.map(a => `${a.attribute_name}: ${a.value}`).join(', ');
    }

    // Option select kora thakle (Color/Size/Weight), tar label ke cart-e rakhi
    // ebong tar nijer chobi thakle shei chobi-i cart-e dekhabo (na thakle product-er default chobi)
    let cartImage = product.image;
    let optionLabelText = null;
    if (optionId) {
      const [[option]] = await db.query('SELECT * FROM product_options WHERE id = ? AND product_id = ?', [optionId, productId]);
      if (!option) {
        if (isAjax) return ajaxError(400, 'Selected option not found.');
        return res.status(400).send('Selected option not found.');
      }
      optionLabelText = `${option.option_label}: ${option.value_name}`;
      if (option.image) cartImage = option.image;
    }
    // Variant ar Option duitai thakle (kokhono na hoyar kotha, kintu shurokkha jonno) ekshathe dekhano
    const combinedLabel = [variantLabel, optionLabelText].filter(Boolean).join(', ') || null;

    if (!req.session.cart) req.session.cart = [];

    // cartKey: product+variant+option er unique combination, jate ekই product-er
    // alada alada variant/option cart-e alada line hishebe thake
    const cartKey = `${productId}${variantId ? '_v' + variantId : ''}${optionId ? '_o' + optionId : ''}`;

    const existingItem = req.session.cart.find(item => item.cartKey === cartKey);
    if (existingItem) {
      existingItem.quantity += quantity;
    } else {
      req.session.cart.push({
        cartKey,
        id: product.id,
        variantId: variantId || null,
        variantLabel: combinedLabel,
        name: product.name,
        price: price,
        image: cartImage,
        quantity: quantity,
        // Per-product free delivery (feat/cart-buying, B4): drawer-er
        // delivery line + checkout-er hisab — du jaygatei ei flag
        // lage; purono session-er item-e flag na thakle drawer
        // "delivery charge" dhore ney (nirapod default), ar
        // checkout DB theke abar jachai kore (getCartShippingFlags).
        freeDelivery: !!product.free_shipping
      });
    }

    // AJAX uttor: redirect noy — notun cartCount + subtotal +
    // drawer-er TAZA HTML (eki partial ja footer-eo render hoy:
    // views/partials/mini-cart-content.ejs), jate JS badge update
    // kore, drawer-er vitore notun content bosiye drawer khulte
    // pare — page reload / navigate kicchu hoy na.
    if (isAjax) {
      const { cartCount, subtotal, drawerHtml } = await miniCartPayload(req, res);
      return res.json({ ok: true, cartCount, itemName: product.name, subtotal, drawerHtml });
    }

    // Buy Now (feat/cart-buying, B3): item-ta cart-e jog kore
    // (ager item gulo thake — cart khali kora hoy na), tarpor
    // sorasori /checkout-e jay — cart page skip. JS na cholleo
    // eki POST /checkout-e pouchay (no-JS fallback). AJAX + buy_now
    // kokhono ashar kotha na (footer JS Buy Now-ke intercept kore
    // na), tobu asle uporer AJAX shakha-i uttor dey.
    if (req.body.buy_now === '1') return res.redirect('/checkout');

    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    if (isAjax) return ajaxError(500, 'Could not add product to cart.');
    res.status(500).send('Could not add product to cart.');
  }
});

// ---------- VIEW CART ----------
router.get('/cart', async (req, res) => {
  const sessionCart = req.session.cart || [];
  let cart = [];

  if (sessionCart.length > 0) {
    // Prottek item er live stock DB theke niye ashi, jate stock kom thakle
    // customer ke shathe shathe jana jay
    const ids = [...new Set(sessionCart.map(i => i.id))];
    const [products] = await db.query(
      `SELECT id, stock, category_id FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    const stockMap = {};
    const categoryMap = {};
    products.forEach(p => { stockMap[p.id] = p.stock; categoryMap[p.id] = p.category_id; });

    // Variant thaka item gulor stock, variant table theke ashe (product stock na)
    const variantIds = sessionCart.filter(i => i.variantId).map(i => i.variantId);
    const variantStockMap = {};
    if (variantIds.length > 0) {
      const [variantRows] = await db.query(
        `SELECT id, stock FROM product_variants WHERE id IN (${variantIds.map(() => '?').join(',')})`,
        variantIds
      );
      variantRows.forEach(v => { variantStockMap[v.id] = v.stock; });
    }

    cart = sessionCart.map(item => {
      const stock = item.variantId ? (variantStockMap[item.variantId] !== undefined ? variantStockMap[item.variantId] : 0) : (stockMap[item.id] !== undefined ? stockMap[item.id] : 0);
      return {
        ...item,
        availableStock: stock,
        overStock: item.quantity > stock
      };
    });

    // Related products: cart e thaka product gulor category theke,
    // kintu cart e already thaka product bade
    const categoryIds = [...new Set(products.map(p => p.category_id).filter(Boolean))];
    if (categoryIds.length > 0) {
      const [related] = await db.query(
        `SELECT * FROM products WHERE category_id IN (${categoryIds.map(() => '?').join(',')})
         AND id NOT IN (${ids.map(() => '?').join(',')}) LIMIT 4`,
        [...categoryIds, ...ids]
      );
      res.locals.relatedProducts = related;
    } else {
      res.locals.relatedProducts = [];
    }
  } else {
    res.locals.relatedProducts = [];
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = req.session.coupon || null;
  const discount = coupon ? (subtotal * coupon.discount_percent / 100) : 0;
  const total = subtotal - discount;
  // Card-er delivery badge (feat/cart-buying, B4): "You might also
  // like" card-gulo Free Delivery na Delivery Charge dekhay.
  const deliveryCharges = await getDeliveryCharges();

  // Estimated delivery: Dhaka-r vitore 1-2 din, baire 3-5 din (shipping policy-r sathe miliye)
  const today = new Date();
  const minDate = new Date(today); minDate.setDate(today.getDate() + 1);
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + 5);
  const dateOpts = { day: 'numeric', month: 'short' };
  const estimatedDelivery = `${minDate.toLocaleDateString('en-GB', dateOpts)} - ${maxDate.toLocaleDateString('en-GB', dateOpts)} (1–2 days inside Dhaka, 3–5 days outside Dhaka)`;

  let wishlistProductIds = [];
  if (req.session.userId) {
    const [wl] = await db.query('SELECT product_id FROM wishlist WHERE user_id = ?', [req.session.userId]);
    wishlistProductIds = wl.map(w => w.product_id);
  }

  res.render('cart', {
    cart, subtotal, coupon, discount, total,
    deliveryCharges,
    relatedProducts: res.locals.relatedProducts,
    estimatedDelivery,
    wishlistProductIds,
    siteName: 'Goince'
  });
});

// ---------- UPDATE CART QUANTITY (+ / - buttons and manual input, shob eikhane) ----------
router.post('/cart/update/:cartKey', async (req, res) => {
  // B5 (feat/cart-buying): drawer-er stepper AJAX hole JSON uttor
  // (PR #80-er /cart/add-er motoi) — drawer refresh, reload noy,
  // drawer bondho hoy na. Cart page theke asle ager motoi
  // redirect hoy /cart-e (full-page behaviour bodlano hoy ni).
  const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
  const cart = req.session.cart || [];
  const item = cart.find(i => (i.cartKey || String(i.id)) === req.params.cartKey);
  if (!item) {
    if (isAjax) return res.status(404).json({ ok: false, error: 'Item not found in cart.' });
    return res.redirect('/cart');
  }
  {
    // quantity ekadhikbar ashle (plain submit-e number input +
    // click kora +/− button — duitar-i name="quantity"): array
    // hoy. Seta na samlale parseInt prothom-ta ney, mane input-er
    // bortoman quantity — stepper kichui bodlay na (ei bug-ta
    // live-e chilo: cart page-er +/− chaple quantity bodlato na,
    // probe-e dekha geche quantity=2&quantity=3 pathaleo 2-i
    // thake). Array hole bortoman quantity theke alada value-ta-i
    // asol target (+1 ba −1); na mille prothom-ta.
    let rawQty = req.body.quantity;
    if (Array.isArray(rawQty)) {
      const cur = item.quantity;
      const picked = rawQty.map((v) => parseInt(v, 10)).find((n) => !isNaN(n) && n !== cur);
      rawQty = picked !== undefined ? picked : rawQty[0];
    }
    let newQty = Math.max(1, parseInt(rawQty, 10) || 1);

    // Stock er beshi order kora theke atkano — kintu Pre-order (backorder) thakle
    // stock-er beshi-o newa jabe
    const [[prodRow]] = await db.query('SELECT allow_backorder FROM products WHERE id = ?', [item.id]);
    if (!(prodRow && prodRow.allow_backorder)) {
      if (item.variantId) {
        const [rows] = await db.query('SELECT stock FROM product_variants WHERE id = ?', [item.variantId]);
        if (rows.length > 0) newQty = Math.min(newQty, rows[0].stock);
      } else {
        const [rows] = await db.query('SELECT stock FROM products WHERE id = ?', [item.id]);
        if (rows.length > 0) newQty = Math.min(newQty, rows[0].stock);
      }
    }
    item.quantity = Math.max(1, newQty);
  }
  if (isAjax) {
    const { cartCount, subtotal, drawerHtml } = await miniCartPayload(req, res);
    return res.json({ ok: true, cartCount, subtotal, drawerHtml });
  }
  res.redirect('/cart');
});

// ---------- REMOVE FROM CART ----------
router.post('/cart/remove/:cartKey', async (req, res) => {
  // B5 (feat/cart-buying): drawer-er remove AJAX hole JSON uttor
  // (PR #80-er /cart/add-er motoi) — drawer refresh, reload noy,
  // drawer bondho hoy na. Cart page theke asle ager motoi
  // redirect hoy /cart-e.
  const isAjax = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
  req.session.cart = (req.session.cart || []).filter(i => (i.cartKey || String(i.id)) !== req.params.cartKey);
  if (isAjax) {
    const { cartCount, subtotal, drawerHtml } = await miniCartPayload(req, res);
    return res.json({ ok: true, cartCount, subtotal, drawerHtml });
  }
  res.redirect('/cart');
});

// ---------- SAVE FOR LATER (Cart theke Wishlist e move kora) ----------
router.post('/cart/save-for-later/:cartKey', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const cart = req.session.cart || [];
    const item = cart.find(i => (i.cartKey || String(i.id)) === req.params.cartKey);
    const productId = item ? item.id : req.params.cartKey;
    await db.query(
      'INSERT IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)',
      [req.session.userId, productId]
    );
    req.session.cart = cart.filter(i => (i.cartKey || String(i.id)) !== req.params.cartKey);
    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.redirect('/cart');
  }
});

// ==================== WISHLIST ====================

// ---------- VIEW WISHLIST ----------
router.get('/wishlist', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const [items] = await db.query(
    'SELECT products.* FROM wishlist JOIN products ON wishlist.product_id = products.id WHERE wishlist.user_id = ? ORDER BY wishlist.created_at DESC',
    [req.session.userId]
  );
  // "You may also like" (fix/floating-cart-wishlist): the wishlist
  // page was a dead end when empty. Show the same Best Sellers the
  // homepage shows (top 4 by sold, in stock, visible) under the
  // empty state, with the same card buttons — variant/option
  // products get "Choose Option →", the rest Add to Cart.
  let suggestions = [];
  let variantProductIds = new Set(), optionProductIds = new Set();
  try {
    const [rows] = await db.query(
      `SELECT products.*, COALESCE(SUM(order_items.quantity), 0) AS sold
       FROM products LEFT JOIN order_items ON order_items.product_id = products.id
       WHERE products.stock > 0 AND ${VISIBLE_PRODUCT_SQL}
       GROUP BY products.id ORDER BY sold DESC, products.created_at DESC LIMIT 4`);
    suggestions = rows;
    const [vrows] = await db.query('SELECT DISTINCT product_id FROM product_variants');
    const [orows] = await db.query('SELECT DISTINCT product_id FROM product_options');
    variantProductIds = new Set(vrows.map(r => r.product_id));
    optionProductIds = new Set(orows.map(r => r.product_id));
  } catch (e) { suggestions = []; }
  // Card-er delivery badge (feat/cart-buying, B4): wishlist-er
  // card-gulo Free Delivery na Delivery Charge dekhay.
  const deliveryCharges = await getDeliveryCharges();
  res.render('wishlist', { items, suggestions, variantProductIds: [...variantProductIds], optionProductIds: [...optionProductIds], deliveryCharges, siteName: 'Goince' });
});

// ---------- ADD TO WISHLIST (product page theke direct) ----------
router.post('/wishlist/add/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    await db.query('INSERT IGNORE INTO wishlist (user_id, product_id) VALUES (?, ?)', [req.session.userId, req.params.id]);
    res.redirect(req.get('Referrer') || '/');
  } catch (err) {
    console.error(err);
    res.redirect('/');
  }
});

// ---------- REMOVE FROM WISHLIST ----------
router.post('/wishlist/remove/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  await db.query('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [req.session.userId, req.params.id]);
  res.redirect(req.get('Referrer') || '/wishlist');
});

// ---------- MOVE FROM WISHLIST TO CART ----------
router.post('/wishlist/move-to-cart/:id', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length > 0) {
      const product = rows[0];
      if (!req.session.cart) req.session.cart = [];
      const existing = req.session.cart.find(i => i.id == product.id && !i.variantId);
      if (existing) {
        existing.quantity += 1;
      } else {
        req.session.cart.push({ cartKey: String(product.id), id: product.id, variantId: null, variantLabel: null, name: product.name, price: product.price, image: product.image, quantity: 1, freeDelivery: !!product.free_shipping });
      }
      await db.query('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [req.session.userId, req.params.id]);
    }
    res.redirect('/wishlist');
  } catch (err) {
    console.error(err);
    res.redirect('/wishlist');
  }
});

// ---------- APPLY COUPON ----------
router.post('/cart/apply-coupon', async (req, res) => {
  try {
    const code = (req.body.coupon_code || '').trim();
    const [rows] = await db.query(
      'SELECT * FROM coupons WHERE code = ? AND active = 1 AND (expiry_date IS NULL OR expiry_date >= CURDATE())',
      [code]
    );
    if (rows.length === 0) {
      req.session.couponError = 'Invalid ba expired coupon code.';
      req.session.coupon = null;
    } else {
      req.session.coupon = { code: rows[0].code, discount_percent: rows[0].discount_percent };
      req.session.couponError = null;
    }
    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.redirect('/cart');
  }
});

// ---------- REMOVE COUPON ----------
router.post('/cart/remove-coupon', (req, res) => {
  req.session.coupon = null;
  res.redirect('/cart');
});

// Cart-er product gulo free_shipping / cod_allowed kina
async function getCartShippingFlags(cart) {
  const ids = [...new Set(cart.map(i => i.id))];
  if (!ids.length) return { allFreeShipping: false, codAllowed: true };
  try {
    const [rows] = await db.query(`SELECT id, free_shipping, cod_allowed FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    return {
      allFreeShipping: rows.length > 0 && rows.every(r => r.free_shipping),
      codAllowed: rows.every(r => r.cod_allowed !== 0)
    };
  } catch (e) { return { allFreeShipping: false, codAllowed: true }; }
}

// ---------- CHECKOUT PAGE ----------
router.get('/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/cart');
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = req.session.coupon || null;
  const discount = coupon ? (subtotal * coupon.discount_percent / 100) : 0;
  const deliveryZones = await getDeliveryZones();
  const deliveryCharges = await getDeliveryCharges();
  const flags = await getCartShippingFlags(cart);
  const deliveryCharge = flags.allFreeShipping ? 0 : (deliveryZones.length ? deliveryZones[0].charge : deliveryCharges.inside_dhaka);
  const total = subtotal - discount + deliveryCharge;
  const paymentMethods = await getPaymentMethods();
  const gateway = await getGatewayConfig();
  res.render('checkout', { cart, subtotal, coupon, discount, deliveryCharges, deliveryZones, deliveryCharge, total, paymentMethods, gateway, allFreeShipping: flags.allFreeShipping, codAllowed: flags.codAllowed, error: null, siteName: 'Goince' });
});

// ---------- PLACE ORDER ----------
router.post('/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/cart');

  const { customer_name, email, phone, address, payment_method, transaction_id, delivery_area } = req.body;
  const deliveryZones = await getDeliveryZones();
  const deliveryCharges = await getDeliveryCharges();
  const paymentMethods = await getPaymentMethods();
  const gateway = await getGatewayConfig();
  const zone = deliveryZones.find(z => z.slug === delivery_area) || deliveryZones[0];
  const defaultCharge = zone ? zone.charge : deliveryCharges.inside_dhaka;
  // Free-delivery flag error render-er AGE-i ber kora (feat/cart-buying,
  // B4): age renderCheckoutError zone charge-i dekhato, cart-er sob
  // item Free Delivery holeo — ekhon vul form-eo ৳0 delivery + thik
  // total dekhay, checkout page-er motoi.
  const flags = await getCartShippingFlags(cart);
  const errorDeliveryCharge = flags.allFreeShipping ? 0 : defaultCharge;
  const renderCheckoutError = (msg) => {
    const _coupon = req.session.coupon || null;
    const _sub0 = cart.reduce((s, it) => s + it.price * it.quantity, 0);
    const _disc0 = _coupon ? (_sub0 * _coupon.discount_percent / 100) : 0;
    return res.render('checkout', { cart, subtotal: _sub0, coupon: _coupon, discount: _disc0, deliveryCharges, deliveryZones, deliveryCharge: errorDeliveryCharge, total: _sub0 - _disc0 + errorDeliveryCharge, paymentMethods, gateway, allFreeShipping: flags.allFreeShipping, codAllowed: flags.codAllowed, error: msg, siteName: 'Goince' });
  };
  // Gateway option: sudhu jodi gateway enable + configure kora thake
  const gatewayMethodName = 'Online Payment (Gateway)';
  const allowedMethods = ['Cash on Delivery', ...paymentMethods.map(m => m.method_name)];
  if (gateway.configured && (gateway.mode === 'gateway' || gateway.mode === 'both')) allowedMethods.push(gatewayMethodName);
  // Gateway mode-e manual method (COD chara) off thake
  if (gateway.mode === 'gateway' && gateway.configured) {
    const idx = allowedMethods.indexOf('Cash on Delivery');
    if (idx >= 0) allowedMethods.splice(idx, 1);
  }
  const selectedMethod = payment_method || 'Cash on Delivery';
  if (!allowedMethods.includes(selectedMethod)) {
    return renderCheckoutError('Invalid payment method.');
  }
  if (selectedMethod === gatewayMethodName && !gateway.configured) {
    return renderCheckoutError('Online payment ekhono setup kora hoyni — Cash on Delivery ba bKash/Nagad diye order koro.');
  }
  if (!customer_name || !address || !isValidBdPhone(phone)) {
    return renderCheckoutError('Sothik naam, thikana ar Bangladeshi mobile number (01XXXXXXXXX) dao.');
  }
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = req.session.coupon || null;
  const discount = coupon ? (subtotal * coupon.discount_percent / 100) : 0;
  const deliveryCharge = flags.allFreeShipping ? 0 : (zone ? zone.charge : (deliveryCharges[delivery_area] || deliveryCharges.inside_dhaka));
  if (selectedMethod === 'Cash on Delivery' && !flags.codAllowed) {
    return renderCheckoutError('Cash on Delivery is not available for one or more products in your cart — please pay online or by bKash/Nagad.');
  }
  const normalizedPhone = normalizeBdPhone(phone);
  const total = subtotal - discount + deliveryCharge;
  const userId = req.session.userId || null;

  // bKash/Nagad/Rocket (ba admin-er jog kora onno mobile banking method) e
  // Transaction ID chara order confirm kora jabe na — Cash on Delivery-e lagbe na
  const needsTransactionId = selectedMethod !== 'Cash on Delivery' && selectedMethod !== gatewayMethodName;
  if (needsTransactionId && !(transaction_id || '').trim()) {
    return renderCheckoutError(`Please enter the Transaction ID after sending money via ${selectedMethod} — the order can't be confirmed without it.`);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [orderResult] = await connection.query(
      `INSERT INTO orders (user_id, customer_name, email, phone, address, payment_method, transaction_id, delivery_zone, delivery_charge, coupon_code, discount_amount, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, customer_name, email || null, normalizedPhone, address, payment_method || 'Cash on Delivery', transaction_id || null, zone ? zone.name : null, deliveryCharge, coupon ? coupon.code : null, discount, total]
    );
    const orderId = orderResult.insertId;

    for (const item of cart) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, product_name, price, quantity, variant_id, variant_label, cost_price) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT cost_price FROM products WHERE id = ?))',
        [orderId, item.id, item.name, item.price, item.quantity, item.variantId || null, item.variantLabel || null, item.id]
      );
      if (item.variantId) {
        await connection.query(
          'UPDATE product_variants SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, item.variantId]
        );
        const [[vs]] = await connection.query('SELECT stock FROM product_variants WHERE id = ?', [item.variantId]);
        await connection.query(
          'INSERT INTO stock_history (product_id, variant_id, change_qty, stock_after, reason) VALUES (?, ?, ?, ?, ?)',
          [item.id, item.variantId, -item.quantity, vs ? vs.stock : 0, 'order']
        );
      } else {
        await connection.query(
          'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, item.id]
        );
        const [[ps]] = await connection.query('SELECT stock FROM products WHERE id = ?', [item.id]);
        await connection.query(
          'INSERT INTO stock_history (product_id, variant_id, change_qty, stock_after, reason) VALUES (?, ?, ?, ?, ?)',
          [item.id, null, -item.quantity, ps ? ps.stock : 0, 'order']
        );
      }
    }

    await connection.commit();
    req.session.cart = [];
    req.session.coupon = null;

    // Order confirmation email pathano (background e, order response e delay hobe na)
    const siteUrl = `${req.protocol}://${req.get('host')}`;
    sendOrderConfirmation(email, {
      id: orderId,
      customer_name,
      phone,
      address,
      items: cart,
      subtotal: subtotal.toFixed(2),
      discount: discount.toFixed(2),
      couponCode: coupon ? coupon.code : null,
      deliveryCharge: deliveryCharge.toFixed(2),
      total: total.toFixed(2),
      paymentMethod: selectedMethod,
      transactionId: transaction_id || null,
      siteUrl,
      shopPhone: res.locals.shopPhone
    });

    // Admin-er phone/browser-e Push Notification (background e, response delay korbe na)
    notifyAdmins(db, {
      title: '🛒 নতুন অর্ডার এসেছে!',
      body: `${customer_name} — ৳${total.toFixed(2)} (${selectedMethod})`,
      url: `/admin/orders/${orderId}`
    });

    res.render('order-success', { orderId, siteName: 'Goince', cart, total });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).send('Order placing failed. Please try again.');
  } finally {
    connection.release();
  }
});

// ---------- SEARCH SUGGESTIONS (header autocomplete) ----------
router.get('/api/search-suggestions', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const [rows] = await db.query(
      'SELECT id, name, price FROM products WHERE name LIKE ? ORDER BY created_at DESC LIMIT 8',
      [`%${q}%`]);
    res.json(rows);
  } catch (err) { res.json([]); }
});

// ---------- ABOUT / CONTACT ----------
router.get('/about', (req, res) => {
  res.render('about', { siteName: 'Goince', pageTitle: 'About Us - Goince', metaDescription: 'Goince somporke jano — Bangladesh-er online shop, Cash on Delivery, fast delivery.' });
});
router.get('/contact', (req, res) => {
  res.render('contact', { siteName: 'Goince', pageTitle: 'Contact Us - Goince', metaDescription: 'Goince-er sathe jogajog koro — phone, WhatsApp, order support.', success: null, error: null });
});
router.post('/contact', async (req, res) => {
  const render = (success, error) => res.render('contact', { siteName: 'Goince', pageTitle: 'Contact Us - Goince', metaDescription: 'Goince-er sathe jogajog koro — phone, WhatsApp, order support.', success, error });
  const name = (req.body.name || '').trim();
  const phone = (req.body.phone || '').trim();
  const email = (req.body.email || '').trim();
  const subject = (req.body.subject || '').trim();
  const message = (req.body.message || '').trim();
  if (name.length < 2 || message.length < 5) return render(null, 'Naam ar message-ta thik moto likho.');
  if (phone && !isValidBdPhone(phone)) return render(null, 'Sothik Bangladeshi mobile number (01XXXXXXXXX) dao — na thakle khali rakho.');
  try {
    await db.query(
      'INSERT INTO contact_messages (name, phone, email, subject, message) VALUES (?, ?, ?, ?, ?)',
      [name, phone || null, email || null, subject || null, message]);
    return render('Dhonnobad! Tomar message peyechi — amra shigghroi jogajog korbo.', null);
  } catch (err) { console.error(err); return render(null, 'Message pathate problem hoyeche — pore abar try koro, ba WhatsApp-e likho.'); }
});

// ---------- TRACK ORDER (guest — Order ID + phone) ----------
router.get('/track-order', (req, res) => {
  res.render('track-order', { siteName: 'Goince', pageTitle: 'Track Order - Goince', metaDescription: 'Order ID ar phone number diye tomar order-er status dekho.', order: null, items: [], error: null });
});
router.post('/track-order', async (req, res) => {
  const orderId = parseInt(req.body.order_id) || 0;
  const phone = normalizeBdPhone(req.body.phone || '');
  const render = (order, items, error) => res.render('track-order', { siteName: 'Goince', pageTitle: 'Track Order - Goince', metaDescription: 'Order ID ar phone number diye tomar order-er status dekho.', order, items, error });
  if (!orderId || !isValidBdPhone(phone)) return render(null, [], 'Order ID ar sothik mobile number (01XXXXXXXXX) dao.');
  try {
    const [[order]] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order || normalizeBdPhone(order.phone) !== phone) return render(null, [], 'Ei Order ID / phone number-e kono order pawa jayni.');
    const [items] = await db.query('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
    return render(order, items, null);
  } catch (err) { console.error(err); return render(null, [], 'Order khujte problem hoyeche — pore abar try koro.'); }
});

// ---------- STATIC POLICY PAGES (Google Merchant Center-er jonno dorkar) ----------
router.get('/terms', (req, res) => {
  res.render('terms', { siteName: 'Goince' });
});

router.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy', { siteName: 'Goince' });
});

router.get('/shipping-policy', (req, res) => {
  res.render('shipping-policy', { siteName: 'Goince' });
});

router.get('/return-policy', (req, res) => {
  res.render('return-policy', { siteName: 'Goince' });
});

// ---------- PRODUCT FEED (Google Merchant Center-er jonno) ----------
// Notun product add korle ba stock/price bodlale ei feed nijei update hobe,
// Google প্রতিদিন eta re-fetch kore.
router.get('/product-feed.xml', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const [products] = await db.query('SELECT * FROM products');

    const esc = (str) => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
    xml += '<channel>\n';
    xml += `  <title>${esc('Goince Product Feed')}</title>\n`;
    xml += `  <link>${baseUrl}</link>\n`;
    xml += `  <description>${esc('Goince product feed for Google Merchant Center')}</description>\n`;

    products.forEach(p => {
      // Real chobi na thakle (no-image placeholder) feed theke bad rakhbo — Google
      // generic/stock chobi pochondo kore na, real product image chara approve hoy na.
      if (!p.image || p.image === 'no-image.png') return;

      const rawDesc = p.short_description || (p.description || '').replace(/[#*_`>-]/g, '').slice(0, 500);
      xml += '  <item>\n';
      xml += `    <g:id>${p.id}</g:id>\n`;
      xml += `    <g:title>${esc(p.name)}</g:title>\n`;
      xml += `    <g:description>${esc(rawDesc)}</g:description>\n`;
      xml += `    <g:link>${baseUrl}/product/${p.id}</g:link>\n`;
      xml += `    <g:image_link>${baseUrl}/uploads/${esc(p.image)}</g:image_link>\n`;
      xml += `    <g:availability>${p.stock > 0 ? 'in stock' : 'out of stock'}</g:availability>\n`;
      xml += `    <g:price>${Number(p.price).toFixed(2)} BDT</g:price>\n`;
      xml += '    <g:condition>new</g:condition>\n';
      xml += '    <g:brand>Goince</g:brand>\n';
      xml += '    <g:identifier_exists>no</g:identifier_exists>\n';
      xml += '  </item>\n';
    });

    xml += '</channel>\n</rss>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Product feed generate korte problem hoyeche.');
  }
});

// ---------- SITEMAP.XML (Google Search Console-er jonno) ----------
router.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const [products] = await db.query('SELECT id, created_at FROM products');
    const [categories] = await db.query('SELECT id FROM categories');

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += `  <url><loc>${baseUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/shipping-policy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/terms</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/privacy-policy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/return-policy</loc><changefreq>monthly</changefreq><priority>0.3</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/about</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/contact</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;
    xml += `  <url><loc>${baseUrl}/track-order</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>\n`;

    categories.forEach(c => {
      xml += `  <url><loc>${baseUrl}/?category=${c.id}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
    });

    products.forEach(p => {
      const lastmod = p.created_at ? new Date(p.created_at).toISOString().split('T')[0] : '';
      xml += `  <url><loc>${baseUrl}/product/${p.id}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    });

    xml += '</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).send('Sitemap generate korte problem hoyeche.');
  }
});

module.exports = router;
