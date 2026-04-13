// backend/routes/adminRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const Registration = require("../models/Registration");
const { adminProtect, isAdmin } = require("../middleware/authMiddleware");

// ADMIN LOGIN (public - no auth needed)
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: "Username & password required" });
  }

  if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASS) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    { role: "admin", user: process.env.ADMIN_USER },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || "7d" }
  );

  res.json({ message: "Admin login successful", token });
});

// GET all customers with pagination (admin only)
router.get("/customers", adminProtect, isAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      Registration.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Registration.countDocuments(),
    ]);

    res.json({
      customers,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        limit,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Approve a customer (admin only)
router.patch("/approve/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    const user = await Registration.findByIdAndUpdate(
      req.params.id,
      { isApproved: true },
      { new: true }
    );
    res.json({ message: "User approved", user });
  } catch (err) {
    res.status(500).json({ message: "Approval failed" });
  }
});

// Delete a customer (admin only)
router.delete("/customer/:id", adminProtect, isAdmin, async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
