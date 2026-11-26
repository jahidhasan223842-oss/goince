// Admin profile helpers (fix/admin-profile-photo): profile-details
// validation + profile-photo cropping. Pure functions so the test suite
// can exercise them without a live database.
'use strict';

const sharp = require('sharp');
const { normalizeBdPhone, isValidBdPhone } = require('./bd-phone');

// Profile photo: saved as a 256x256 WebP square.
const PROFILE_PHOTO_SIZE = 256;

// Display name: 1–60 characters. Phone: optional, but when given it must
// be a valid Bangladeshi mobile number (same rule as the shop checkout).
// Returns { ok, errors, displayName, phone } — displayName is null when
// blank (falls back to the email local part), phone is the normalized
// 01XXXXXXXXX form or null when blank.
function validateProfileDetails(input) {
  const errors = [];
  const rawName = String((input && input.displayName) || '').trim();
  const rawPhone = String((input && input.phone) || '').trim();
  let displayName = null;
  let phone = null;
  if (rawName.length > 0) {
    if (rawName.length > 60) errors.push('name');
    else displayName = rawName;
  }
  if (rawPhone.length > 0) {
    if (!isValidBdPhone(rawPhone)) errors.push('phone');
    else phone = normalizeBdPhone(rawPhone);
  }
  return { ok: errors.length === 0, errors, displayName, phone };
}

// Crop fractions sent by the browser (fractions of the image's own width /
// height: x, y in [0, 1], size in (0, 1] — size is relative to the SHORTER
// side, so the crop is always a square). Missing / bad values fall back
// to a centred square. Everything is clamped to the image bounds, so a
// crafted request can never make sharp read outside the image.
// Returns { buffer, width, height, format } — always 256x256 WebP.
async function cropProfilePhoto(buffer, crop) {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  if (!w || !h) throw new Error('Could not read the photo.');
  const minSide = Math.min(w, h);
  let size = Math.round((crop && isFinite(Number(crop.size)) ? Number(crop.size) : 1) * minSide);
  size = Math.max(1, Math.min(size, minSide));
  let left;
  let top;
  // Default (no crop sent): centre the square.
  if (crop && isFinite(Number(crop.x))) left = Math.round(Number(crop.x) * w);
  else left = Math.round((w - size) / 2);
  if (crop && isFinite(Number(crop.y))) top = Math.round(Number(crop.y) * h);
  else top = Math.round((h - size) / 2);
  left = Math.max(0, Math.min(left, w - size));
  top = Math.max(0, Math.min(top, h - size));
  const out = await sharp(buffer)
    .extract({ left, top, width: size, height: size })
    .resize(PROFILE_PHOTO_SIZE, PROFILE_PHOTO_SIZE)
    .webp({ quality: 80 })
    .toBuffer();
  return { buffer: out, width: PROFILE_PHOTO_SIZE, height: PROFILE_PHOTO_SIZE, format: 'webp' };
}

// Email change (fix/admin-theme-hover-profile): the new address must be a
// well-formed email, must match its confirmation, and must differ from
// the current address. The caller checks the current password and that
// no other admin already uses the address (both need the DB, so they
// live in the route, not here). Returns { ok, errors, email } — email is
// the trimmed, lower-cased new address, or null when invalid.
function validateEmailChange(input) {
  const errors = [];
  const current = String((input && input.currentEmail) || '').trim().toLowerCase();
  const rawNew = String((input && input.newEmail) || '').trim().toLowerCase();
  const rawConfirm = String((input && input.confirmEmail) || '').trim().toLowerCase();
  let email = null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawNew)) errors.push('email');
  else if (rawNew !== rawConfirm) errors.push('emailmatch');
  else if (current && rawNew === current) errors.push('emailsame');
  else email = rawNew;
  return { ok: errors.length === 0, errors, email };
}

module.exports = { PROFILE_PHOTO_SIZE, validateProfileDetails, validateEmailChange, cropProfilePhoto };
