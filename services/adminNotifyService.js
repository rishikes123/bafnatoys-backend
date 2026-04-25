// services/adminNotifyService.js
// Sends a "new order received" alert to the admin via WhatsApp + Email
// whenever a customer places an order. Both channels are independent —
// if WhatsApp fails, email still goes out (and vice versa).
//
// ENV vars required:
//   ADMIN_NOTIFY_WHATSAPP   e.g. +919876543210  (admin's WhatsApp number)
//   ADMIN_EMAIL             e.g. owner@bafnatoys.com (already exists)
//   EMAIL_USER / EMAIL_PASS (already exists for sendEmail util)
//
// Multiple admins supported — comma-separate the numbers/emails:
//   ADMIN_NOTIFY_WHATSAPP=+919876543210,+918887776665
//   ADMIN_EMAIL=owner@bafnatoys.com,manager@bafnatoys.com

const { sendWhatsAppTemplate } = require("./whatsappService");
const sendEmail = require("../utils/sendEmail");

// Sanitize a phone to E.164 (digits only, +91 default for India)
function sanitizeAdminPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = "91" + digits;
  return digits;
}

function splitCsv(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- WhatsApp alert ----------
async function notifyAdminWhatsApp(order) {
  const numbers = splitCsv(process.env.ADMIN_NOTIFY_WHATSAPP);
  if (numbers.length === 0) return; // env not set — skip silently

  const shopName =
    order?.customerId?.shopName ||
    order?.customerId?.firmName ||
    order?.shippingAddress?.shopName ||
    order?.shippingAddress?.fullName ||
    "Customer";

  const orderNumber = order?.orderNumber || "";
  const total = order?.total != null ? String(order.total) : "0";
  const paymentMode = order?.paymentMode || "—";
  const customerPhone =
    order?.customerId?.whatsapp ||
    order?.customerId?.otpMobile ||
    order?.shippingAddress?.phone ||
    "—";

  // Primary: dedicated 5-var admin template `_adminn_whatsapp_alert_sent`.
  // (Original name `admin_new_order_alert` was replaced by user — old one
  // had hardcoded values, new one has proper {{1}}..{{5}} placeholders.)
  // Fallback: 3-var customer template `order_confirmed_new` (legacy, but
  // we PREFIX shopName with "🔔 ADMIN ALERT" so admins can tell it apart
  // from a regular customer order confirmation while the new template
  // is still in review at Meta).
  const primaryTemplate =
    process.env.WA_ADMIN_ORDER_TEMPLATE || "_adminn_whatsapp_alert_sent";
  const fallbackTemplate = "order_confirmed_new";

  const adminParams = [
    { type: "text", text: String(shopName) },
    { type: "text", text: String(orderNumber) },
    { type: "text", text: String(total) },
    { type: "text", text: String(paymentMode) },
    { type: "text", text: String(customerPhone) },
  ];
  // For fallback, pack more info into the 3 slots available in `order_confirmed_new`.
  const fallbackParams = [
    { type: "text", text: `🔔 ADMIN — ${shopName} (${customerPhone})` },
    { type: "text", text: String(orderNumber) },
    { type: "text", text: `₹${total} (${paymentMode})` },
  ];

  for (const raw of numbers) {
    const to = sanitizeAdminPhone(raw);
    if (!to) continue;

    // Try primary admin template first
    try {
      await sendWhatsAppTemplate({
        to,
        templateName: primaryTemplate,
        languageCode: "en_US",
        components: [{ type: "body", parameters: adminParams }],
      });
      console.log(
        `✅ Admin WhatsApp alert sent to ${to} for order ${orderNumber} (template: ${primaryTemplate})`
      );
      continue; // success, next admin
    } catch (err) {
      const detail = err?.response?.data?.error?.message || err.message;
      console.warn(
        `⚠️  Primary admin template "${primaryTemplate}" failed for ${to} — falling back. Reason: ${detail}`
      );
    }

    // Fallback to legacy template with "ADMIN" prefix
    try {
      await sendWhatsAppTemplate({
        to,
        templateName: fallbackTemplate,
        languageCode: "en_US",
        components: [{ type: "body", parameters: fallbackParams }],
      });
      console.log(
        `✅ Admin WhatsApp alert sent to ${to} via FALLBACK template (${fallbackTemplate})`
      );
    } catch (err2) {
      const detail = err2?.response?.data?.error?.message || err2.message;
      console.error(
        `❌ Admin WhatsApp alert FAILED on both templates for ${to}: ${detail}`
      );
    }
  }
}

// ---------- Email alert ----------
async function notifyAdminEmail(order) {
  const emails = splitCsv(process.env.ADMIN_EMAIL);
  if (emails.length === 0) return;

  const shopName =
    order?.customerId?.shopName ||
    order?.customerId?.firmName ||
    order?.shippingAddress?.shopName ||
    order?.shippingAddress?.fullName ||
    "Customer";

  const phone =
    order?.customerId?.whatsapp ||
    order?.customerId?.otpMobile ||
    order?.shippingAddress?.phone ||
    "—";

  const addr = order?.shippingAddress || {};
  const fullAddr = [
    addr.fullName,
    addr.street,
    addr.area,
    addr.city,
    addr.state,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const itemRows = (order?.items || [])
    .map(
      (it, i) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee">${i + 1}</td>
        <td style="padding:8px;border-bottom:1px solid #eee">${it.name || ""}<br/><small style="color:#777">SKU: ${it.sku || it.productId?.sku || "—"}</small></td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.qty || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${it.price || 0}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${(it.qty || 0) * (it.price || 0)}</td>
      </tr>`
    )
    .join("");

  const adminPanelUrl =
    process.env.ADMIN_PANEL_URL || "https://admin.bafnatoys.com/admin/orders";

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#f8fafc;padding:20px">
    <div style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);color:#fff;padding:24px;border-radius:12px 12px 0 0">
      <h1 style="margin:0;font-size:22px">🎉 New Order Received!</h1>
      <p style="margin:8px 0 0;opacity:.9">Order <strong>#${order?.orderNumber || "—"}</strong></p>
    </div>

    <div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr>
          <td style="padding:8px 0;color:#64748b">Customer:</td>
          <td style="padding:8px 0;font-weight:600">${shopName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#64748b">Phone:</td>
          <td style="padding:8px 0">${phone}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#64748b">Address:</td>
          <td style="padding:8px 0">${fullAddr || "—"}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#64748b">Payment:</td>
          <td style="padding:8px 0">${order?.paymentMode || "—"}</td>
        </tr>
        ${
          order?.advancePaid
            ? `<tr>
          <td style="padding:8px 0;color:#64748b">Advance Paid:</td>
          <td style="padding:8px 0;color:#16a34a;font-weight:600">₹${order.advancePaid}</td>
        </tr>`
            : ""
        }
        ${
          order?.remainingAmount
            ? `<tr>
          <td style="padding:8px 0;color:#64748b">To Collect (COD):</td>
          <td style="padding:8px 0;color:#dc2626;font-weight:600">₹${order.remainingAmount}</td>
        </tr>`
            : ""
        }
      </table>

      <h3 style="margin:20px 0 10px;color:#1e293b">Items (${(order?.items || []).length})</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:10px;text-align:left">#</th>
            <th style="padding:10px;text-align:left">Product</th>
            <th style="padding:10px;text-align:center">Qty</th>
            <th style="padding:10px;text-align:right">Rate</th>
            <th style="padding:10px;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="background:#fef3c7;font-weight:700">
            <td colspan="4" style="padding:12px;text-align:right">Total:</td>
            <td style="padding:12px;text-align:right;color:#16a34a;font-size:16px">₹${order?.total || 0}</td>
          </tr>
        </tfoot>
      </table>

      <div style="text-align:center;margin-top:24px">
        <a href="${adminPanelUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600">
          📦 Open Admin Panel
        </a>
      </div>

      <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:24px">
        This is an automated alert from Bafnatoys Order System.
      </p>
    </div>
  </div>`;

  const subject = `🎉 New Order #${order?.orderNumber || ""} — ${shopName} — ₹${order?.total || 0}`;

  for (const email of emails) {
    try {
      await sendEmail({ to: email, subject, html });
      console.log(`✅ Admin email alert sent to ${email} for order ${order?.orderNumber}`);
    } catch (err) {
      console.error(`❌ Admin email alert failed for ${email}:`, err.message);
    }
  }
}

// ---------- Combined export ----------
async function notifyAdminNewOrder(order) {
  // Fire both channels in parallel — neither blocks the other
  await Promise.allSettled([
    notifyAdminWhatsApp(order),
    notifyAdminEmail(order),
  ]);
}

module.exports = { notifyAdminNewOrder };
