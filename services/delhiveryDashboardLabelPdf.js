const axios = require("axios");
const bwipjs = require("bwip-js");
const PDFDocument = require("pdfkit");

let logoCache = null;

const barcodeBuffer = (text, height = 16) =>
  new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: "code128",
        text: String(text || ""),
        scale: 4,
        height,
        includetext: false,
        paddingwidth: 0,
        paddingheight: 0,
      },
      (err, png) => (err ? reject(err) : resolve(png))
    );
  });

async function delhiveryLogo(url) {
  if (logoCache) return logoCache;
  try {
    const parsed = new URL(String(url || "https://track.delhivery.com/static/images/new_logo.png"));
    if (parsed.hostname !== "track.delhivery.com") return null;
    const response = await axios.get(parsed.toString(), {
      responseType: "arraybuffer",
      timeout: 10000,
    });
    logoCache = Buffer.from(response.data);
    return logoCache;
  } catch {
    return null;
  }
}

const clean = (value, fallback = "") => String(value ?? fallback).trim();

const money = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount)
    : "0";
};

const shipmentDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return clean(value);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date).replace(/ /g, "-");
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} | ${timePart}`;
};

function renderDelhiveryDashboardLabelPdf(label) {
  return new Promise(async (resolve, reject) => {
    try {
      const awb = clean(label?.wbn);
      const orderId = clean(label?.oid);
      if (!awb || !orderId) throw new Error("Delhivery label data is incomplete");

      const [awbBarcode, orderBarcode, logo] = await Promise.all([
        barcodeBuffer(awb, 13),
        barcodeBuffer(orderId, 12),
        delhiveryLogo(label?.delhivery_logo),
      ]);

      const doc = new PDFDocument({ size: "A4", margin: 0, compress: true });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const x = 28;
      const y = 28;
      const w = 250;
      const h = 387;
      const pad = 5;
      const gray = "#d1d5db";
      const black = "#111111";
      const line = (x1, y1, x2, y2, color = gray, width = 0.6) =>
        doc.save().strokeColor(color).lineWidth(width).moveTo(x1, y1).lineTo(x2, y2).stroke().restore();
      const txt = (text, tx, ty, options = {}) => {
        doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(options.size || 7)
          .fillColor(options.color || black)
          .text(clean(text), tx, ty, {
            width: options.width,
            height: options.height,
            align: options.align || "left",
            lineGap: options.lineGap || 0,
            ellipsis: options.ellipsis !== false,
          });
      };

      doc.save().strokeColor(black).lineWidth(1).rect(x, y, w, h).stroke().restore();

      // Header
      const headerBottom = y + 34;
      txt(clean(label?.snm || label?.cl, "BAFNA TOYS").toUpperCase(), x + pad, y + 12, {
        size: 8,
        width: 125,
      });
      if (logo) {
        // Delhivery's PNG has transparent vertical padding; offset it so the
        // visible wordmark fills the same header area used in Delhivery One.
        doc.image(logo, x + w - 94, y - 12, { width: 90, height: 54 });
      } else {
        txt("DELHIVERY", x + w - 94, y + 11, { size: 15, bold: true, width: 90, align: "right" });
      }
      line(x + 3, headerBottom, x + w - 3, headerBottom);

      // AWB and routing
      txt(`AWB# ${awb}`, x + pad, headerBottom + 7, { size: 8, width: w - 10 });
      doc.image(awbBarcode, x + 50, headerBottom + 20, { fit: [150, 40], align: "center" });
      txt(clean(label?.pin), x + pad, headerBottom + 64, { size: 6.5, width: 55 });
      txt(`AWB# ${awb}`, x + 70, headerBottom + 64, { size: 6.2, bold: true, width: 110, align: "center" });
      txt(clean(label?.sort_code), x + w - 62, headerBottom + 64, { size: 6.5, width: 57, align: "right" });
      const awbBottom = headerBottom + 75;
      line(x + 3, awbBottom, x + w - 3, awbBottom);

      // Ship-to and payment details
      const paymentX = x + 148;
      const shipBottom = awbBottom + 74;
      line(paymentX, awbBottom + 5, paymentX, shipBottom - 5);
      txt("Ship to -", x + pad, awbBottom + 7, { size: 8.5, width: 52 });
      txt(clean(label?.name, "Customer"), x + 48, awbBottom + 7, { size: 8.5, bold: true, width: paymentX - x - 53 });
      txt(clean(label?.address), x + pad, awbBottom + 21, {
        size: 6.8,
        width: paymentX - x - 12,
        height: 21,
        lineGap: 1,
      });
      const cityState = [clean(label?.destination || label?.destination_city), clean(label?.st)].filter(Boolean).join("\n");
      txt(cityState, x + pad, awbBottom + 43, {
        size: 7.5,
        bold: true,
        width: paymentX - x - 12,
        height: 21,
        lineGap: 0,
        ellipsis: false,
      });
      txt(`PIN - ${clean(label?.pin)}`, x + pad, awbBottom + 62, { size: 9, bold: true, width: 130 });

      const paymentMode = clean(label?.pt).toUpperCase() === "COD" ? "COD" : "Prepaid";
      const transport = clean(label?.mot).toUpperCase() === "S" ? "Surface" : "Express";
      txt(`${paymentMode} - ${transport}`, paymentX + 4, awbBottom + 18, { size: 7.5, bold: true, width: w - (paymentX - x) - 9 });
      if (paymentMode === "COD") {
        txt(`INR ${money(label?.cod)}`, paymentX + 4, awbBottom + 31, { size: 10, bold: true, width: 94 });
      }
      line(paymentX + 3, awbBottom + 43, x + w - 3, awbBottom + 43);
      txt("Date", paymentX + 4, awbBottom + 48, { size: 6.5, bold: true, width: 45 });
      txt(shipmentDate(label?.cd), paymentX + 4, awbBottom + 59, { size: 6.2, width: 94 });
      line(x + 3, shipBottom, x + w - 3, shipBottom);

      // Seller and order barcode
      const orderX = x + 148;
      const sellerBottom = shipBottom + 44;
      line(orderX, shipBottom + 5, orderX, sellerBottom - 5);
      txt("Seller:", x + pad, shipBottom + 7, { size: 6.5, width: 28 });
      txt(clean(label?.snm, "Bafna Toys"), x + 29, shipBottom + 7, { size: 7, bold: true, width: 105 });
      txt(clean(label?.sadd), x + pad, shipBottom + 18, {
        size: 6,
        width: orderX - x - 12,
        height: 24,
        lineGap: 0,
        ellipsis: false,
      });
      txt(orderId, orderX + 4, shipBottom + 6, { size: 9, width: 94 });
      doc.image(orderBarcode, orderX + 6, shipBottom + 19, { fit: [92, 21], align: "center" });
      line(x + 3, sellerBottom, x + w - 3, sellerBottom);

      // Product table
      const productHeaderBottom = sellerBottom + 22;
      txt("Product Name", x + pad, sellerBottom + 7, { size: 6.2, bold: true, width: 150 });
      txt("Qty.", x + 162, sellerBottom + 7, { size: 6.2, bold: true, width: 20, align: "center" });
      txt("Price", x + 187, sellerBottom + 7, { size: 6.2, bold: true, width: 28, align: "right" });
      txt("Total", x + 220, sellerBottom + 7, { size: 6.2, bold: true, width: 25, align: "right" });
      line(x + 3, productHeaderBottom, x + w - 3, productHeaderBottom);

      const qty = Math.max(1, Number.parseInt(label?.qty, 10) || 1);
      const total = Number(label?.rs || 0);
      txt(clean(label?.prd, "Shipment"), x + pad, productHeaderBottom + 9, { size: 6.2, width: 150, height: 36 });
      txt(qty, x + 162, productHeaderBottom + 9, { size: 6.2, width: 20, align: "center" });
      txt(money(total / qty), x + 181, productHeaderBottom + 9, { size: 6.2, width: 34, align: "right" });
      txt(money(total), x + 215, productHeaderBottom + 9, { size: 6.2, width: 30, align: "right" });
      txt("Page 1 of 1", x + w - 65, y + h - 15, { size: 5.5, width: 60, align: "right" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderDelhiveryDashboardLabelPdf };
