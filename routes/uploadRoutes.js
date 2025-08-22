// backend/routes/uploadRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

/* ----------------- Storage setup ----------------- */
const uploadDir = path.join(__dirname, "..", "uploads");

// ensure uploads folder exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const uniqueName = `${Date.now()}-${base}${ext}`;
    cb(null, uniqueName);
  },
});

/* ----------------- File filter (optional security) ----------------- */
const fileFilter = (req, file, cb) => {
  const allowed = /jpg|jpeg|png|gif/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Only images are allowed (jpg, jpeg, png, gif)"));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max per file
  fileFilter,
});

/* ----------------- Routes ----------------- */
// POST /api/upload (multiple)
router.post("/", upload.array("images", 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: "No files uploaded" });
  }
  const urls = req.files.map((file) => `/uploads/${file.filename}`);
  res.status(200).json({ urls });
});

module.exports = router;
