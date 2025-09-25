const express = require("express");
const upload = require("../middleware/upload"); // multer-storage-cloudinary
const Registration = require("../models/Registration");

const router = express.Router();

/* ------------------------------ helpers ------------------------------ */
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits.slice(-10);
};

/* ------------------------------ REGISTER ----------------------------- */
// POST /api/registrations/register
router.post("/register", upload.single("visitingCard"), async (req, res) => {
  try {
    const {
      shopName,
      otpMobile,
      whatsapp,
      password, // TODO: hash in production
    } = req.body;

    if (!shopName || !otpMobile) {
      return res.status(400).json({ message: "Please fill all required fields." });
    }

    const nMobile = normalizePhone(otpMobile);
    const nWhats = whatsapp ? normalizePhone(whatsapp) : "";

    // prevent duplicate by mobile
    const dup = await Registration.findOne({ otpMobile: nMobile });
    if (dup) {
      return res.status(409).json({ message: "A user with this mobile already exists." });
    }

    // ✅ Cloudinary URL from multer-storage-cloudinary
    const visitingCardUrl = req.file?.path || "";

    const doc = await Registration.create({
      shopName,
      otpMobile: nMobile,
      whatsapp: nWhats,
      password,          // hash later
      visitingCardUrl,   // store Cloudinary URL
      isApproved: null,  // Pending
    });

    res.status(201).json({
      success: true,
      message: "✅ Registration submitted. Awaiting admin approval.",
      user: doc,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/* ------------------------------- LIST ------------------------------- */
// GET /api/registrations
router.get("/", async (_req, res) => {
  try {
    const users = await Registration.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

/* --------------------------- FIND BY PHONE -------------------------- */
// GET /api/registrations/phone/:otpMobile
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
// PUT /api/registrations/:id
router.put("/:id", upload.single("visitingCard"), async (req, res) => {
  try {
    const id = req.params.id;
    const allowed = [
      "shopName", "otpMobile", "whatsapp", "visitingCardUrl", "password",
    ];

    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    if (update.otpMobile) update.otpMobile = normalizePhone(update.otpMobile);
    if (update.whatsapp) update.whatsapp = normalizePhone(update.whatsapp);

    // If a new file comes, replace with Cloudinary URL
    if (req.file) update.visitingCardUrl = req.file.path;

    const doc = await Registration.findByIdAndUpdate(id, update, { new: true });
    if (!doc) return res.status(404).json({ message: "Registration not found" });

    res.json(doc);
  } catch (err) {
    console.error("Update registration error:", err);

    if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        message: 'Unexpected field. Use file field name "visitingCard".',
      });
    }

    res.status(500).json({ message: err.message || "Failed to update profile" });
  }
});

/* -------------------------- APPROVE / REJECT ------------------------- */
// POST /api/registrations/:id/approve
router.post("/:id/approve", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.json({ message: "✅ User approved" });
  } catch (err) {
    res.status(500).json({ message: "Approval failed" });
  }
});

// POST /api/registrations/:id/reject
router.post("/:id/reject", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: false });
    res.json({ message: "❌ User rejected" });
  } catch (err) {
    res.status(500).json({ message: "Rejection failed" });
  }
});

/* ------------------------------- DELETE ------------------------------ */
// DELETE /api/registrations/:id
router.delete("/:id", async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "🗑️ User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
