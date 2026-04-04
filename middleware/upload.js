const multer = require("multer");

// Ab hum files ko seedha memory (buffer) mein rakhenge
// Taaki controllers (jaise auth.js ya productRoutes.js) usko ImageKit par bhej sakein
const storage = multer.memoryStorage();

// File size ki limit 10MB rakh rahe hain (Images aur PDFs dono ke liye kaafi hai)
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB limit
    }
});

module.exports = upload;