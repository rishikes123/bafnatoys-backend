// backend/middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const Customer = require("../models/customerModel"); // match your filename

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No valid token provided" });
    }

    const token = authHeader.substring(7); // remove "Bearer "

    // 1) Verify YOUR JWT (signed with your JWT_SECRET)
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid token" });
    }

    // 2) Attach the customer from your DB
    const customer = await Customer.findById(decoded.id).select("-password");
    if (!customer) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = customer;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
