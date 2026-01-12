const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload"); // multer middleware
const Registration = require("../models/Registration");

// Helper to normalize phone
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

/* ------------------------------ REGISTER ----------------------------- */
// POST /api/registrations/register
router.post("/register", upload.single("visitingCard"), async (req, res) => {
  try {
    const { shopName, address, otpMobile, whatsapp, password } = req.body;

    if (!shopName || !otpMobile || !address) {
      return res.status(400).json({ message: "Please fill Shop Name, Mobile, and Address." });
    }

    const nMobile = normalizePhone(otpMobile);
    const nWhats = whatsapp ? normalizePhone(whatsapp) : "";

    // Duplicate Check
    const dup = await Registration.findOne({ otpMobile: nMobile });
    if (dup) {
      return res.status(409).json({ message: "Mobile number already registered." });
    }

    // Handle Optional Visiting Card
    const visitingCardUrl = req.file ? req.file.path : "";

    const doc = await Registration.create({
      shopName,
      address,
      otpMobile: nMobile,
      whatsapp: nWhats,
      password,
      visitingCardUrl,
      
      // ✅ CHANGE: Auto-Approve (Approval System Removed)
      isApproved: true, 
    });

    res.status(201).json({
      success: true,
      // ✅ Message updated
      message: "✅ Registration successful! You can login now.",
      user: doc,
    });

  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/* ------------------------------- LIST ------------------------------- */
router.get("/", async (_req, res) => {
  try {
    const users = await Registration.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

/* --------------------------- FIND BY PHONE -------------------------- */
router.get("/phone/:otpMobile", async (req, res) => {
  try {
    const raw = normalizePhone(req.params.otpMobile);
    const user = await Registration.findOne({ otpMobile: raw });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

/* ------------------------------- UPDATE ------------------------------ */
router.put("/:id", upload.single("visitingCard"), async (req, res) => {
  try {
    const id = req.params.id;
    const allowed = [
      "shopName", "address", "otpMobile", "whatsapp", "visitingCardUrl", "password",
    ];

    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    if (update.otpMobile) update.otpMobile = normalizePhone(update.otpMobile);
    if (update.whatsapp) update.whatsapp = normalizePhone(update.whatsapp);

    if (req.file) update.visitingCardUrl = req.file.path;

    const doc = await Registration.findByIdAndUpdate(id, update, { new: true });
    if (!doc) return res.status(404).json({ message: "Registration not found" });

    res.json(doc);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ message: err.message || "Failed to update profile" });
  }
});

/* -------------------------- APPROVE / REJECT (Optional Now) ------------------------- */
router.post("/:id/approve", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.json({ message: "✅ User approved" });
  } catch (err) {
    res.status(500).json({ message: "Approval failed" });
  }
});

router.post("/:id/reject", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: false });
    res.json({ message: "❌ User rejected" });
  } catch (err) {
    res.status(500).json({ message: "Rejection failed" });
  }
});

/* ------------------------------- DELETE ------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "🗑️ User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;