// routes/otpRoutes.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

/* ------------------------------ helpers ------------------------------ */
// Always store/compare 10-digit numbers
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits.slice(-10);
};

// In-memory OTP store (prod: Redis/DB)
// otpStore[phone] = { code, expiresAt, attempts, lastSentAt }
const otpStore = Object.create(null);

const OTP_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MAX_ATTEMPTS = 5;

/* ------------------------------ SEND OTP ----------------------------- */
// POST /api/otp/send   { phone }
router.post("/send", async (req, res) => {
  try {
    const raw = req.body.phone;
    if (!raw) return res.status(400).json({ success: false, message: "Phone required" });

    const phone = normalizePhone(raw);
    if (phone.length !== 10) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }

    // cooldown
    const existing = otpStore[phone];
    const now = Date.now();
    if (existing?.lastSentAt && now - existing.lastSentAt < RESEND_COOLDOWN_MS) {
      const waitMs = RESEND_COOLDOWN_MS - (now - existing.lastSentAt);
      return res.status(429).json({
        success: false,
        message: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another OTP.`,
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit
    otpStore[phone] = {
      code: String(otp),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
    };

    // Send via MSG91 Flow (DLT compliant)
    await axios.post(
      "https://control.msg91.com/api/v5/flow/",
      {
        template_id: process.env.MSG91_TEMPLATE_ID,     // Flow Template ID
        DLT_TE_ID: process.env.MSG91_DLT_TEMPLATE_ID,   // DLT Template ID
        sender: "BAFNAR",                               // Approved Sender ID
        mobiles: "91" + phone,
        OTP: otp,                                       // must match ##OTP## variable in template
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTHKEY,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    console.log(`✅ OTP ${otp} sent to ${phone}`);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("❌ OTP Send Error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

/* ----------------------------- VERIFY OTP ---------------------------- */
// POST /api/otp/verify   { phone, otp }
router.post("/verify", (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone || "");
    const code = String(req.body.otp || "");

    const entry = otpStore[phone];
    if (!entry) {
      return res.status(400).json({ success: false, message: "OTP not requested" });
    }

    // expired?
    if (Date.now() > entry.expiresAt) {
      delete otpStore[phone];
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new one." });
    }

    // attempt limit
    entry.attempts += 1;
    if (entry.attempts > MAX_ATTEMPTS) {
      delete otpStore[phone];
      return res.status(429).json({ success: false, message: "Too many attempts. Please request a new OTP." });
    }

    // compare
    if (entry.code !== code) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // success → clear
    delete otpStore[phone];
    res.json({ success: true, message: "OTP verified successfully" });
  } catch (err) {
    console.error("❌ OTP Verify Error:", err.message);
    res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
