/**
 * One-off cleanup: stock ko kabhi negative nahi hona chahiye.
 * Purane delivered orders ne stock ko minus me le liya tha (e.g. -3),
 * jisse site "Only -3 left!" dikha rahi thi. Ye script un sabko 0 kar deti hai.
 *
 * Run: node scripts/fixNegativeStock.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB Connected");

    const affected = await Product.find({ stock: { $lt: 0 } })
      .select("name sku stock")
      .lean();

    if (affected.length === 0) {
      console.log("👍 Koi negative stock nahi mila. Kuch change nahi kiya.");
    } else {
      affected.forEach((p) =>
        console.log(`  ${p.sku || "-"}  ${p.name}  ->  ${p.stock} → 0`)
      );
      const result = await Product.updateMany(
        { stock: { $lt: 0 } },
        { $set: { stock: 0 } }
      );
      console.log(`✅ ${result.modifiedCount} products ka stock 0 kar diya.`);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
