const express = require("express");
const router = express.Router();
const Address = require("../models/Address"); // mongoose model banana hoga
const { protect } = require("../middleware/authMiddleware");

// GET all addresses of logged-in user
router.get("/", protect, async (req, res) => {
  try {
    const addresses = await Address.find({ user: req.user._id });
    res.json(addresses);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ADD new address
router.post("/", protect, async (req, res) => {
  try {
    const address = new Address({ ...req.body, user: req.user._id });
    const saved = await address.save();
    res.json(saved);
  } catch (err) {
    res.status(400).json({ message: "Invalid data", error: err.message });
  }
});

// UPDATE address
router.put("/:id", protect, async (req, res) => {
  try {
    const updated = await Address.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      req.body,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: "Update failed" });
  }
});

// DELETE address
router.delete("/:id", protect, async (req, res) => {
  try {
    await Address.findOneAndDelete({ _id: req.params.id, user: req.user._id });
    res.json({ message: "Address deleted" });
  } catch (err) {
    res.status(400).json({ message: "Delete failed" });
  }
});

module.exports = router;
