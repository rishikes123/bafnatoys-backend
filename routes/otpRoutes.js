const express = require("express");
const axios = require("axios");
const router = express.Router();

// In-memory OTP store (⚠️ For production use Redis or DB)
const otpStore = {};

/* ---------------- SEND OTP ---------------- */
router.post("/send", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: "Phone required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000); // 6 digit OTP
    otpStore[phone] = otp;

    // ✅ MSG91 Flow API
    const response = await axios.post(
      "https://control.msg91.com/api/v5/flow/",
      {
        template_id: process.env.MSG91_TEMPLATE_ID,    // MSG91 Flow Template ID
        DLT_TE_ID: process.env.MSG91_DLT_TEMPLATE_ID,  // DLT Template ID
        sender: "BAFNAR",                              // Approved Sender ID
        mobiles: "91" + phone,
        OTP: otp,                                      // ✅ matches ##OTP## in DLT template
      },
      {
        headers: {
          authkey: process.env.MSG91_AUTHKEY,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ OTP ${otp} sent to ${phone}`, response.data);
    res.json({ success: true, message: "OTP sent successfully", data: response.data });
  } catch (err) {
    console.error("❌ OTP Send Error:", err.response?.data || err.message);
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
    console.error("❌ OTP Verify Error:", err.message);
    res.status(500).json({ success: false, message: "OTP verification failed" });
  }
});

module.exports = router;
