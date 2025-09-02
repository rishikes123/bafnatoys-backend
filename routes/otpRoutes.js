// routes/otpRoutes.js
const express = require("express");
const axios = require("axios");
const router = express.Router();

// In-memory OTP store (for dev). Use Redis in production.
const otpStore = Object.create(null);

// Config
const OTP_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;   // 30 seconds (as requested)
const MAX_ATTEMPTS = 5;

// Normalize phone to last 10 digits
const normalizePhone = (v = "") => {
  const digits = String(v).replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) return digits.slice(-10);
  return digits.slice(-10);
};

// Helper to check dev toggle
const shouldReturnOtpInResponse = () =>
  process.env.RETURN_OTP_IN_RESPONSE === "true" || process.env.NODE_ENV !== "production";

/* ------------------------------ SEND OTP ----------------------------- */
// POST /api/otp/send
// Body: { phone: "9999999999" }
router.post("/send", async (req, res) => {
  try {
    const raw = req.body.phone;
    if (!raw) return res.status(400).json({ success: false, message: "Phone required" });

    const phone = normalizePhone(raw);
    if (phone.length !== 10) return res.status(400).json({ success: false, message: "Invalid phone number" });

    const now = Date.now();
    const existing = otpStore[phone];

    // cooldown
    if (existing && now - (existing.lastSentAt || 0) < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.lastSentAt)) / 1000);
      return res.status(429).json({ success: false, message: `Please wait ${wait}s before requesting another OTP.` });
    }

    // generate and store
    const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit
    otpStore[phone] = {
      code: String(otp),
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      lastSentAt: now,
    };

    // prepare MSG91 payload (ensure env vars set)
    const payload = {
      template_id: process.env.MSG91_TEMPLATE_ID,
      DLT_TE_ID: process.env.MSG91_DLT_TEMPLATE_ID,
      sender: process.env.MSG91_SENDER || "BAFNAR",
      mobiles: "91" + phone,
      OTP: otp,
    };

    try {
      const response = await axios.post("https://control.msg91.com/api/v5/flow/", payload, {
        headers: { authkey: process.env.MSG91_AUTHKEY, "Content-Type": "application/json" },
        timeout: 10000,
      });

      // Minimal log for tracing — response.data usually contains a message id
      console.log("MSG91 send status:", response.status, "data:", response.data);

      if (shouldReturnOtpInResponse()) {
        return res.json({ success: true, message: "OTP sent (dev)", otp: String(otp), msg91: response.data });
      }

      return res.json({ success: true, message: "OTP sent" });
    } catch (e) {
      // provider error — delete stored OTP so user can retry
      delete otpStore[phone];
      console.error("MSG91 send error:", e.response?.status, e.response?.data || e.message);
      return res.status(502).json({ success: false, message: "Failed to send OTP", error: e.response?.data || e.message });
    }
  } catch (err) {
    console.error("OTP send error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ----------------------------- VERIFY OTP ---------------------------- */
// POST /api/otp/verify
// Body: { phone: "9999999999", otp: "123456" }
router.post("/verify", (req, res) => {
  try {
    const raw = req.body.phone;
    const inputOtp = String(req.body.otp || "");
    if (!raw || !inputOtp) return res.status(400).json({ success: false, message: "Phone and OTP required" });

    const phone = normalizePhone(raw);
    const entry = otpStore[phone];
    if (!entry) return res.status(400).json({ success: false, message: "OTP not requested or expired" });

    // expiry
    if (Date.now() > entry.expiresAt) {
      delete otpStore[phone];
      return res.status(400).json({ success: false, message: "OTP expired. Please request a new one." });
    }

    // attempts
    entry.attempts = (entry.attempts || 0) + 1;
    if (entry.attempts > MAX_ATTEMPTS) {
      delete otpStore[phone];
      return res.status(429).json({ success: false, message: "Too many attempts. Please request a new OTP." });
    }

    // compare
    if (entry.code !== inputOtp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // success
    delete otpStore[phone];
    return res.json({ success: true, message: "OTP verified successfully" });
  } catch (err) {
    console.error("OTP verify error:", err);
    return res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
