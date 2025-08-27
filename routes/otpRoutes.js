const express = require("express");
const axios = require("axios");
const router = express.Router();

// In-memory OTP store (⚠️ Prod me Redis/Mongo use karo)
const otpStore = {};

/* ---------------- SEND OTP ---------------- */
router.post("/send", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: "Phone required" });

    const otp = Math.floor(100000 + Math.random() * 900000); // 6 digit OTP
    otpStore[phone] = otp;

    const url = `https://control.msg91.com/api/v5/otp?template_id=${process.env.MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${process.env.MSG91_AUTHKEY}&otp=${otp}&sender=${process.env.MSG91_SENDER_ID}`;

    const response = await axios.get(url);

    console.log(`✅ OTP ${otp} sent to ${phone}`);
    res.json({ success: true, message: "OTP sent successfully", data: response.data });
  } catch (err) {
    console.error("OTP Send Error:", err.response?.data || err.message);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

/* ---------------- VERIFY OTP ---------------- */
router.post("/verify", (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!otpStore[phone]) {
      return res.status(400).json({ success: false, message: "OTP not requested" });
    }

    if (otpStore[phone] != otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    delete otpStore[phone]; // OTP clear after success
    res.json({ success: true, message: "OTP verified successfully" });
  } catch (err) {
    console.error("OTP Verify Error:", err.message);
    res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
