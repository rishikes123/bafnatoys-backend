require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const cloudinary = require("../config/cloudinary");

// Models
const Product = require("../models/productModel");
const Banner = require("../models/bannerModel");

const migrateImages = async () => {
  try {
    // 1. Connect MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");

    // 2. Process Products
    const products = await Product.find({});
    for (const product of products) {
      let updated = false;

      const newImages = [];
      for (const img of product.images || []) {
        if (img.startsWith("/uploads/")) {
          const localPath = path.join(__dirname, "..", img);
          if (fs.existsSync(localPath)) {
            console.log("📤 Uploading:", localPath);

            const result = await cloudinary.uploader.upload(localPath, {
              folder: "bafnatoys",
            });
            newImages.push(result.secure_url);
            updated = true;
          } else {
            console.log("⚠️ File not found locally:", localPath);
          }
        } else {
          newImages.push(img); // already Cloudinary
        }
      }

      if (updated) {
        product.images = newImages;
        await product.save();
        console.log(`✅ Updated product: ${product.name}`);
      }
    }

    // 3. Process Banners (if you store banner images the same way)
    const banners = await Banner.find({});
    for (const banner of banners) {
      if (banner.image && banner.image.startsWith("/uploads/")) {
        const localPath = path.join(__dirname, "..", banner.image);
        if (fs.existsSync(localPath)) {
          console.log("📤 Uploading banner:", localPath);

          const result = await cloudinary.uploader.upload(localPath, {
            folder: "bafnatoys/banners",
          });
          banner.image = result.secure_url;
          await banner.save();
          console.log(`✅ Updated banner: ${banner._id}`);
        }
      }
    }

    console.log("🎉 Migration complete");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
};

migrateImages();
