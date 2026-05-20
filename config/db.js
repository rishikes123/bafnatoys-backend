const mongoose = require("mongoose");
const dns = require("dns");

// ✅ Mobile Hotspot Fix: Force Node.js to use Google DNS for SRV records
// Jio/Airtel hotspots often block MongoDB SRV resolution (ECONNREFUSED)
try {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
  console.log("🌐 DNS Override applied for Mobile Hotspot compatibility.");
} catch (err) {
  console.warn("⚠️ Could not set DNS servers:", err.message);
}

const connectDB = async () => {
  try {
    console.log("⏳ Attempting to connect to MongoDB...");
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 10s or hanging
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("❌ MongoDB Connection Error:", error.message);
    // If it's a timeout, it might be an IP whitelist issue
    if (error.message.includes("selection timed out")) {
      console.error("👉 TIP: Check if your current IP is whitelisted in MongoDB Atlas.");
    }
    process.exit(1);
  }
};

module.exports = connectDB;
