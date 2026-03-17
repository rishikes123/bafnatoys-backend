const express = require("express");
const router = express.Router();
const Visitor = require("../models/Visitor");
const geoip = require("geoip-lite");
const useragent = require("express-useragent"); // ✅ Import

// Middleware to parse User Agent
router.use(useragent.express());

// ✅ Helper: Clean IP
function getClientIp(req) {
  let ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "";
  if (Array.isArray(ip)) ip = ip[0];
  if (ip.includes(",")) ip = ip.split(",")[0].trim();
  ip = ip.replace("::ffff:", "");
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

// 1️⃣ TRACK VISITOR
router.post("/track", async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];
    const ip = getClientIp(req);
    const { referrer, path } = req.body; // ✅ Path bhi le rahe hain ab
    const ua = req.useragent; // ✅ User Agent Details

    let visitor = await Visitor.findOne({ date });
    if (!visitor) visitor = new Visitor({ date });

    // ✅ Unique IP Check (Count, Sources, Devices, OS, Geo)
    if (!visitor.ips.includes(ip)) {
      visitor.count += 1;
      visitor.ips.push(ip);

      // --- Source ---
      let source = "direct";
      if (referrer) {
        const ref = String(referrer).toLowerCase();
        if (ref.includes("google")) source = "google";
        else if (ref.includes("instagram")) source = "instagram";
        else if (ref.includes("facebook")) source = "facebook";
        else if (ref.includes("whatsapp") || ref.includes("wa.me")) source = "whatsapp";
        else source = "other";
      }
      visitor.sources[source] = (visitor.sources[source] || 0) + 1;

      // --- ✅ Device Type ---
      if (ua.isMobile) visitor.devices.mobile++;
      else if (ua.isTablet || ua.isiPad) visitor.devices.tablet++;
      else visitor.devices.desktop++;

      // --- ✅ OS ---
      if (ua.isAndroid) visitor.os.android++;
      else if (ua.isiPhone || ua.isiPad) visitor.os.ios++;
      else if (ua.isWindows) visitor.os.windows++;
      else if (ua.isMac) visitor.os.mac++;
      else if (ua.isLinux) visitor.os.linux++;
      else visitor.os.other++;

      // --- ✅ Browser ---
      if (ua.isChrome) visitor.browsers.chrome++;
      else if (ua.isSafari) visitor.browsers.safari++;
      else if (ua.isFirefox) visitor.browsers.firefox++;
      else if (ua.isEdge) visitor.browsers.edge++;
      else visitor.browsers.other++;

      // --- Geo (State) ---
      const geo = geoip.lookup(ip);
      if (geo && geo.country === "IN" && geo.region) {
        visitor.states.set(geo.region, (visitor.states.get(geo.region) || 0) + 1);
      }
    }

    // ✅ Page Views (Ye Unique IP se bahar hai, taki har page reload count ho)
    if (path) {
      // MongoDB Map key mein '.' nahi le sakta, replace kar do
      const safePath = path.replace(/\./g, "_");
      visitor.pageViews.set(safePath, (visitor.pageViews.get(safePath) || 0) + 1);
    }

    await visitor.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("Tracking Error:", err);
    return res.status(500).json({ message: "Error tracking visitor" });
  }
});

// 2️⃣ GET STATS
router.get("/stats", async (req, res) => {
  try {
    const stats = await Visitor.find().sort({ date: -1 }).limit(7);

    // Initial Aggregation Objects
    let aggregations = {
      source: { google: 0, instagram: 0, facebook: 0, whatsapp: 0, direct: 0, other: 0 },
      device: { mobile: 0, desktop: 0, tablet: 0 },
      os: { android: 0, ios: 0, windows: 0, mac: 0, linux: 0, other: 0 },
      browser: { chrome: 0, safari: 0, firefox: 0, edge: 0, other: 0 },
      states: {},
      pages: {},
    };

    stats.forEach((day) => {
      // Helper to sum objects
      const sumObj = (target, source) => {
        if (!source) return;
        Object.keys(target).forEach((key) => {
          target[key] += source[key] || 0;
        });
      };

      sumObj(aggregations.source, day.sources);
      sumObj(aggregations.device, day.devices);
      sumObj(aggregations.os, day.os);
      sumObj(aggregations.browser, day.browsers);

      // Map Handling (States & Pages)
      if (day.states) {
        for (const [key, val] of day.states.entries()) {
          aggregations.states[key] = (aggregations.states[key] || 0) + val;
        }
      }
      if (day.pageViews) {
        for (const [key, val] of day.pageViews.entries()) {
          aggregations.pages[key] = (aggregations.pages[key] || 0) + val;
        }
      }
    });

    const totalVisitors = await Visitor.aggregate([{ $group: { _id: null, total: { $sum: "$count" } } }]);

    res.json({
      dailyStats: stats.reverse(),
      totalVisitors: totalVisitors[0]?.total || 0,
      ...aggregations, // Send all aggregated data
    });
  } catch (err) {
    console.error("Stats Error:", err);
    res.status(500).json({ message: "Error fetching stats" });
  }
});

module.exports = router;