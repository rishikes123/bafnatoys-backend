const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Banner = require('../models/bannerModel');
const router = express.Router();

// ensure uploads folder exists
const bannerDir = path.join(__dirname, '..', 'uploads', 'banners');
if (!fs.existsSync(bannerDir)) {
  fs.mkdirSync(bannerDir, { recursive: true });
}

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/banners'),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Only images allowed'), false);
};
const upload = multer({ storage, fileFilter });

// POST /api/banners — upload new banners
router.post('/', upload.array('images', 10), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ message: 'No files uploaded' });

  const saved = await Banner.insertMany(
    req.files.map(file => ({
      imageUrl: `/uploads/banners/${file.filename}`,
      enabled: true
    }))
  );

  res.json({ banners: saved });
});

// GET /api/banners — only enabled banners
router.get('/', async (req, res) => {
  const banners = await Banner.find({ enabled: true });
  res.json(banners);
});

// GET /api/banners/all — all banners (admin)
router.get('/all', async (req, res) => {
  const banners = await Banner.find();
  res.json(banners);
});

// PATCH /api/banners/:id/toggle — enable/disable
router.patch('/:id/toggle', async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) return res.status(404).json({ message: 'Banner not found' });

  banner.enabled = !banner.enabled;
  await banner.save();
  res.json({ message: 'Banner updated', banner });
});

// DELETE /api/banners/:id — delete banner + file
router.delete('/:id', async (req, res) => {
  const banner = await Banner.findById(req.params.id);
  if (!banner) return res.status(404).json({ message: 'Banner not found' });

  const imagePath = path.join(__dirname, '..', banner.imageUrl);
  fs.unlink(imagePath, err => {
    if (err) console.warn("⚠️ Failed to delete image file:", err.message);
  });

  await banner.deleteOne();
  res.json({ message: 'Banner deleted successfully' });
});

module.exports = router;
