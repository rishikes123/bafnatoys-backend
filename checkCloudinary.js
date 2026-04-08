require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

async function check() {
    await mongoose.connect(process.env.MONGO_URI || process.env.DATABASE_URL);
    
    // Wo products dhoondho jinme abhi bhi 'cloudinary' likha hai
    const products = await Product.find({ images: { $regex: /cloudinary/i } });
    
    console.log(`🔍 Total ${products.length} products abhi bhi Cloudinary use kar rahe hain:`);
    
    products.forEach(p => {
        console.log(`- ${p.name} (SKU: ${p.sku})`);
    });

    process.exit();
}

check();