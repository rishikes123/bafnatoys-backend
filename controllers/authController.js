// backend/controllers/authController.js

const jwt    = require("jsonwebtoken");
const admin  = require("../firebase-admin");
const Customer = require("../models/customerModel"); // agar filename lowercase hai

exports.loginWithOtp = async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Missing idToken" });

    // 1) Firebase ID token verify
    const decoded = await admin.auth().verifyIdToken(idToken);
    const phone     = decoded.phone_number;
    const firebaseUid = decoded.uid;

    // 2) Customer dhundho ya naya bana do
    let customer = await Customer.findOne({ otpMobile: phone });
    if (!customer) {
      customer = new Customer({ otpMobile: phone, firebaseUid, status: "Approved" });
    } else if (!customer.firebaseUid) {
      customer.firebaseUid = firebaseUid;
    }
    await customer.save();

    // 3) **Apna** JWT banao
    const token = jwt.sign(
      { id: customer._id },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    // 4) Return server‐signed JWT, Firebase token nahi
    res.json({
      message: "Login successful",
      token,        // ← ab yeh tera JWT hai
      customer: {
        id: customer._id,
        firmName: customer.firmName,
        otpMobile: customer.otpMobile,
      },
    });
  } catch (err) {
    console.error("loginWithOtp error:", err);
    res.status(401).json({ message: "Invalid ID token" });
  }
};
