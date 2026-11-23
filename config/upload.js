// Product image upload er jonno multer configuration
const multer = require('multer');
const path = require('path');

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
    // Product video field-e video file cholbe; baki shob field-e sudhu chobi
    if (file.fieldname === 'video') {
      if (/\.(mp4|webm|mov)$/.test(ext)) return cb(null, true);
      return cb(new Error('Only video files (mp4, webm, mov) are allowed!'));
    }
    if (/\.(jpeg|jpg|png|webp)$/.test(ext)) return cb(null, true);
    cb(new Error('Only image files (jpg, png, webp) are allowed!'));
  }
});

module.exports = upload;
