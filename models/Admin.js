// backend/routes/adminRoutes.js
const express = require("express");
const { protect, isAdmin } = require("../middleware/authMiddleware");
const Customer = require("../models/customerModel");  // ← use lowercase filename
const router = express.Router();

// Example: admin-only endpoint to list all customers
router.get(
  "/customers",
  protect,
  isAdmin,
  async (req, res) => {
    try {
      const customers = await Customer.find();
      res.json(customers);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
