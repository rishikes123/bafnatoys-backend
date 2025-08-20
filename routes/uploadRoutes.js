const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();

// Storage setup for uploaded images
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, 'uploads/'); // make sure this folder exists
  },
  filename(req, file, cb) {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

// POST /api/upload (for multiple image uploads)
router.post('/', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' });
  }

  const urls = req.files.map((file) => `/uploads/${file.filename}`);
  res.status(200).json({ urls });
});

module.exports = router;
