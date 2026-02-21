const crypto = require("crypto");

function makeTrackingToken() {
  return crypto.randomBytes(16).toString("hex"); // 32-char token
}

module.exports = { makeTrackingToken };