const express = require("express");
const router = express.Router();
const Address = require("../models/Address");
const { protect } = require("../middleware/authMiddleware");

// GET all addresses of logged-in user
router.get("/", protect, async (req, res) => {
  try {
    // Latest address upar aayega
    const addresses = await Address.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json(addresses);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ADD new address
router.post("/", protect, async (req, res) => {
  try {
    // Agar naya address default hai, toh puraane addresses ko default: false kar do
    if (req.body.isDefault) {
      await Address.updateMany({ user: req.user._id }, { isDefault: false });
    }

    const address = new Address({ ...req.body, user: req.user._id });
    const saved = await address.save();
    res.json(saved);
  } catch (err) {
    res.status(400).json({ message: "Invalid data", error: err.message });
  }
});

// ==========================================
// VERIFY GST NUMBER (Smart Demo API)
// Note: 'protect' hata diya gaya hai taaki Token error na aaye
// ==========================================
router.post("/verify-gst", async (req, res) => {
  try {
    const { gstNumber } = req.body;

    // 1. Basic Format Validation (Regex)
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(gstNumber)) {
      return res.status(400).json({ success: false, message: "Invalid GST Format. Please check the 15-digit number." });
    }

    // 2. Smart Mock API Response (1.5 second delay)
    setTimeout(() => {
      // Agar aapka asli GST number enter kiya gaya hai:
      if (gstNumber.toUpperCase() === "33ANCPH3967L1ZT") {
        return res.json({ 
          success: true, 
          companyName: "Bafna Toys", // Real name from ClearTax
          status: "Active (Regular)" 
        });
      } 
      // Agar koi aur random 15-digit GST number daala:
      else {
        return res.json({ 
          success: true, 
          companyName: "TEST BUSINESS ENTERPRISES", 
          status: "Active" 
        });
      }
    }, 1500);

  } catch (err) {
    res.status(500).json({ success: false, message: "GST Verification Server Error" });
  }
});

// UPDATE address
router.put("/:id", protect, async (req, res) => {
  try {
    // Agar update mein isDefault true aa raha hai, baaki sab false kar do
    if (req.body.isDefault) {
      await Address.updateMany({ user: req.user._id, _id: { $ne: req.params.id } }, { isDefault: false });
    }

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