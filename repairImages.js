require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

// ✅ Aapka asli ImageKit ID (rishii) maine add kar diya hai
const ACTUAL_IMAGEKIT_URL = "https://ik.imagekit.io/rishii"; 

async function finalRepair() {
    try {
        // Database connection
        await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
        console.log("✅ Database Connected. Repairing YOUR_IMAGEKIT_ID -> rishii...");

        const products = await Product.find({});
        let count = 0;

        for (let p of products) {
            let changed = false;
            if (p.images && p.images.length > 0) {
                const newImages = p.images.map(img => {
                    // Agar link mein galat 'YOUR_IMAGEKIT_ID' hai
                    if (img && img.includes('YOUR_IMAGEKIT_ID')) {
                        changed = true;
                        // Use asli ID 'rishii' se badal rahe hain
                        return img.replace('YOUR_IMAGEKIT_ID', 'rishii');
                    }
                    return img;
                });

                if (changed) {
                    p.images = newImages;
                    // Database me save karna
                    await p.save();
                    count++;
                }
            }
        }

        console.log(`\n🎉 Balle Balle! ${count} products ke links 'rishii' par update ho gaye hain.`);
        console.log("👉 Ab aap apni website refresh karke check kar sakte hain.");
        process.exit();
    } catch (err) {
        console.error("❌ Error during repair:", err);
        process.exit(1);
    }
}

finalRepair();