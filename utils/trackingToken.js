function toWAPhone(raw) {
  if (!raw) return "";

  let p = String(raw).trim().replace(/[^\d]/g, "");

  // India default logic
  if (p.length === 10) return `91${p}`;
  if (p.length === 12 && p.startsWith("91")) return p;

  return p;
}

module.exports = { toWAPhone };