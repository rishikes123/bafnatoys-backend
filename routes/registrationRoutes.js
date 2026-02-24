const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload"); // multer middleware
const Registration = require("../models/Registration");

// Helper to normalize phone (10 digits only)
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

// ✅ NEW: WhatsApp ko always 91 + 10 digits me convert karo
const normalizeWhatsApp91 = (v = "") => {
  const digits = String(v).replace(/\D/g, ""); // only numbers
  const without91 = digits.startsWith("91") ? digits.slice(2) : digits; // remove 91 if present
  const last10 = without91.length > 10 ? without91.slice(-10) : without91; // take last 10
  if (last10.length !== 10) return ""; // invalid
  return "91" + last10; // ✅ final 91XXXXXXXXXX
};

/* ------------------------------ REGISTER ----------------------------- */
// POST /api/registrations/register
router.post("/register", upload.single("visitingCard"), async (req, res) => {
  try {
    const { shopName, address, otpMobile, whatsapp, password } = req.body;

    // ✅ WhatsApp compulsory
    if (!shopName || !otpMobile || !address || !whatsapp) {
      return res.status(400).json({ message: "Please fill Shop Name, Mobile, WhatsApp, and Address." });
    }

    const nMobile = normalizePhone(otpMobile);

    // ✅ WhatsApp always with 91
    const nWhats = normalizeWhatsApp91(whatsapp);
    if (!nWhats) {
      return res.status(400).json({ message: "Invalid WhatsApp number. Enter 10 digit WhatsApp number." });
    }

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
      whatsapp: nWhats, // ✅ saved as 91XXXXXXXXXX
      password,
      visitingCardUrl,

      // ✅ Auto-Approve
      isApproved: true,
    });

    res.status(201).json({
      success: true,
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

    // ✅ Update WhatsApp bhi always 91 format me
    if (update.whatsapp !== undefined) {
      const w = normalizeWhatsApp91(update.whatsapp);
      if (!w) return res.status(400).json({ message: "Invalid WhatsApp number." });
      update.whatsapp = w;
    }

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