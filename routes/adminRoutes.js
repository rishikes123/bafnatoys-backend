// routes/adminRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');          // ✅ add this
const router = express.Router();
const Registration = require('../models/Registration');

// ✅ ADMIN LOGIN (POST /api/admin/login)
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ message: 'Username & password required' });
  }

  // env se compare
  if (username !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASS) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'admin', user: process.env.ADMIN_USER },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );

  res.json({ message: 'Admin login successful', token });
});

// (optional) quick debug: GET /api/admin/ping
router.get('/ping', (_req, res) => res.json({ ok: true }));

// ===== your existing routes below =====

// GET all registered users (pending + approved)
router.get('/customers', async (req, res) => {
  try {
    const users = await Registration.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH to approve a user
router.patch('/approve/:id', async (req, res) => {
  try {
    const user = await Registration.findByIdAndUpdate(
      req.params.id,
      { isApproved: true },
      { new: true }
    );
    res.json({ message: 'User approved', user });
  } catch (err) {
    res.status(500).json({ message: 'Approval failed' });
  }
});

// DELETE a user (optional)
router.delete('/customer/:id', async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Delete failed' });
  }
});

module.exports = router;
