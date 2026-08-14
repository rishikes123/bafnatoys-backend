// backend/controllers/delhiveryAdminController.js
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const Order = require("../models/orderModel");
const svc = require("../services/delhiveryService");
const { renderDelhiveryDashboardLabelPdf } = require("../services/delhiveryDashboardLabelPdf");

/* ---------------------------------------------------------------
   1. WALLET BALANCE
   --------------------------------------------------------------- */
exports.wallet = async (_req, res) => {
  const result = await svc.getWalletBalance();
  return res.json(result);
};

/* ---------------------------------------------------------------
   2. SHIPMENTS LIST (from our DB + live tracking merge)
   Query: ?status=all|in_transit|delivered|rto|pending&search=&page=&limit=
   --------------------------------------------------------------- */
exports.listShipments = async (req, res) => {
  try {
    const {
      status = "all",
      search = "",
      page = 1,
      limit = 50,
    } = req.query;

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    // Base filter: only orders with AWB
    const filter = { trackingId: { $ne: "" } };

    if (status && status !== "all") {
      // Map UI status to DB status
      const map = {
        shipped: "shipped",
        delivered: "delivered",
        processing: "processing",
        cancelled: "cancelled",
      };
      if (map[status]) filter.status = map[status];
    }

    if (search && String(search).trim()) {
      const rx = new RegExp(
        String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i"
      );
      filter.$or = [
        { orderNumber: rx },
        { trackingId: rx },
        { "shippingAddress.fullName": rx },
        { "shippingAddress.phone": rx },
        { "shippingAddress.pincode": rx },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l)
        .select(
          "orderNumber trackingId courierName status isShipped total paymentMode shippingAddress createdAt"
        )
        .lean(),
      Order.countDocuments(filter),
    ]);

    // Live tracking: fetch statuses for all AWBs in a single Delhivery call
    const waybills = orders.map((o) => o.trackingId).filter(Boolean);
    let liveMap = {};
    if (waybills.length) {
      try {
        const tracking = await svc.trackMultiple(waybills);
        const shipments = tracking?.ShipmentData || [];
        shipments.forEach((entry) => {
          const s = entry?.Shipment;
          if (!s) return;
          liveMap[s.AWB] = {
            status: s.Status?.Status || "",
            statusDate: s.Status?.StatusDateTime || null,
            instructions: s.Status?.Instructions || "",
            location: s.Status?.StatusLocation || "",
            nsl: s.Status?.StatusType || "", // UD/RT/DL/PU etc
            expectedDate: s.ExpectedDeliveryDate || null,
            originCity: s.Origin || "",
            destCity: s.Destination || "",
            weight: s.ChargedWeight || s.ActualWeight || s.Weight || s.chargedWeight || 0,
          };
        });
      } catch {
        // tracking failed — still return DB data
      }
    }

    const merged = orders.map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      awb: o.trackingId,
      courier: o.courierName || "Delhivery",
      dbStatus: o.status,
      paymentMode: o.paymentMode,
      total: o.total,
      customer: {
        name: o.shippingAddress?.fullName,
        phone: o.shippingAddress?.phone,
        pincode: o.shippingAddress?.pincode,
        city: o.shippingAddress?.city,
        state: o.shippingAddress?.state,
      },
      createdAt: o.createdAt,
      live: liveMap[o.trackingId] || null,
    }));

    res.json({
      items: merged,
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l),
    });
  } catch (err) {
    console.error("delhivery/shipments error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------
   3. TRACK SINGLE AWB (detailed scan history)
   --------------------------------------------------------------- */
exports.trackOne = async (req, res) => {
  try {
    const { awb } = req.params;
    if (!awb) return res.status(400).json({ message: "AWB required" });
    const data = await svc.trackPackage(awb);
    const shipment = data?.ShipmentData?.[0]?.Shipment || null;
    res.json({ ok: true, shipment, raw: data });
  } catch (err) {
    console.error("delhivery/track error:", err);
    res.status(500).json({
      message: err?.response?.data?.message || err.message || "Track failed",
    });
  }
};

/* ---------------------------------------------------------------
   4. PINCODE SERVICEABILITY
   --------------------------------------------------------------- */
exports.pincode = async (req, res) => {
  try {
    const { pin } = req.params;
    if (!/^\d{6}$/.test(String(pin))) {
      return res.status(400).json({ message: "Enter valid 6-digit pincode" });
    }
    const data = await svc.checkPincode(pin);
    const row = data?.delivery_codes?.[0]?.postal_code || null;

    if (!row) {
      return res.json({
        ok: false,
        serviceable: false,
        message: "Not serviceable by Delhivery",
      });
    }

    res.json({
      ok: true,
      serviceable: true,
      pincode: row.pin,
      district: row.district,
      city: row.city,
      state: row.state_code,
      covid_zone: row.covid_zone,
      cod: String(row.cod).toUpperCase() === "Y",
      prepaid: String(row.pre_paid).toUpperCase() === "Y",
      pickup: String(row.pickup).toUpperCase() === "Y",
      repl: String(row.repl).toUpperCase() === "Y",
      cash: String(row.cash).toUpperCase() === "Y",
      max_amount: row.max_amount,
      raw: row,
    });
  } catch (err) {
    console.error("delhivery/pincode error:", err);
    res.status(500).json({
      message: err?.response?.data?.message || err.message || "Lookup failed",
    });
  }
};

/* ---------------------------------------------------------------
   5. RATE CALCULATOR
   --------------------------------------------------------------- */
exports.rate = async (req, res) => {
  try {
    const {
      o_pin, // origin pin (aapka warehouse)
      d_pin, // destination
      cgm = 500,
      pt = "Pre-paid",
      cod = 0,
      md = "E",
    } = req.body || {};

    if (!o_pin || !d_pin) {
      return res
        .status(400)
        .json({ message: "Origin + destination pincode required" });
    }

    const [express, surface] = await Promise.all([
      svc.getShippingRate({ o_pin, d_pin, cgm, pt, cod, md: "E" }).catch(() => null),
      svc.getShippingRate({ o_pin, d_pin, cgm, pt, cod, md: "S" }).catch(() => null),
    ]);

    const pickBest = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

    res.json({
      ok: true,
      express: pickBest(express),
      surface: pickBest(surface),
      params: { o_pin, d_pin, cgm, pt, cod },
    });
  } catch (err) {
    console.error("delhivery/rate error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------
   6. PICKUP REQUEST
   --------------------------------------------------------------- */
const indiaDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
};

const addDays = (yyyyMmDd, days) => {
  const date = new Date(`${yyyyMmDd}T00:00:00+05:30`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

async function markOrdersPickupScheduled({ orderIds, orderId, pickupId, pickupDate, pickupTime }) {
  const set = {
    pickupStatus: "scheduled",
    pickupDate,
    pickupSlot: pickupTime,
  };
  if (pickupId) set.pickupId = String(pickupId);

  const eligible = {
    isShipped: true,
    trackingId: { $exists: true, $ne: "" },
    courierName: { $regex: /delhivery/i },
    status: { $nin: ["cancelled", "delivered"] },
  };
  if (Array.isArray(orderIds) && orderIds.length) {
    return Order.updateMany({ ...eligible, _id: { $in: orderIds } }, { $set: set });
  }
  if (orderId) {
    return Order.updateOne({ ...eligible, _id: orderId }, { $set: set });
  }
  return Order.updateMany(eligible, { $set: set });
}

exports.pickupConfig = async (_req, res) => {
  res.json({
    configured: svc.isConfigured(),
    pickupLocation: svc.PICKUP_LOCATION,
    warehousePincode: process.env.DELHIVERY_WAREHOUSE_PINCODE || "",
    rules: { maxAdvanceDays: 7, warehouseLevel: true },
  });
};

const pickupBaseFilter = {
  isShipped: true,
  trackingId: { $exists: true, $ne: "" },
  courierName: { $regex: /delhivery/i },
};

const shipmentWasPicked = (shipment = {}) => {
  const status = String(shipment?.Status?.Status || "").trim().toLowerCase();
  const instructions = String(shipment?.Status?.Instructions || "").trim().toLowerCase();
  const explicitPickupScan = /shipment\s+picked\s*up|picked\s*up|pickup completed/.test(instructions);
  const progressedAfterPickup = /^(in transit|dispatched|delivered|rto|rto in transit|returned)$/.test(status);
  return explicitPickupScan || (Boolean(shipment?.PickUpDate) && progressedAfterPickup);
};

const syncLivePickupStatuses = async () => {
  const candidates = await Order.find({
    ...pickupBaseFilter,
    status: { $ne: "cancelled" },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .select("trackingId")
    .lean();

  const awbs = [...new Set(candidates.map((order) => String(order.trackingId || "").trim()).filter(Boolean))];
  if (!awbs.length || !svc.isConfigured()) return {};

  const chunks = [];
  for (let index = 0; index < awbs.length; index += 50) chunks.push(awbs.slice(index, index + 50));
  const responses = await Promise.allSettled(chunks.map((chunk) => svc.trackMultiple(chunk)));
  const liveMap = {};

  responses.forEach((response) => {
    if (response.status !== "fulfilled") return;
    (response.value?.ShipmentData || []).forEach((entry) => {
      const shipment = entry?.Shipment;
      const awb = String(shipment?.AWB || "").trim();
      if (!shipment || !awb) return;
      liveMap[awb] = {
        status: shipment.Status?.Status || "",
        instructions: shipment.Status?.Instructions || "",
        statusDate: shipment.Status?.StatusDateTime || null,
        pickupDate: shipment.PickUpDate || null,
        picked: shipmentWasPicked(shipment),
      };
    });
  });

  const pickedAwbs = Object.entries(liveMap)
    .filter(([, live]) => live.picked)
    .map(([awb]) => awb);
  if (pickedAwbs.length) {
    await Order.updateMany(
      { ...pickupBaseFilter, trackingId: { $in: pickedAwbs } },
      { $set: { pickupStatus: "picked_up" } }
    );
  }

  return liveMap;
};

exports.pickupOrders = async (req, res) => {
  try {
    const {
      view = "ready",
      search = "",
      page = 1,
      limit = 100,
    } = req.query;
    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 100));
    let liveMap = {};
    try {
      liveMap = await syncLivePickupStatuses();
    } catch (trackingError) {
      console.warn("delhivery pickup live sync failed:", trackingError.message);
    }

    const filter = {
      ...pickupBaseFilter,
      status: view === "picked" ? { $ne: "cancelled" } : { $nin: ["cancelled", "delivered"] },
    };

    if (view === "scheduled") filter.pickupStatus = "scheduled";
    if (view === "ready") filter.pickupStatus = { $nin: ["scheduled", "picked_up"] };
    if (view === "picked") filter.pickupStatus = "picked_up";
    if (String(search).trim()) {
      const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(escaped, "i");
      filter.$or = [
        { orderNumber: rx },
        { trackingId: rx },
        { "shippingAddress.fullName": rx },
        { "shippingAddress.shopName": rx },
        { "shippingAddress.phone": rx },
      ];
    }

    const [orders, total, readyCount, scheduledCount, pickedCount] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageSize)
        .limit(pageSize)
        .select(
          "orderNumber trackingId courierName status total paymentMode shippingAddress createdAt pickupStatus pickupId pickupDate pickupSlot packingDetails"
        )
        .lean(),
      Order.countDocuments(filter),
      Order.countDocuments({
        ...pickupBaseFilter,
        status: { $nin: ["cancelled", "delivered"] },
        pickupStatus: { $nin: ["scheduled", "picked_up"] },
      }),
      Order.countDocuments({
        ...pickupBaseFilter,
        status: { $nin: ["cancelled", "delivered"] },
        pickupStatus: "scheduled",
      }),
      Order.countDocuments({
        ...pickupBaseFilter,
        status: { $ne: "cancelled" },
        pickupStatus: "picked_up",
      }),
    ]);

    return res.json({
      ok: true,
      items: orders.map((order) => {
        const live = liveMap[String(order.trackingId || "").trim()] || {};
        return {
          _id: order._id,
          orderNumber: order.orderNumber,
          awb: order.trackingId,
          courier: order.courierName,
          status: order.status,
          total: order.total,
          paymentMode: order.paymentMode,
          customer: {
            name: order.shippingAddress?.shopName || order.shippingAddress?.fullName || "",
            phone: order.shippingAddress?.phone || "",
            city: order.shippingAddress?.city || "",
            state: order.shippingAddress?.state || "",
            pincode: order.shippingAddress?.pincode || "",
          },
          pickupStatus: order.pickupStatus || "pending",
          pickupId: order.pickupId || "",
          pickupDate: order.pickupDate || "",
          pickupSlot: order.pickupSlot || "",
          pickedAt: live.pickupDate || live.statusDate || null,
          liveStatus: live.status || "",
          liveInstructions: live.instructions || "",
          packingDetails: order.packingDetails || [],
          createdAt: order.createdAt,
        };
      }),
      total,
      page: currentPage,
      limit: pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      counts: { ready: readyCount, scheduled: scheduledCount, picked: pickedCount },
    });
  } catch (err) {
    console.error("delhivery/pickup-orders error:", err.message);
    return res.status(500).json({ ok: false, message: err.message || "Could not load pickup orders" });
  }
};

exports.createPickup = async (req, res) => {
  try {
    const {
      pickup_date,
      pickup_time = "14:00:00",
      expected_package_count = 1,
      pickup_location,
      orderIds,
      orderId,
    } = req.body || {};

    const pickupDate = String(pickup_date || "").trim();
    const pickupTime = String(pickup_time || "").trim();
    const packageCount = Number(expected_package_count);
    const location = String(pickup_location || svc.PICKUP_LOCATION || "").trim();
    const today = indiaDateString();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || Number.isNaN(Date.parse(`${pickupDate}T00:00:00+05:30`))) {
      return res.status(400).json({ ok: false, message: "Pickup date must be in YYYY-MM-DD format" });
    }
    if (pickupDate < today) {
      return res.status(400).json({ ok: false, message: "Pickup date cannot be in the past" });
    }
    if (pickupDate > addDays(today, 7)) {
      return res.status(400).json({ ok: false, message: "Pickup date must be within the next 7 days" });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(pickupTime)) {
      return res.status(400).json({ ok: false, message: "Pickup time must be HH:mm:ss" });
    }
    if (!Number.isInteger(packageCount) || packageCount < 1 || packageCount > 10000) {
      return res.status(400).json({ ok: false, message: "Expected package count must be between 1 and 10000" });
    }
    if (!location) {
      return res.status(400).json({ ok: false, message: "Delhivery pickup location is not configured" });
    }

    const result = await svc.createPickupRequest({
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      expected_package_count: packageCount,
      pickup_location: location,
    });

    try {
      await markOrdersPickupScheduled({
        orderIds,
        orderId,
        pickupId: result.pickupId,
        pickupDate,
        pickupTime,
      });
    } catch (dbErr) {
      console.warn("Pickup was accepted, but local order status update failed:", dbErr.message);
    }

    return res.json({
      ok: true,
      pickup_id: result.pickupId,
      pr_exist: result.alreadyExists,
      message: result.message,
      pickup_location: location,
      pickup_date: pickupDate,
      pickup_time: pickupTime,
      expected_package_count: packageCount,
    });
  } catch (err) {
    console.error("delhivery/pickup error:", err.message);
    const status = err.code === "DELHIVERY_NOT_CONFIGURED"
      ? 503
      : err.status >= 400 && err.status < 500
        ? err.status
        : 502;
    return res.status(status).json({
      ok: false,
      message: err.message || "Pickup request failed",
      details: err.details || undefined,
    });
  }
};

exports.toggleOrderPickupStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { pickupStatus, pickupId, pickupDate, pickupSlot } = req.body || {};
    const order = await Order.findById(id);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const newStatus = pickupStatus || (order.pickupStatus === "scheduled" ? "pending" : "scheduled");
    order.pickupStatus = newStatus;
    if (pickupId) order.pickupId = pickupId;
    if (pickupDate) order.pickupDate = pickupDate;
    if (pickupSlot) order.pickupSlot = pickupSlot;
    await order.save();

    res.json({ ok: true, order, pickupStatus: newStatus });
  } catch (err) {
    console.error("toggleOrderPickupStatus error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------
   7. PRINT LABEL — stream Delhivery packing slip PDF
   GET /delhivery/label/:awb   (or ?awbs=awb1,awb2 for bulk)
   --------------------------------------------------------------- */
exports.printLabel = async (req, res) => {
  try {
    const awb = String(req.params.awb || req.query.awb || "").trim();
    if (!awb) return res.status(400).json({ ok: false, message: "AWB required" });
    const useOfficialClassicTemplate = req.query.template === "classic";
    const pdf = useOfficialClassicTemplate
      ? await svc.getPackingSlip(awb, { pdfSize: req.query.size })
      : await renderDelhiveryDashboardLabelPdf(await svc.getPackingSlipData(awb));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="delhivery-label-${awb}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error("delhivery/label error:", err.message);
    const status = err.code === "DELHIVERY_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json({
      ok: false,
      message: err.message || "Failed to fetch the official Delhivery shipping label",
    });
  }
};

/* ---------------------------------------------------------------
   7b. BULK PRINT LABEL — POST body: { awbs: ["awb1","awb2"] }
   --------------------------------------------------------------- */
exports.printLabelBulk = async (req, res) => {
  try {
    const { awbs, pdfSize = "A4", template = "dashboard" } = req.body || {};
    if (!Array.isArray(awbs) || awbs.length === 0) {
      return res.status(400).json({ message: "awbs array required" });
    }
    const uniqueAwbs = [...new Set(awbs.map((awb) => String(awb || "").trim()).filter(Boolean))];
    if (uniqueAwbs.length > 50) {
      return res.status(400).json({ message: "A maximum of 50 labels can be generated at once" });
    }

    const output = await PDFDocument.create();
    for (const awb of uniqueAwbs) {
      const pdfBytes = template === "classic"
        ? await svc.getPackingSlip(awb, { pdfSize })
        : await renderDelhiveryDashboardLabelPdf(await svc.getPackingSlipData(awb));
      const source = await PDFDocument.load(pdfBytes);
      const pages = await output.copyPages(source, source.getPageIndices());
      pages.forEach((page) => output.addPage(page));
    }
    const merged = Buffer.from(await output.save());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(merged.length));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", "inline; filename=delhivery-labels-bulk.pdf");
    return res.send(merged);
  } catch (err) {
    console.error("delhivery/label-bulk error:", err.message);
    return res.status(err.code === "DELHIVERY_NOT_CONFIGURED" ? 503 : 502).json({
      ok: false,
      message: err.message || "Failed to fetch official Delhivery labels",
    });
  }
};

