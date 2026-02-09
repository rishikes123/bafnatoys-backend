const express = require("express");
const router = express.Router();
const Visitor = require("../models/Visitor");
const geoip = require("geoip-lite"); // ✅ 1. GeoIP Import kiya

// ✅ 1. Track Visitor (Frontend se call hoga)
router.post("/track", async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];
    
    // 🌍 IP Extraction & Cleaning
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    if (ip.includes(',')) ip = ip.split(',')[0].trim(); // Proxy fix

    // 🌍 Country Detect Karo
    const geo = geoip.lookup(ip);
    const country = geo ? geo.country : "Unknown"; // Returns 'IN', 'US', etc.

    const { referrer } = req.body;

    // 🔍 Source Detection Logic
    let source = "direct";
    if (referrer) {
        const ref = referrer.toLowerCase();
        if (ref.includes("google")) source = "google";
        else if (ref.includes("instagram")) source = "instagram";
        else if (ref.includes("facebook")) source = "facebook";
        else if (ref.includes("whatsapp") || ref.includes("wa.me")) source = "whatsapp";
        else source = "other";
    }

    let visitor = await Visitor.findOne({ date });

    if (!visitor) {
      // Naya Record
      visitor = new Visitor({ 
        date, 
        count: 1, 
        ips: [ip],
        sources: { [source]: 1 },
        countries: { [country]: 1 } // ✅ Initial Country Set
      });
    } else {
      // Existing Record (Unique Check)
      if (!visitor.ips.includes(ip)) {
        visitor.count += 1;
        visitor.ips.push(ip);

        // ✅ Source Update
        visitor.sources[source] = (visitor.sources[source] || 0) + 1;

        // ✅ Country Update (Using Map)
        if (!visitor.countries) visitor.countries = new Map();
        const currentCountryCount = visitor.countries.get(country) || 0;
        visitor.countries.set(country, currentCountryCount + 1);
      }
    }

    await visitor.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Tracking Error:", err);
    res.status(500).json({ message: "Error tracking visitor" });
  }
});

// ✅ 2. Get Stats (Dashboard ke liye)
router.get("/stats", async (req, res) => {
  try {
    const stats = await Visitor.find().sort({ date: -1 }).limit(7);
    
    let sourceStats = { google: 0, instagram: 0, facebook: 0, whatsapp: 0, direct: 0, other: 0 };
    let countryStats = {}; // ✅ Country Data Container
    
    stats.forEach(day => {
        // Aggregate Sources
        if (day.sources) {
            sourceStats.google += day.sources.google || 0;
            sourceStats.instagram += day.sources.instagram || 0;
            sourceStats.facebook += day.sources.facebook || 0;
            sourceStats.whatsapp += day.sources.whatsapp || 0;
            sourceStats.direct += day.sources.direct || 0;
            sourceStats.other += day.sources.other || 0;
        }

        // ✅ Aggregate Countries
        if (day.countries) {
            // Check if it's a Map (Mongoose) or Object
            if (day.countries instanceof Map) {
                for (const [country, count] of day.countries) {
                    countryStats[country] = (countryStats[country] || 0) + count;
                }
            } else {
                // Fallback for object structure
                for (const key in day.countries) {
                    countryStats[key] = (countryStats[key] || 0) + day.countries[key];
                }
            }
        }
    });

    // Total Visitors Count
    const totalVisitors = await Visitor.aggregate([
      { $group: { _id: null, total: { $sum: "$count" } } }
    ]);

    res.json({
      dailyStats: stats.reverse(),
      totalVisitors: totalVisitors[0]?.total || 0,
      sourceStats,
      countryStats // ✅ Send Country Data to Frontend
    });
  } catch (err) {
    console.error("Stats Error:", err);
    res.status(500).json({ message: "Error fetching stats" });
  }
});

module.exports = router;