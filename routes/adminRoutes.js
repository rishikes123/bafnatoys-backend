// backend/routes/adminRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const Registration = require("../models/Registration"); // ✅ correct file

// ADMIN LOGIN
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

// GET all customers (registrations)
router.get("/customers", async (req, res) => {
  try {
    const customers = await Registration.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Approve a customer
router.patch("/approve/:id", async (req, res) => {
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

// Delete a customer
router.delete("/customer/:id", async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
