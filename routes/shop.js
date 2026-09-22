// Customer side er shob route: Home, Product Details, Reviews, Cart, Coupon, Checkout
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { marked } = require('marked');
const { sendOrderConfirmation } = require('../config/email');

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

// ---------- HOMEPAGE ----------
router.get('/', async (req, res) => {
  try {
    const categoryId = req.query.category || '';
    const search = req.query.search || '';
    const sort = req.query.sort || 'newest';

    const [categories] = await db.query('SELECT * FROM categories ORDER BY (parent_id IS NULL) DESC, parent_id, name');
    const mainCategories = categories.filter(c => !c.parent_id);

    // Selected category ta main category naki sub-category, ebong tar sub-category gulo ki ki eta ber kora
    let subCategories = [];
    let categoryIdsToFilter = [];
    if (categoryId) {
      const selected = categories.find(c => c.id == categoryId);
      if (selected && !selected.parent_id) {
        // Main category select kora hoyeche — tar shob sub-category o filter e jog hobe
        subCategories = categories.filter(c => c.parent_id == categoryId);
        categoryIdsToFilter = [categoryId, ...subCategories.map(c => c.id)];
      } else if (selected) {
        // Sub-category select kora hoyeche, shudhu oi ta-i filter hobe
        categoryIdsToFilter = [categoryId];
        // Parent er sub-category list o dekhabo, jate navigation e context thake
        subCategories = categories.filter(c => c.parent_id == selected.parent_id);
      }
    }

    let sql = `SELECT products.*,
                 COUNT(reviews.id) AS review_count
               FROM products
               LEFT JOIN reviews ON reviews.product_id = products.id
               WHERE 1=1`;
    const params = [];

    if (categoryIdsToFilter.length > 0) {
      sql += ` AND products.category_id IN (${categoryIdsToFilter.map(() => '?').join(',')})`;
      params.push(...categoryIdsToFilter);
    }
    if (search) {
      sql += ' AND products.name LIKE ?';
      params.push(`%${search}%`);
    }

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

    res.render('index', {
      products,
      categories,
      mainCategories,
      subCategories,
      selectedCategory: categoryId,
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
    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).send('Product not found');
    const product = rows[0];

    const [reviews] = await db.query(
      `SELECT reviews.*, users.name AS user_name FROM reviews
       JOIN users ON reviews.user_id = users.id
       WHERE product_id = ? ORDER BY reviews.created_at DESC`,
      [req.params.id]
    );
    const [[avgRow]] = await db.query(
      'SELECT AVG(rating) AS avgRating, COUNT(*) AS reviewCount FROM reviews WHERE product_id = ?',
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

    // Related products: eki category theke, current product bade
    let related = [];
    if (product.category_id) {
      const [relRows] = await db.query(
        'SELECT * FROM products WHERE category_id = ? AND id != ? LIMIT 4',
        [product.category_id, product.id]
      );
      related = relRows;
    }

    const deliveryCharges = await getDeliveryCharges();

    // Long Description-e Admin jodi Markdown (#, ##, *, ** ityadi) use kore
    // thaken, eta ekhane real HTML-e convert kore dilam jate website-e
    // shothikvabe Heading/Bold/List hisebe dekhay, raw # * chinho na dekhiye
    const descriptionHtml = product.description ? marked.parse(product.description) : '';

    res.render('product', {
      product,
      galleryImages,
      options,
      optionLabel,
      variants,
      variantAttributes,
      specs,
      discountPercent,
      related,
      reviews,
      avgRating: avgRow.avgRating ? parseFloat(avgRow.avgRating).toFixed(1) : null,
      reviewCount: avgRow.reviewCount,
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
router.post('/product/:id/review', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  try {
    const { rating, comment } = req.body;
    await db.query(
      'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)',
      [req.params.id, req.session.userId, rating, comment]
    );
    res.redirect('/product/' + req.params.id);
  } catch (err) {
    console.error(err);
    res.status(500).send('Review submit korte problem hoyeche.');
  }
});

// ---------- ADD TO CART ----------
router.post('/cart/add/:id', async (req, res) => {
  try {
    const productId = req.params.id;
    const quantity = parseInt(req.body.quantity) || 1;
    const variantId = req.body.variant_id ? parseInt(req.body.variant_id) : null;
    const optionId = req.body.option_id ? parseInt(req.body.option_id) : null;

    const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
    if (rows.length === 0) return res.status(404).send('Product not found');
    const product = rows[0];

    // Variant select kora thakle, tar price/label niye ashi
    let price = product.price;
    let variantLabel = null;
    if (variantId) {
      const [[variant]] = await db.query('SELECT * FROM product_variants WHERE id = ? AND product_id = ?', [variantId, productId]);
      if (!variant) return res.status(400).send('Selected variant not found.');
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
      if (!option) return res.status(400).send('Selected option not found.');
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
        quantity: quantity
      });
    }

    res.redirect('/cart');
  } catch (err) {
    console.error(err);
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

  // Estimated delivery: aaj theke 3-5 din
  const today = new Date();
  const minDate = new Date(today); minDate.setDate(today.getDate() + 3);
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + 5);
  const dateOpts = { day: 'numeric', month: 'short' };
  const estimatedDelivery = `${minDate.toLocaleDateString('en-GB', dateOpts)} - ${maxDate.toLocaleDateString('en-GB', dateOpts)}`;

  let wishlistProductIds = [];
  if (req.session.userId) {
    const [wl] = await db.query('SELECT product_id FROM wishlist WHERE user_id = ?', [req.session.userId]);
    wishlistProductIds = wl.map(w => w.product_id);
  }

  res.render('cart', {
    cart, subtotal, coupon, discount, total,
    relatedProducts: res.locals.relatedProducts,
    estimatedDelivery,
    wishlistProductIds,
    siteName: 'Goince'
  });
});

// ---------- UPDATE CART QUANTITY (+ / - buttons and manual input, shob eikhane) ----------
router.post('/cart/update/:cartKey', async (req, res) => {
  const cart = req.session.cart || [];
  const item = cart.find(i => (i.cartKey || String(i.id)) === req.params.cartKey);
  if (item) {
    let newQty = Math.max(1, parseInt(req.body.quantity) || 1);

    // Stock er beshi order kora theke atkano (variant thakle variant stock, na hole product stock)
    if (item.variantId) {
      const [rows] = await db.query('SELECT stock FROM product_variants WHERE id = ?', [item.variantId]);
      if (rows.length > 0) newQty = Math.min(newQty, rows[0].stock);
    } else {
      const [rows] = await db.query('SELECT stock FROM products WHERE id = ?', [item.id]);
      if (rows.length > 0) newQty = Math.min(newQty, rows[0].stock);
    }
    item.quantity = Math.max(1, newQty);
  }
  res.redirect('/cart');
});

// ---------- REMOVE FROM CART ----------
router.post('/cart/remove/:cartKey', (req, res) => {
  req.session.cart = (req.session.cart || []).filter(i => (i.cartKey || String(i.id)) !== req.params.cartKey);
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
  res.render('wishlist', { items, siteName: 'Goince' });
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
        req.session.cart.push({ cartKey: String(product.id), id: product.id, variantId: null, variantLabel: null, name: product.name, price: product.price, image: product.image, quantity: 1 });
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

// ---------- CHECKOUT PAGE ----------
router.get('/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/cart');
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = req.session.coupon || null;
  const discount = coupon ? (subtotal * coupon.discount_percent / 100) : 0;
  const deliveryCharges = await getDeliveryCharges();
  const deliveryCharge = deliveryCharges.inside_dhaka; // default, JS diye client-side update hobe
  const total = subtotal - discount + deliveryCharge;
  res.render('checkout', { cart, subtotal, coupon, discount, deliveryCharges, deliveryCharge, total, siteName: 'Goince' });
});

// ---------- PLACE ORDER ----------
router.post('/checkout', async (req, res) => {
  const cart = req.session.cart || [];
  if (cart.length === 0) return res.redirect('/cart');

  const { customer_name, email, phone, address, payment_method, transaction_id, delivery_area } = req.body;
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const coupon = req.session.coupon || null;
  const discount = coupon ? (subtotal * coupon.discount_percent / 100) : 0;
  const deliveryCharges = await getDeliveryCharges();
  const deliveryCharge = deliveryCharges[delivery_area] || deliveryCharges.inside_dhaka;
  const total = subtotal - discount + deliveryCharge;
  const userId = req.session.userId || null;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [orderResult] = await connection.query(
      `INSERT INTO orders (user_id, customer_name, email, phone, address, payment_method, transaction_id, delivery_charge, coupon_code, discount_amount, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, customer_name, email || null, phone, address, payment_method || 'Cash on Delivery', transaction_id || null, deliveryCharge, coupon ? coupon.code : null, discount, total]
    );
    const orderId = orderResult.insertId;

    for (const item of cart) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, product_name, price, quantity, variant_id, variant_label) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [orderId, item.id, item.name, item.price, item.quantity, item.variantId || null, item.variantLabel || null]
      );
      if (item.variantId) {
        await connection.query(
          'UPDATE product_variants SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, item.variantId]
        );
      } else {
        await connection.query(
          'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, item.id]
        );
      }
    }

    await connection.commit();
    req.session.cart = [];
    req.session.coupon = null;

    // Order confirmation email pathano (background e, order response e delay hobe na)
    sendOrderConfirmation(email, { id: orderId, customer_name, items: cart, total: total.toFixed(2) });

    res.render('order-success', { orderId, siteName: 'Goince' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).send('Order placing failed. Please try again.');
  } finally {
    connection.release();
  }
});

module.exports = router;
