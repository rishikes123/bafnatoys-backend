const router = require("express").Router();
const Setting = require("../models/settingModel");

/* ================= COD SETTINGS ================= */

// GET COD Settings
router.get("/cod", async (req, res) => {
  try {
    console.log("📥 GET Request received for /cod");
    let setting = await Setting.findOne({ key: "cod" });

    if (!setting) {
      console.log("⚠️ No setting found, creating default...");
      setting = await Setting.create({
        key: "cod",
        data: { advanceAmount: 0 },
      });
    }

    console.log("📤 Sending Data:", setting.data);
    res.json(setting.data);
  } catch (err) {
    console.error("❌ GET Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

// UPDATE COD Settings
router.put("/cod", async (req, res) => {
  try {
    console.log("📥 PUT Request received. Body:", req.body);
    
    const { advanceAmount } = req.body;
    console.log("🔢 Parsed Advance Amount:", advanceAmount);

    const setting = await Setting.findOneAndUpdate(
      { key: "cod" },
      {
        $set: {
          key: "cod", // Ensure key exists
          data: {
            advanceAmount: Number(advanceAmount) || 0,
          },
        },
      },
      { upsert: true, new: true }
    );

    console.log("✅ Database Updated. New Doc:", setting);
    res.json(setting.data);
  } catch (err) {
    console.error("❌ PUT Error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;