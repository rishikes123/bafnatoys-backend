require('dotenv').config();
const mongoose = require('mongoose');

// Models
const Product = require('./models/Product');
const Banner = require('./models/bannerModel');
const Category = require('./models/categoryModel');

// 🔴 APNA ASLI IMAGEKIT URL ENDPOINT YAHAN DAALEIN 🔴
// Niche diye gaye URL ko apne ImageKit dashboard wale URL se replace karein
const IMAGEKIT_ENDPOINT = "https://ik.imagekit.io/YOUR_IMAGEKIT_ID"; 

// 🔴 DRY_RUN KO FALSE KAR DIYA GAYA HAI 🔴
// Ab ye script run hone par database mein seedha save karegi
const DRY_RUN = false; 

function getNewImageUrl(oldUrl) {
    if (!oldUrl || !oldUrl.includes('cloudinary.com')) return oldUrl;

    try {
        const urlObj = new URL(oldUrl);
        let cleanPath = urlObj.pathname.replace(/^\/.*\/image\/upload\/v\d+/, '');
        return `${IMAGEKIT_ENDPOINT}${cleanPath}`;
    } catch (e) {
        return oldUrl;
    }
}

async function runMigration() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
        console.log("✅ Database Connected Successfully\n");

        if (DRY_RUN) console.log("⚠️ DRY RUN MODE ON: Database me kuch save nahi hoga. Sirf URLs check karein.\n");
        else console.log("🔥 LIVE MODE ON: Database me changes SAVE ho rahe hain!\n");

        // --- 1. Update Products ---
        const products = await Product.find({});
        console.log(`📦 Found ${products.length} Products. Updating URLs...`);
        let productUpdates = 0;

        for (let p of products) {
            let changed = false;
            if (p.images && p.images.length > 0) {
                const newImages = p.images.map(img => {
                    if (img.includes('cloudinary.com')) {
                        changed = true;
                        return getNewImageUrl(img);
                    }
                    return img;
                });

                if (changed) {
                    p.images = newImages;
                    productUpdates++;
                    if (!DRY_RUN) await p.save();
                }
            }
        }
        console.log(`✅ Products updated: ${productUpdates}\n`);

        // --- 2. Update Banners ---
        const banners = await Banner.find({});
        console.log(`🖼️ Found ${banners.length} Banners. Updating URLs...`);
        let bannerUpdates = 0;

        for (let b of banners) {
            if (b.image && b.image.includes('cloudinary.com')) {
                b.image = getNewImageUrl(b.image);
                bannerUpdates++;
                if (!DRY_RUN) await b.save();
            }
        }
        console.log(`✅ Banners updated: ${bannerUpdates}\n`);

        console.log("🎉 Migration Process Finished Successfully!");
        process.exit();

    } catch (error) {
        console.error("❌ Error during migration:", error);
        process.exit(1);
    }
}

runMigration();