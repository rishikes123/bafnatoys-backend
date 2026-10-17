const mongoose = require("mongoose");
const dns = require("dns");

const provider = process.env.DB_PROVIDER || "mongodb";
if (!["mongodb", "postgres"].includes(provider)) {
  throw new Error("DB_PROVIDER must be mongodb or postgres");
}
// Configure before models are imported so validation, hooks and populate use the same connection.
if (provider === "postgres") {
  mongoose.setDriver(require("../database/postgres/driver"));
}
require("../middleware/migrationReadOnly").guardMongoWrites();

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
    if (provider === "postgres") {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL");
      await mongoose.connect(process.env.DATABASE_URL);
      console.log("✅ PostgreSQL connected; verified migration loaded");
      return mongoose;
    }
    console.log("⏳ Attempting to connect to MongoDB...");
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 10s or hanging
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ ${provider} connection failed:`, error.name);
    // If it's a timeout, it might be an IP whitelist issue
    if (error.message.includes("selection timed out")) {
      console.error("👉 TIP: Check if your current IP is whitelisted in MongoDB Atlas.");
    }
    process.exit(1);
  }
};

module.exports = connectDB;
