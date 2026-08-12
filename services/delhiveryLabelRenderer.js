const bwipjs = require('bwip-js');

async function generateBarcodeBase64(text, height = 30) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer({
      bcid: 'code128',
      text: text,
      scale: 4,
      height: height,
      includetext: false,
    }, (err, png) => {
      if (err) resolve('');
      else resolve(`data:image/png;base64,${png.toString('base64')}`);
    });
  });
}

async function renderDelhiveryLabelHTML(order) {
  const awb = order.trackingId || "5228651001131";
  const orderNo = order.orderNumber || "ODR1001057";
  
  const awbBarcode = await generateBarcodeBase64(awb, 30);
  const orderBarcode = await generateBarcodeBase64(orderNo, 20);

  const shopName = order.shippingAddress?.fullName || order.shippingAddress?.shopName || "Customer";
  const address = [order.shippingAddress?.address, order.shippingAddress?.landmark].filter(Boolean).join(", ");
  const city = order.shippingAddress?.city || "";
  const state = order.shippingAddress?.state || "";
  const pincode = order.shippingAddress?.pincode || "";
  const mode = order.paymentMode === "ONLINE" ? "Prepaid" : "COD";
  const amount = order.total || 0;
  const dateStr = new Date(order.createdAt || Date.now()).toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' }) + " | 12:59 PM";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Delhivery Label - ${awb}</title>
  <style>
    @page {
      size: auto;
      margin: 5mm;
    }
    html, body {
      background: #fff;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
    }
    .page-container {
      display: flex;
      justify-content: center;
      padding: 15px;
    }
    .label-card {
      width: 520px;
      border: 1.8px solid #111;
      box-sizing: border-box;
      background: #fff;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1.2px solid #d1d5db;
    }
    .seller-title {
      font-weight: 600;
      font-size: 15px;
      color: #111;
    }
    .logo-delhivery {
      font-weight: 900;
      font-size: 25px;
      font-family: 'Arial Black', Arial, sans-serif;
      letter-spacing: -0.5px;
      color: #000;
    }
    .logo-delhivery span {
      color: #e11d48;
    }
    .awb-box {
      padding: 10px 14px;
      border-bottom: 1.2px solid #d1d5db;
    }
    .awb-txt {
      font-weight: 600;
      font-size: 14.5px;
      color: #111;
    }
    .awb-barcode {
      width: 85%;
      height: 68px;
      object-fit: contain;
      display: block;
      margin: 6px auto 4px auto;
    }
    .routing-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #222;
      padding-top: 4px;
    }
    .middle-grid {
      display: grid;
      grid-template-columns: 1fr 165px;
      border-bottom: 1.2px solid #d1d5db;
    }
    .shipto-box {
      padding: 12px 14px;
      border-right: 1.2px solid #d1d5db;
      font-size: 13px;
      line-height: 1.45;
      color: #222;
    }
    .shipto-title {
      font-weight: 700;
      font-size: 15px;
      color: #000;
    }
    .pin-bold {
      font-weight: 700;
      font-size: 14px;
      margin-top: 6px;
      color: #000;
    }
    .payment-box {
      padding: 12px 14px;
      font-size: 12px;
    }
    .pay-mode {
      font-weight: 700;
      font-size: 13px;
      color: #000;
    }
    .pay-amt {
      font-weight: 700;
      font-size: 16px;
      margin: 5px 0 8px 0;
      color: #000;
    }
    .date-txt {
      font-size: 11.5px;
      color: #555;
      line-height: 1.35;
      border-top: 1px solid #e5e7eb;
      padding-top: 6px;
    }
    .seller-order-grid {
      display: grid;
      grid-template-columns: 1fr 170px;
      border-bottom: 1.2px solid #d1d5db;
    }
    .seller-info {
      padding: 10px 14px;
      border-right: 1.2px solid #d1d5db;
      font-size: 11.5px;
      line-height: 1.4;
      color: #333;
    }
    .order-box {
      padding: 10px 12px;
    }
    .order-no {
      font-weight: 600;
      font-size: 14px;
      color: #111;
      margin-bottom: 2px;
      text-align: left;
    }
    .order-barcode {
      width: 92%;
      height: 46px;
      object-fit: contain;
      display: block;
      margin: 2px auto;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .items-table th {
      text-align: left;
      border-bottom: 1.2px solid #d1d5db;
      padding: 8px 14px;
      font-size: 11.5px;
      font-weight: 700;
      color: #111;
    }
    .items-table td {
      padding: 8px 14px;
      color: #222;
    }
    .footer-row {
      display: flex;
      justify-content: flex-end;
      padding: 8px 14px;
      font-size: 11px;
      color: #333;
    }
    @media print {
      body {
        padding: 0;
        margin: 0;
      }
      .page-container {
        padding: 0;
        display: flex;
        justify-content: center;
      }
      .label-card {
        width: 92% !important;
        max-width: 650px !important;
        border: 2px solid #111 !important;
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <div class="page-container">
    <div class="label-card">
      <div class="header-row">
        <div class="seller-title">BAFNA TOYS</div>
        <div class="logo-delhivery">DELHIVER<span>Y</span></div>
      </div>
      
      <div class="awb-box">
        <div class="awb-txt">AWB# ${awb}</div>
        ${awbBarcode ? `<img class="awb-barcode" src="${awbBarcode}" alt="${awb}" />` : ''}
        <div class="routing-row">
          <span>${pincode}</span>
          <span><strong>AWB# ${awb}</strong></span>
          <span>SRI/DSA</span>
        </div>
      </div>

      <div class="middle-grid">
        <div class="shipto-box">
          <div>Ship to - <span class="shipto-title">${shopName}</span></div>
          <div style="color: #444; margin-top: 2px;">${address}</div>
          <div style="margin-top: 3px;"><strong>${city}${state ? ' (' + state + ')' : ''}</strong></div>
          <div class="pin-bold">PIN - ${pincode}</div>
        </div>
        <div class="payment-box">
          <div class="pay-mode">${mode} - Surface</div>
          <div class="pay-amt">INR ${amount}</div>
          <div class="date-txt">Date<br>${dateStr}</div>
        </div>
      </div>

      <div class="seller-order-grid">
        <div class="seller-info">
          <div>Seller: <strong>Bafna Toys</strong></div>
          <div style="color: #555; margin-top: 2px;">Bafna Toys 1, Shasha Warehousing, Thondamuthur Main Road, Coimbatore - 641007</div>
        </div>
        <div class="order-box">
          <div class="order-no">${orderNo}</div>
          ${orderBarcode ? `<img class="order-barcode" src="${orderBarcode}" alt="${orderNo}" />` : ''}
        </div>
      </div>

      <table class="items-table">
        <thead>
          <tr>
            <th>Product Name</th>
            <th style="text-align:center;">Qty.</th>
            <th style="text-align:right;">Price</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Bafna toys box 1 of 1</td>
            <td style="text-align:center;">1</td>
            <td style="text-align:right;">${amount}</td>
            <td style="text-align:right;">${amount}</td>
          </tr>
        </tbody>
      </table>

      <div class="footer-row">Page 1 of 1</div>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 400);
    };
  </script>
</body>
</html>`;
}

module.exports = { renderDelhiveryLabelHTML };