/* ---------------------------------------------------------------
   8. NDR DASHBOARD — fetch shipped orders + filter those in NDR state
   --------------------------------------------------------------- */
exports.ndrList = async (_req, res) => {
  try {
    // Only shipped or processing orders (not delivered / not cancelled)
    const orders = await Order.find({
      trackingId: { $ne: "" },
      status: { $in: ["shipped", "processing"] },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .select("orderNumber trackingId shippingAddress total paymentMode createdAt")
      .lean();

    const waybills = orders.map((o) => o.trackingId).filter(Boolean);
    if (!waybills.length) return res.json({ items: [] });

    const tracking = await svc.trackMultiple(waybills).catch(() => null);
    const shipments = tracking?.ShipmentData || [];

    // NDR = any status indicating failed delivery attempt.
    // StatusType "UD" (Undelivered), or status text includes "NDR" / "Attempted" / "Undelivered"
    const NDR_TYPES = new Set(["UD", "RT"]); // UD=undelivered, RT=in RTO flow
    const ndrItems = [];
    shipments.forEach((entry) => {
      const s = entry?.Shipment;
      if (!s) return;
      const type = s.Status?.StatusType || "";
      const statusText = (s.Status?.Status || "").toLowerCase();
      const isNDR =
        NDR_TYPES.has(type) ||
        /ndr|undelivered|attempt|unable to deliver|rto/i.test(statusText);

      if (isNDR) {
        const order = orders.find((o) => o.trackingId === s.AWB);
        ndrItems.push({
          awb: s.AWB,
          orderNumber: order?.orderNumber || "",
          statusType: type,
          status: s.Status?.Status || "",
          instructions: s.Status?.Instructions || "",
          location: s.Status?.StatusLocation || "",
          lastUpdate: s.Status?.StatusDateTime || null,
          expectedDate: s.ExpectedDeliveryDate || null,
          attempts: (s.Scans || []).filter(
            (x) =>
              /attempt|ndr|undelivered/i.test(x?.ScanDetail?.Instructions || "") ||
              x?.ScanDetail?.StatusType === "UD"
          ).length,
          customer: order
            ? {
                name: order.shippingAddress?.fullName,
                phone: order.shippingAddress?.phone,
                city: order.shippingAddress?.city,
                pincode: order.shippingAddress?.pincode,
                total: order.total,
                paymentMode: order.paymentMode,
              }
            : null,
        });
      }
    });

    res.json({ items: ndrItems });
  } catch (err) {
    console.error("delhivery/ndr error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------
   8. NDR ACTION (re-attempt / RTO)
   --------------------------------------------------------------- */
exports.ndrAction = async (req, res) => {
  try {
    const { awb } = req.params;
    const { act = "RE-ATTEMPT" } = req.body || {};

    const allowed = ["RE-ATTEMPT", "RTO", "DEFER_DLV"];
    if (!allowed.includes(act)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const data = await svc.ndrAction({ waybill: awb, act });
    res.json({ ok: true, data });
  } catch (err) {
    console.error("delhivery/ndr-action error:", err);
    res.status(400).json({
      ok: false,
      message:
        err?.response?.data?.message ||
        err.message ||
        "NDR action failed",
      raw: err?.response?.data,
    });
  }
};

/* ---------------------------------------------------------------
   9. TRANSACTIONS — wallet recharge/debit history from Delhivery
       + computed per-shipment ledger from our DB
   --------------------------------------------------------------- */
exports.transactions = async (req, res) => {
  try {
    const { from, to, days = 30 } = req.query;

    const nowSec = Math.floor(Date.now() / 1000);
    const fromTs = from ? parseInt(from) : nowSec - parseInt(days) * 86400;
    const toTs = to ? parseInt(to) : nowSec;

    // 1. Try Delhivery's live wallet transactions API
    const walletResp = await svc.getWalletTransactions({ from: fromTs, to: toTs, limit: 200 });

    // Normalize Delhivery response → common txn format
    let walletTxns = [];
    if (walletResp.ok && walletResp.data) {
      const raw = walletResp.data;
      const list =
        raw?.data ||
        raw?.transactions ||
        raw?.results ||
        (Array.isArray(raw) ? raw : []);

      walletTxns = (list || []).map((t) => ({
        source: "delhivery_wallet",
        id: t.id || t.transaction_id || t.txn_id || "",
        date: t.created_at || t.date || t.txn_date || null,
        type: (t.type || t.transaction_type || "").toUpperCase(), // RECHARGE/DEBIT/REFUND
        amount: Number(t.amount) || 0,
        balance: t.closing_balance ?? t.balance ?? null,
        description: t.description || t.remarks || t.narration || "",
        awb: t.waybill || t.awb || "",
        raw: t,
      }));
    }

    // 2. ALWAYS compute a per-shipment ledger from our orders
    //    (works even if wallet API is blocked for this account)
    const Order = require("../models/orderModel");
    const orders = await Order.find({
      trackingId: { $ne: "" },
      createdAt: { $gte: new Date(fromTs * 1000) },
    })
      .select(
        "orderNumber trackingId total paymentMode shippingAddress shippingPrice createdAt"
      )
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    // For each order, use our stored shippingPrice as debit estimate
    const computedTxns = orders.map((o) => ({
      source: "computed_shipment",
      id: o.trackingId,
      date: o.createdAt,
      type: "DEBIT",
      amount: Number(o.shippingPrice) || 0, // what we charged the customer
      description: `Shipment for #${o.orderNumber}`,
      awb: o.trackingId,
      orderNumber: o.orderNumber,
      paymentMode: o.paymentMode,
      orderTotal: o.total,
      destination: `${o.shippingAddress?.city || ""}, ${o.shippingAddress?.pincode || ""}`,
    }));

    // Summary
    const walletDebit = walletTxns
      .filter((t) => t.type === "DEBIT" || t.type === "SHIPMENT_CHARGE")
      .reduce((s, t) => s + t.amount, 0);
    const walletCredit = walletTxns
      .filter((t) => t.type === "RECHARGE" || t.type === "CREDIT" || t.type === "REFUND")
      .reduce((s, t) => s + t.amount, 0);

    const computedDebit = computedTxns.reduce((s, t) => s + t.amount, 0);
    const shipmentCount = computedTxns.length;

    res.json({
      walletAvailable: walletResp.ok,
      walletMessage: walletResp.ok
        ? null
        : "Live wallet transaction API not enabled for this account.",
      range: {
        fromTs,
        toTs,
        days: Math.ceil((toTs - fromTs) / 86400),
      },
      summary: {
        walletDebit,
        walletCredit,
        computedDebit,
        shipmentCount,
        netOutflow: walletDebit || computedDebit,
      },
      walletTxns,
      computedTxns,
    });
  } catch (err) {
    console.error("delhivery/transactions error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};

/* ---------------------------------------------------------------
   10. QUICK STATS — dashboard summary cards
   --------------------------------------------------------------- */
exports.stats = async (_req, res) => {
  try {
    const last30d = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [shipped30, delivered30, totalShipped, pendingAwb] = await Promise.all([
      Order.countDocuments({
        createdAt: { $gte: last30d },
        trackingId: { $ne: "" },
      }),
      Order.countDocuments({
        createdAt: { $gte: last30d },
        status: "delivered",
      }),
      Order.countDocuments({ trackingId: { $ne: "" } }),
      Order.countDocuments({
        status: { $in: ["pending", "processing"] },
        trackingId: "",
      }),
    ]);

    const deliveryRate =
      shipped30 > 0 ? Math.round((delivered30 / shipped30) * 100) : 0;

    res.json({
      last30Days: {
        shipped: shipped30,
        delivered: delivered30,
        deliveryRate,
      },
      totalShipped,
      pendingAwb,
    });
  } catch (err) {
    console.error("delhivery/stats error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};
