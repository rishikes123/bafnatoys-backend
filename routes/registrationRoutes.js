const express = require("express");
const axios = require("axios");
const router = express.Router();

const upload = require("../middleware/upload");
const Registration = require("../models/Registration");

/* ------------------------------ helpers ------------------------------ */
// ✅ Normalize phone (always store 10-digit)
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits.slice(-10);
};

// ✅ In-memory OTP store (production → Redis / DB use karo)
const otpStore = {};

/* ------------------------------ OTP SEND ----------------------------- */
router.post("/send-otp", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: "Phone is required" });

    const otp = Math.floor(100000 + Math.random() * 900000); // 6 digit OTP
    otpStore[phone] = otp;

    const url = `https://control.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${process.env.MSG91_AUTHKEY}`;

    await axios.get(url);

    console.log(`✅ OTP ${otp} sent to ${phone}`);
    res.json({ message: "OTP sent successfully" });
  } catch (err) {
    console.error("Send OTP Error:", err.response?.data || err.message);
    res.status(500).json({ message: "Failed to send OTP" });
  }
});

/* ----------------------------- OTP VERIFY ---------------------------- */
router.post("/verify-otp", (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!otpStore[phone])
      return res.status(400).json({ message: "OTP not requested" });

    if (otpStore[phone] != otp)
      return res.status(400).json({ message: "Invalid OTP" });

    delete otpStore[phone]; // clear after verification
    res.json({ message: "OTP verified successfully" });
  } catch (err) {
    res.status(500).json({ message: "OTP verification failed" });
  }
});

/* ------------------------------ REGISTER ----------------------------- */
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

    const nMobile = normalizePhone(otpMobile);
    const nWhats = whatsapp ? normalizePhone(whatsapp) : "";

    // prevent duplicate
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
      password, // ⚠️ hash in production
      visitingCardUrl,
      isApproved: null, // Pending by default
    });

    await doc.save();
    res.status(201).json({
      message: "✅ Registration submitted. Awaiting admin approval.",
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
    const candidates = [raw, `+91${raw}`, `91${raw}`];

    const user = await Registration.findOne({ otpMobile: { $in: candidates } });
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

    if (update.otpMobile) update.otpMobile = normalizePhone(update.otpMobile);
    if (update.whatsapp) update.whatsapp = normalizePhone(update.whatsapp);

    if (req.file) {
      update.visitingCardUrl = `/uploads/${req.file.filename}`;
    }

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
