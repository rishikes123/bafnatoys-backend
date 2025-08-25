const multer = require("multer");

// memoryStorage => files directly RAM me aayengi
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit per file
});

module.exports = upload;
