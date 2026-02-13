const geoip = require("geoip-lite");
const requestIp = require("request-ip");

function indiaOnly(req, res, next) {
  let ip = requestIp.getClientIp(req);

  if (!ip) {
    return res.status(403).json({ message: "Access denied" });
  }

  // normalize
  ip = ip.replace("::ffff:", "");

  // allow localhost / dev
  if (ip === "127.0.0.1" || ip === "::1") {
    return next();
  }

  const geo = geoip.lookup(ip);

  if (!geo || geo.country !== "IN") {
    return res.status(403).json({
      message: "This website is available only in India.",
      detectedCountry: geo?.country || "UNKNOWN",
    });
  }

  next();
}

module.exports = indiaOnly;
