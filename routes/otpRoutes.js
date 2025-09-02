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

// In-memory OTP store (prod: use Redis/DB)
const otpStore = Object.create(null);

// Config
const OTP_TTL_MS = 5 * 60 * 1000;      // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000;  // 30 seconds
const MAX_ATTEMPTS = 5;

/* ------------------------------ SEND OTP ----------------------------- */
/**
 * POST /api/otp/send
 * Body: { phone: "9999999999" }
 */
router.post("/send", async (req, res) => {
  try {
    const raw = req.body.phone;
    if (!raw) {
      return res.status(400).json({ success: false, message: "Phone required" });
    }

    const phone = normalizePhone(raw);
    if (phone.length !== 10) {
      return res.status(400).json({ success: false, message: "Invalid phone number" });
    }

    const now = Date.now();
    const existing = otpStore[phone];
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

    // ---------- call MSG91 Flow API ----------
    try {
      const response = await axios.post(
        "https://control.msg91.com/api/v5/flow/",
        {
          template_id: process.env.MSG91_TEMPLATE_ID,
          DLT_TE_ID: process.env.MSG91_DLT_TEMPLATE_ID,
          sender: process.env.MSG91_SENDER || "BAFNAR",
          mobiles: "91" + phone,
          OTP: otp, // make sure the template variable matches (##OTP##)
        },
        {
          headers: {
            authkey: process.env.MSG91_AUTHKEY,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      // Detailed logs for debugging (helpful on Railway)
      console.log("MSG91 response status:", response.status);
      if (response.headers) console.log("MSG91 response headers:", JSON.stringify(response.headers));
      console.log("MSG91 response data:", JSON.stringify(response.data));

      // Return OTP in response for DEV (toggle with env)
      const returnOtp =
        process.env.RETURN_OTP_IN_RESPONSE === "true" || process.env.NODE_ENV !== "production";

      if (returnOtp) {
        return res.json({ success: true, message: "OTP sent (dev)", otp: String(otp) });
      } else {
        return res.json({ success: true, message: "OTP sent successfully" });
      }
    } catch (e) {
      // Log full error info from MSG91 if available
      console.error("MSG91 API error:", e.response?.status, e.response?.data || e.message);
      // If 3rd-party failed, we should remove the stored otp so user can retry quickly
      delete otpStore[phone];
      return res.status(500).json({ success: false, message: "Failed to send OTP", error: e.response?.data || e.message });
    }
  } catch (err) {
    console.error("OTP Send Error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ----------------------------- VERIFY OTP ---------------------------- */
/**
 * POST /api/otp/verify
 * Body: { phone: "9999999999", otp: "123456" }
 */
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
    return res.json({ success: true, message: "OTP verified successfully" });
  } catch (err) {
    console.error("OTP Verify Error:", err);
    return res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
