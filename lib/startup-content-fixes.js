// Startup content fixes (fix/full-width-hero-cleanup) — ekbar-er data
// bodol, code-e noy: server start howar shomoy chole, ar protibar chola
// nirapad (idempotent). Kono row na mille UPDATE 0 row bodlay, tai
// dwitiyo bar cholleo kichu hoy na.
//
// 1. Hero copy: live DB-te hero_title 'Hi' ar hero_subtitle Banglish-e
//    save ache (admin theke kono ek somoy bosano). Code default bodlale
//    live site bodlabe na — setting DB-te thake — tai ekhane sudhu
//    HUBOHU oi duto value mille notun Bangla copy diye bodle deya hoy.
//    Admin pore nijer moto title/subtitle likhle seta ar chhoya hobe na.
// 2. Product-er naam-er banan: 'wastren'/'tow' thaka A.T.Z dress-er
//    naam-ta HUBOHU mille thik kora hoy — slug, daam, stock kichu
//    bodlano hoy na.
'use strict';

const HERO_TITLE_OLD = 'Hi';
const HERO_TITLE_NEW = 'সেরা পণ্য, ক্যাশ অন ডেলিভারি';
const HERO_SUBTITLE_OLD = 'Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine delivery. Order korar age phone-e confirm kora hoy.';
const HERO_SUBTITLE_NEW = 'ঢাকার ভিতরে ১–২ দিনে, ঢাকার বাইরে ৩–৫ দিনে ডেলিভারি। অর্ডারের আগে ফোনে কনফার্ম করা হয়।';

const PRODUCT_OLD_NAME = 'A.T.Z New collection Hit wastren dress tow piece Tops For Women';
const PRODUCT_NEW_NAME = 'A.T.Z New Collection Hit Western Dress Two Piece Tops For Women';

// Footer "About" text: the stored value lost its last letters and reads
// "...3–5 dine deliver" in the footer. Only the exact truncated value
// is repaired — a custom footer text is never touched. The replacement is
// consistent English (the old text mixed Romanized Bangla and English in
// one sentence: "Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine delivery.").
const FOOTER_ABOUT_TRUNCATED = 'Bangladesh-er online shop — Cash on Delivery, Dhaka-r vitore 1–2 din, Dhaka-r baire 3–5 dine deliver';
const FOOTER_ABOUT_TRUNCATED_DOT = FOOTER_ABOUT_TRUNCATED + '.';
const FOOTER_ABOUT_FULL = 'Online shop in Bangladesh — Cash on Delivery, delivery in 1–2 days inside Dhaka, 3–5 days outside Dhaka.';

// Delivery time text: the stored zones say "1-2 din" / "3-5 din" while
// the placeholders and the code fallbacks say "days" — one wording
// ("days") everywhere. Only the exact old values are normalised.

// Hero title/subtitle: shudhu HUBOHU purono value thakle bodlay.
async function fixHeroCopy(db) {
  await db.query(
    'UPDATE settings SET setting_value = ? WHERE setting_key = ? AND setting_value = ?',
    [HERO_TITLE_NEW, 'hero_title', HERO_TITLE_OLD]);
  await db.query(
    'UPDATE settings SET setting_value = ? WHERE setting_key = ? AND setting_value = ?',
    [HERO_SUBTITLE_NEW, 'hero_subtitle', HERO_SUBTITLE_OLD]);
}

// Product-er naam: shudhu HUBOHU purono naam mille bodlay.
async function fixProductName(db) {
  await db.query(
    'UPDATE products SET name = ? WHERE name = ?',
    [PRODUCT_NEW_NAME, PRODUCT_OLD_NAME]);
}

// Footer About: shudhu kata (truncated) value mille purno bakko diye bodlay.
async function fixFooterAbout(db) {
  await db.query(
    'UPDATE settings SET setting_value = ? WHERE setting_key = ? AND setting_value = ?',
    [FOOTER_ABOUT_FULL, 'footer_about', FOOTER_ABOUT_TRUNCATED]);
  await db.query(
    'UPDATE settings SET setting_value = ? WHERE setting_key = ? AND setting_value = ?',
    [FOOTER_ABOUT_FULL, 'footer_about', FOOTER_ABOUT_TRUNCATED_DOT]);
}

// Delivery Zones-er somoy: shudhu HUBOHU '1-2 din' / '3-5 din' mille
// 'days' diye bodlay — charge, naam, status kichu bodlano hoy na.
async function fixDeliveryTimeText(db) {
  await db.query(
    "UPDATE delivery_zones SET delivery_time = '1–2 days' WHERE delivery_time = '1-2 din'");
  await db.query(
    "UPDATE delivery_zones SET delivery_time = '3–5 days' WHERE delivery_time = '3-5 din'");
}

module.exports = {
  fixHeroCopy,
  fixProductName,
  fixFooterAbout,
  fixDeliveryTimeText,
  HERO_TITLE_OLD,
  HERO_TITLE_NEW,
  HERO_SUBTITLE_OLD,
  HERO_SUBTITLE_NEW,
  PRODUCT_OLD_NAME,
  PRODUCT_NEW_NAME,
};
