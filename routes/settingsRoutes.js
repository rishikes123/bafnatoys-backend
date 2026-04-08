const router = require("express").Router();
const Setting = require("../models/settingModel");

/* ================= COD SETTINGS ================= */

// GET COD Settings
router.get("/cod", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "cod" });

    if (!setting) {
      setting = await Setting.create({
        key: "cod",
        // ✅ Default me COD chalu, advanceAmount 0 aur advanceType 'flat' rahega
        data: { advanceAmount: 0, advanceType: "flat", enabled: true },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE COD Settings
router.put("/cod", async (req, res) => {
  try {
    // ✅ advanceType ko request body se receive kar rahe hain
    const { advanceAmount, advanceType, enabled } = req.body;
    
    // Strict True/False checking
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }

    const setting = await Setting.findOneAndUpdate(
      { key: "cod" },
      {
        $set: {
          key: "cod", // Ensure key exists
          data: {
            advanceAmount: Number(advanceAmount) || 0,
            // ✅ Yahan theek se check karke percentage ya flat save hoga
            advanceType: advanceType === "percentage" ? "percentage" : "flat", 
            enabled: isEnabled, 
          },
        },
      },
      { upsert: true, new: true }
    );

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= MAINTENANCE MODE ================= */

// GET Maintenance Status
router.get("/maintenance", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "maintenance" });

    if (!setting) {
      // Default: Maintenance OFF (Website Live)
      setting = await Setting.create({
        key: "maintenance",
        data: { enabled: false },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Maintenance Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Maintenance Status
router.put("/maintenance", async (req, res) => {
  try {
    const { enabled } = req.body; // Expecting { enabled: true/false }

    const setting = await Setting.findOneAndUpdate(
      { key: "maintenance" },
      {
        $set: {
          key: "maintenance",
          data: { enabled: Boolean(enabled) },
        },
      },
      { upsert: true, new: true }
    );

    console.log("✅ Maintenance Mode Updated:", setting.data);
    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Maintenance Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= PRODUCT REVIEWS SETTINGS (ON/OFF) ================= */

// GET Review Settings
router.get("/reviews", async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: "reviews" });

    if (!setting) {
      // Default: Reviews chalu (enabled: true) rahenge
      setting = await Setting.create({
        key: "reviews",
        data: { enabled: true },
      });
    }

    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Reviews Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE Review Settings
router.put("/reviews", async (req, res) => {
  try {
    const { enabled } = req.body;
    
    // Strict True/False checking
    let isEnabled = true;
    if (enabled === false || String(enabled).toLowerCase() === "false" || enabled === 0) {
      isEnabled = false;
    }

    const setting = await Setting.findOneAndUpdate(
      { key: "reviews" },
      {
        $set: {
          key: "reviews",
          data: { enabled: isEnabled },
        },
      },
      { upsert: true, new: true }
    );

    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Reviews Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

/* ================= ANNOUNCEMENT BANNER ================= */

// GET Announcement
router.get('/announcement', async (req, res) => {
  try {
    let setting = await Setting.findOne({ key: 'announcement' });
    if (!setting) {
      setting = await Setting.create({
        key: 'announcement',
        data: { enabled: false, text: '', bgColor: '#e63946', textColor: '#ffffff' },
      });
    }
    res.json(setting.data);
  } catch (err) {
    console.error('❌ GET Announcement Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

// UPDATE Announcement
router.put('/announcement', async (req, res) => {
  try {
    const { enabled, text, bgColor, textColor } = req.body;
    const setting = await Setting.findOneAndUpdate(
      { key: 'announcement' },
      { $set: { key: 'announcement', data: { enabled: Boolean(enabled), text: text || '', bgColor: bgColor || '#e63946', textColor: textColor || '#ffffff' } } },
      { upsert: true, new: true }
    );
    res.json(setting.data);
  } catch (err) {
    console.error('❌ PUT Announcement Error:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;