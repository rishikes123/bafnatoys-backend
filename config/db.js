const mongoose = require("mongoose");

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
