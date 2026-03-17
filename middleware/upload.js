const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// ✅ Cloudinary storage setup
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "bafnatoys", 
    // ✅ Added "pdf" to allowed formats
    allowed_formats: ["jpg", "jpeg", "png", "gif", "webp", "pdf"], 
    // ✅ Added resource_type: "auto" so Cloudinary accepts both images and documents
    resource_type: "auto", 
  },
});

const upload = multer({ storage });

module.exports = upload;