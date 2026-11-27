// Asset cache-busting: local CSS/JS-er version file-er mtime theke neoa hoy,
// jate deploy-e file bodle gele browser notun file-ta-i ane. Age version
// chhilo na bole purono cached CSS-e notun mobile drawer bina style-e
// desktop-e dekhacchilo (PR #39-er por duita browser-e dhora poreche).
// File na bodle version-o bodlay na, tai caching noshto hoy na.
const fs = require('fs');
const path = require('path');

const ASSETS = ['css/style.css', 'js/theme.js', 'js/mega-menu.js', 'js/admin-push.js', 'js/admin-dropdowns.js', 'js/product-gallery.js', 'js/click-ripple.js'];

function assetVersion(publicDir, relPath) {
  try {
    return String(Math.floor(fs.statSync(path.join(publicDir, relPath)).mtimeMs));
  } catch (e) { return '1'; }
}

function createAssetUrl(publicDir) {
  const versions = {};
  ASSETS.forEach(function (rel) { versions[rel] = assetVersion(publicDir, rel); });
  return function assetUrl(urlPath) {
    const clean = String(urlPath || '').replace(/^\//, '');
    return '/' + clean + '?v=' + (versions[clean] || '1');
  };
}

module.exports = { assetVersion, createAssetUrl, ASSETS };
