const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload"); // multer middleware
const Registration = require("../models/Registration");

// Helper to normalize phone (10 digits only)
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
};

// WhatsApp format always 91 + 10 digits
const normalizeWhatsApp91 = (v = "") => {
  const digits = String(v).replace(/\D/g, ""); 
  const without91 = digits.startsWith("91") ? digits.slice(2) : digits; 
  const last10 = without91.length > 10 ? without91.slice(-10) : without91; 
  if (last10.length !== 10) return ""; 
  return "91" + last10; 
};

/* ------------------------------ REGISTER ----------------------------- */
// POST /api/registrations/register
// ✅ UPDATED: Accept both visitingCard and gstDocument fields via multer
router.post("/register", upload.fields([{ name: 'visitingCard', maxCount: 1 }, { name: 'gstDocument', maxCount: 1 }]), async (req, res) => {
  try {
    const { shopName, address, otpMobile, whatsapp, password } = req.body;

    // Validation
    if (!shopName || !otpMobile || !address || !whatsapp) {
      return res.status(400).json({ message: "Please fill Shop Name, Mobile, WhatsApp, and Address." });
    }

    const nMobile = normalizePhone(otpMobile);
    const nWhats = normalizeWhatsApp91(whatsapp);
    
    if (!nWhats) {
      return res.status(400).json({ message: "Invalid WhatsApp number. Enter 10 digit WhatsApp number." });
    }

    // Duplicate Check
    const dup = await Registration.findOne({ otpMobile: nMobile });
    if (dup) {
      return res.status(409).json({ message: "Mobile number already registered." });
    }

    // ✅ Handle Multiple Optional File Uploads 
    let visitingCardUrl = "";
    let gstDocumentUrl = "";

    if (req.files) {
      if (req.files['visitingCard']) {
        visitingCardUrl = req.files['visitingCard'][0].path;
      }
      if (req.files['gstDocument']) {
        gstDocumentUrl = req.files['gstDocument'][0].path;
      }
    }

    const doc = await Registration.create({
      shopName,
      address,
      otpMobile: nMobile,
      whatsapp: nWhats, 
      password,
      visitingCardUrl,
      gstDocumentUrl, // ✅ Saved GST Document to database
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
// ✅ UPDATED: Use upload.fields() here as well if updating files
router.put("/:id", upload.fields([{ name: 'visitingCard', maxCount: 1 }, { name: 'gstDocument', maxCount: 1 }]), async (req, res) => {
  try {
    const id = req.params.id;
    // ✅ Replaced gstNumber with gstDocumentUrl in allowed updates list
    const allowed = [
      "shopName", "address", "otpMobile", "whatsapp", "visitingCardUrl", "password", "gstDocumentUrl"
    ];

    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    if (update.otpMobile) update.otpMobile = normalizePhone(update.otpMobile);

    if (update.whatsapp !== undefined) {
      const w = normalizeWhatsApp91(update.whatsapp);
      if (!w) return res.status(400).json({ message: "Invalid WhatsApp number." });
      update.whatsapp = w;
    }

    // ✅ Extract and assign files properly
    if (req.files) {
      if (req.files['visitingCard']) {
        update.visitingCardUrl = req.files['visitingCard'][0].path;
      }
      if (req.files['gstDocument']) {
        update.gstDocumentUrl = req.files['gstDocument'][0].path;
      }
    }

    const doc = await Registration.findByIdAndUpdate(id, update, { new: true });
    if (!doc) return res.status(404).json({ message: "Registration not found" });

    res.json(doc);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ message: err.message || "Failed to update profile" });
  }
});

/* -------------------------- APPROVE / REJECT ------------------------- */
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