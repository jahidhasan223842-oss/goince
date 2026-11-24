// Product image upload er jonno multer configuration
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// WebP quality: 80 — chobi porishkar thake, file size-o onek choto hoy.
const WEBP_QUALITY = 80;

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    // Product video field-e video file cholbe; CSV import field-e csv file
    // cholbe (products/categories import); baki shob field-e sudhu chobi
    if (file.fieldname === 'video') {
      if (/\.(mp4|webm|mov)$/.test(ext)) return cb(null, true);
      return cb(new Error('Only video files (mp4, webm, mov) are allowed!'));
    }
    if (file.fieldname === 'csv') {
      if (/\.csv$/.test(ext)) return cb(null, true);
      return cb(new Error('Only CSV files are allowed!'));
    }
    if (/\.(jpeg|jpg|png|gif|webp)$/.test(ext)) return cb(null, true);
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed!'));
  }
});

// Upload howa chobi WebP-e convert kore — multer-er pore, route handler-er
// age boshe. Je file already .webp, seta jemon ache temon-i thake. Video
// (video field) ba CSV (csv field) choya hoy na. Convert korte na parle
// upload fail kore (porishkar error) — ashol format-e chupchap save hoy na.
async function convertOneFileToWebP(file) {
  const ext = path.extname(file.filename).toLowerCase();
  if (ext === '.webp') return;
  const webpPath = file.path.replace(/\.[^.]+$/, '.webp');
  await sharp(file.path).webp({ quality: WEBP_QUALITY }).toFile(webpPath);
  const stat = fs.statSync(webpPath);
  fs.unlinkSync(file.path);
  file.filename = path.basename(webpPath);
  file.path = webpPath;
  file.size = stat.size;
  file.mimetype = 'image/webp';
}

function convertImagesToWebP(req, res, next) {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    for (const fieldFiles of Object.values(req.files)) files.push(...fieldFiles);
  }
  const imageFiles = files.filter((f) => f.fieldname !== 'video' && f.fieldname !== 'csv');
  (async () => {
    try {
      for (const file of imageFiles) await convertOneFileToWebP(file);
      next();
    } catch (err) {
      // Ordhek convert hoye thakleo kono ashol file jeno na thake — ja
      // upload hoyeche sob muche fela hoy, tarpor error dekhano hoy.
      for (const file of imageFiles) {
        try { if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (e) { /* ignore */ }
      }
      console.error('Image to WebP conversion failed:', err.message);
      next(new Error('Photo WebP-e convert kora jayni — onno ekti photo diye abar chesta korun.'));
    }
  })();
}

upload.convertToWebP = convertImagesToWebP;
upload.WEBP_QUALITY = WEBP_QUALITY;

module.exports = upload;
