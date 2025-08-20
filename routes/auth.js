const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const Registration = require('../models/Registration');
const upload = require('../middleware/upload');

// ─── REGISTER ─────────────────────────────────────────────────────────────
router.post('/register', upload.single('visitingCard'), async (req, res) => {
  try {
    const {
      firmName, shopName, state, city,
      zip, otpMobile, whatsapp
    } = req.body;

    const existing = await Registration.findOne({ otpMobile });
    if (existing) 
      return res.status(400).json({ msg: 'Mobile number already registered' });

    const visitingCardUrl = req.file
      ? `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`
      : '';

    const user = new Registration({
      firmName, shopName, state, city,
      zip, otpMobile, whatsapp, visitingCardUrl
    });
    await user.save();

    return res.status(201).json({
      msg: 'Registration successful. Admin approval pending.'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── LOGIN ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { otpMobile } = req.body;
    const user = await Registration.findOne({ otpMobile });
    if (!user) return res.status(400).json({ msg: 'User not found' });
    if (!user.isApproved)
      return res.status(403).json({ msg: 'Admin approval pending.' });

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );
    return res.json({ token, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
