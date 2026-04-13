const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const router = express.Router();
const OtpModel = require("../models/OtpModel");
const Registration = require("../models/Registration");

/* -------- SEND OTP -------- */
router.post("/send", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone required" });
    }

    // Rate limit: max 3 OTPs per phone per 10 minutes
    const recentCount = await OtpModel.countDocuments({ phone });
    if (recentCount >= 3) {
      return res.status(429).json({
        success: false,
        message: "Too many OTP requests. Please wait 10 minutes.",
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Save to MongoDB (auto-expires in 10 min via TTL index)
    await OtpModel.create({ phone, otp });

    // MSG91 Flow API
    const response = await axios.post(
      "https://control.msg91.com/api/v5/flow/",
      {
        template_id: process.env.MSG91_TEMPLATE_ID,
        DLT_TE_ID: process.env.MSG91_DLT_TEMPLATE_ID,
        sender: "BAFNAR",
        mobiles: "91" + phone,
        OTP: otp,
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTHKEY,
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ success: true, message: "OTP sent successfully", data: response.data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

/* -------- VERIFY OTP -------- */
router.post("/verify", async (req, res) => {
  try {
    const { phone, otp } = req.body;

    // Find the latest OTP for this phone
    const record = await OtpModel.findOne({ phone }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(400).json({ success: false, message: "OTP not requested or expired" });
    }

    // Max 5 wrong attempts before locking
    if (record.attempts >= 5) {
      await OtpModel.deleteMany({ phone });
      return res.status(400).json({ success: false, message: "Too many wrong attempts. Request a new OTP." });
    }

    if (record.otp !== String(otp)) {
      await OtpModel.findByIdAndUpdate(record._id, { $inc: { attempts: 1 } });
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // OTP correct - delete all OTPs for this phone
    await OtpModel.deleteMany({ phone });

    // Try to find existing user (login flow) — for registration, user won't exist yet
    const normalizedPhone = String(phone).replace(/\D/g, "").replace(/^91/, "").slice(-10);
    const user = await Registration.findOne({
      otpMobile: { $in: [phone, normalizedPhone, "91" + normalizedPhone] },
    }).select("-password");

    // If user exists → login flow: return JWT token
    if (user) {
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
      return res.json({ success: true, message: "OTP verified successfully", token, user });
    }

    // If user not found → registration flow: OTP verified, let frontend complete registration
    res.json({ success: true, message: "OTP verified successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
