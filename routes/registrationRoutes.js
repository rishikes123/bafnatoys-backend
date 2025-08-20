// backend/routes/registrationRoutes.js
const express = require("express");
const router = express.Router();

const upload = require("../middleware/upload");
const Registration = require("../models/Registration");

/* ------------------------------ helpers ------------------------------ */
// Keep only digits; store/use last 10 digits (drop +91 / 91 if present)
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits.slice(-10);
};

/* ------------------------------ create ------------------------------- */
/**
 * POST /api/registrations/register
 * multipart/form-data (field name: visitingCard)
 */
router.post("/register", upload.single("visitingCard"), async (req, res) => {
  try {
    const {
      firmName,
      shopName,
      state,
      city,
      zip,
      otpMobile,
      whatsapp,
      password,
    } = req.body;

    if (!firmName || !shopName || !state || !city || !zip || !otpMobile) {
      return res
        .status(400)
        .json({ message: "Please fill all required fields." });
    }

    // Always store normalized 10-digit numbers
    const nMobile = normalizePhone(otpMobile);
    const nWhats = whatsapp ? normalizePhone(whatsapp) : "";

    // Prevent duplicate registrations for same mobile
    const dup = await Registration.findOne({ otpMobile: nMobile });
    if (dup) {
      return res
        .status(409)
        .json({ message: "A user with this mobile already exists." });
    }

    const visitingCardUrl = req.file ? `/uploads/${req.file.filename}` : "";

    const doc = new Registration({
      firmName,
      shopName,
      state,
      city,
      zip,
      otpMobile: nMobile,
      whatsapp: nWhats,
      password, // (note: store hashed in a real app)
      visitingCardUrl,
      isApproved: null, // Pending by default
    });

    await doc.save();
    res
      .status(201)
      .json({ message: "Registration submitted. Awaiting admin approval." });
  } catch (err) {
    res.status(500).json({ message: err.message || "Server error" });
  }
});

/* ------------------------------- read -------------------------------- */
/**
 * GET /api/registrations
 * Returns all registrations (admin list)
 */
router.get("/", async (_req, res) => {
  try {
    const users = await Registration.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

/**
 * GET /api/registrations/phone/:otpMobile
 * Find user by phone for OTP login precheck. Accepts +91 / 91 / 10-digit.
 */
router.get("/phone/:otpMobile", async (req, res) => {
  try {
    const raw = normalizePhone(req.params.otpMobile);
    // Backward-compatible search (in case old docs still have +91/91 stored)
    const candidates = [raw, `+91${raw}`, `91${raw}`];

    const user = await Registration.findOne({ otpMobile: { $in: candidates } });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

/* ----------------------------- update -------------------------------- */
/**
 * PUT /api/registrations/:id
 * Accepts:
 *  - JSON (regular profile updates, with visitingCardUrl string), OR
 *  - multipart/form-data (file field name: "visitingCard")
 */
router.put("/:id", upload.single("visitingCard"), async (req, res) => {
  try {
    const id = req.params.id;

    // Allowed fields to update
    const allowed = [
      "firmName",
      "shopName",
      "state",
      "city",
      "zip",
      "otpMobile",
      "whatsapp",
      "visitingCardUrl",
    ];

    const update = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    }

    // Normalize phone numbers if present
    if (update.otpMobile) update.otpMobile = normalizePhone(update.otpMobile);
    if (update.whatsapp) update.whatsapp = normalizePhone(update.whatsapp);

    // If a new file is uploaded, override visitingCardUrl
    if (req.file) {
      update.visitingCardUrl = `/uploads/${req.file.filename}`;
    }

    const doc = await Registration.findByIdAndUpdate(id, update, { new: true });
    if (!doc) return res.status(404).json({ message: "Registration not found" });

    return res.json(doc);
  } catch (err) {
    console.error("Update registration error:", err);
    // Multer's "Unexpected field" error → tell client the exact field name to use
    if (err && err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        message: 'Unexpected field. Use file field name "visitingCard".',
      });
    }
    return res
      .status(500)
      .json({ message: err.message || "Failed to update profile" });
  }
});

/* ----------------------------- approve/reject ------------------------- */
/**
 * POST /api/registrations/:id/approve
 */
router.post("/:id/approve", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.json({ message: "User approved" });
  } catch (err) {
    res.status(500).json({ message: "Approval failed" });
  }
});

/**
 * POST /api/registrations/:id/reject
 */
router.post("/:id/reject", async (req, res) => {
  try {
    await Registration.findByIdAndUpdate(req.params.id, { isApproved: false });
    res.json({ message: "User rejected" });
  } catch (err) {
    res.status(500).json({ message: "Rejection failed" });
  }
});

/* ----------------------------- delete -------------------------------- */
/**
 * DELETE /api/registrations/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    await Registration.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

module.exports = router;
