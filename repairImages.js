require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

// 🔴 YAHAN APNA ASLI IMAGEKIT URL DAALEIN (Dashboard se copy karke) 🔴
const ACTUAL_IMAGEKIT_URL = "https://ik.imagekit.io/rishii"; 

async function repair() {
    try {
        await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
        console.log("✅ Database Connected\n");

        const products = await Product.find({});
        let count = 0;

        for (let p of products) {
            if (p.images && p.images.length > 0) {
                const newImages = p.images.map(img => {
                    if (img.includes('rishii')) {
                        // Purana galat ID hatakar asli wala lagana
                        return img.replace('https://ik.imagekit.io/rishii', ACTUAL_IMAGEKIT_URL);
                    }
                    return img;
                });

                p.images = newImages;
                await p.save();
                count++;
            }
        }

        console.log(`🎉 Success! ${count} products repaired with correct ImageKit URL.`);
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

repair();