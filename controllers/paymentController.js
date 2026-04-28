const Razorpay = require("razorpay");
const crypto = require("crypto");
const Order = require("../models/orderModel");

// Razorpay Initialization using your specific .env keys
const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY, // matched with your .env
  key_secret: process.env.RAZORPAY_SECRET, // matched with your .env
});

/* ========================================================================
   1. Create Razorpay Order (customer checkout)
   ======================================================================== */
exports.createOrder = async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ message: "Amount is required" });
    }

    const options = {
      amount: Math.round(Number(amount) * 100), // convert to paise
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    };

    const order = await razorpayInstance.orders.create(options);
    res.status(200).json(order);
  } catch (error) {
    console.error("Razorpay Order Error:", error);
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

/* ========================================================================
   2. Verify Payment Signature
   ======================================================================== */
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac("sha256", process.env.RAZORPAY_SECRET)
      .update(sign.toString())
      .digest("hex");

    if (razorpay_signature === expectedSign) {
      return res.status(200).json({ success: true, message: "Payment verified successfully" });
    } else {
      return res.status(400).json({ success: false, message: "Invalid payment signature" });
    }
  } catch (error) {
    console.error("Verification Error:", error);
    res.status(500).json({ message: "Internal Server Error", error });
  }
};

/* ========================================================================
   ADMIN ENDPOINTS — Transaction Details from Razorpay API
   ========================================================================
   All routes below are protected by adminProtect middleware in routes file.
   They fetch directly from Razorpay API (single source of truth) so numbers
   always match what Razorpay dashboard shows.
   ======================================================================== */

/**
 * GET /api/payments/admin/transactions
 * Query: ?from=<unix>&to=<unix>&count=100&skip=0&method=&status=&search=
 *
 * Returns all Razorpay payments (captured + failed + authorized + refunded).
 * Razorpay API docs: https://razorpay.com/docs/api/payments/fetch-all/
 */
exports.listTransactions = async (req, res) => {
  try {
    const {
      from,       // unix seconds
      to,         // unix seconds
      count = 100,
      skip = 0,
      method,     // card/upi/netbanking/wallet/emi
      status,     // captured/authorized/failed/refunded
      search,     // search email/contact/paymentId
    } = req.query;

    const params = {
      count: Math.min(100, Math.max(1, parseInt(count))),
      skip: Math.max(0, parseInt(skip)),
    };
    if (from) params.from = parseInt(from);
    if (to) params.to = parseInt(to);

    const result = await razorpayInstance.payments.all(params);

    let items = result.items || [];

    // Client-side filters (Razorpay API doesn't filter by method/status in list)
    if (method) {
      items = items.filter((p) => (p.method || "").toLowerCase() === String(method).toLowerCase());
    }
    if (status) {
      items = items.filter((p) => (p.status || "").toLowerCase() === String(status).toLowerCase());
    }
    if (search) {
      const q = String(search).trim().toLowerCase();
      items = items.filter(
        (p) =>
          (p.email || "").toLowerCase().includes(q) ||
          (p.contact || "").toLowerCase().includes(q) ||
          (p.id || "").toLowerCase().includes(q) ||
          (p.order_id || "").toLowerCase().includes(q)
      );
    }

    // DB lookup: payment IDs se website order numbers dhundo
    const paymentIds = items.map((p) => p.id).filter(Boolean);
    const dbOrders = await Order.find(
      { razorpayPaymentId: { $in: paymentIds } },
      { razorpayPaymentId: 1, orderNumber: 1 }
    ).lean();
    const paymentToOrderNum = {};
    dbOrders.forEach((o) => {
      if (o.razorpayPaymentId) paymentToOrderNum[o.razorpayPaymentId] = o.orderNumber;
    });

    // Slim payload for table — convert paise->rupees, pick core fields
    const mapped = items.map((p) => ({
      id: p.id,
      orderId: p.order_id,
      siteOrderNumber: paymentToOrderNum[p.id] || null,
      amount: (p.amount || 0) / 100,
      currency: p.currency,
      status: p.status,
      method: p.method,
      captured: p.captured,
      email: p.email,
      contact: p.contact,
      fee: (p.fee || 0) / 100,
      tax: (p.tax || 0) / 100,
      errorCode: p.error_code,
      errorDescription: p.error_description,
      international: p.international,
      createdAt: p.created_at ? new Date(p.created_at * 1000).toISOString() : null,
      // Card info if payment is card
      card: p.card
        ? {
            last4: p.card.last4,
            network: p.card.network,
            type: p.card.type, // debit/credit
          }
        : null,
      // UPI vpa
      vpa: p.vpa || null,
      // Bank for netbanking
      bank: p.bank || null,
      // Refund summary
      amountRefunded: (p.amount_refunded || 0) / 100,
      refundStatus: p.refund_status || null,
    }));

    res.json({
      items: mapped,
      count: mapped.length,
      hasMore: (result.items || []).length >= params.count, // rough hint
    });
  } catch (err) {
    console.error("Razorpay listTransactions error:", err);
    res.status(500).json({
      message: err?.error?.description || err.message || "Server error",
    });
  }
};

/**
 * GET /api/payments/admin/transaction/:id
 * Returns full payment details + refunds list.
 */
exports.transactionDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const p = await razorpayInstance.payments.fetch(id);

    // Fetch refunds for this payment
    let refunds = [];
    try {
      const refundResult = await razorpayInstance.payments.fetchMultipleRefund(id);
      refunds = (refundResult.items || []).map((r) => ({
        id: r.id,
        amount: (r.amount || 0) / 100,
        status: r.status,
        speedProcessed: r.speed_processed,
        speedRequested: r.speed_requested,
        createdAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
        notes: r.notes || {},
      }));
    } catch {
      // no refunds or API error — ignore
    }

    res.json({
      // Raw Razorpay-like full payload (with paise converted)
      payment: {
        id: p.id,
        orderId: p.order_id,
        amount: (p.amount || 0) / 100,
        currency: p.currency,
        status: p.status,
        method: p.method,
        captured: p.captured,
        description: p.description,
        email: p.email,
        contact: p.contact,
        name: p.card?.name || null,
        fee: (p.fee || 0) / 100,
        tax: (p.tax || 0) / 100,
        netAmount: ((p.amount || 0) - (p.fee || 0)) / 100,
        errorCode: p.error_code,
        errorDescription: p.error_description,
        errorSource: p.error_source,
        errorStep: p.error_step,
        errorReason: p.error_reason,
        international: p.international,
        createdAt: p.created_at ? new Date(p.created_at * 1000).toISOString() : null,
        card: p.card
          ? {
              last4: p.card.last4,
              network: p.card.network,
              type: p.card.type,
              issuer: p.card.issuer,
              international: p.card.international,
              name: p.card.name,
            }
          : null,
        vpa: p.vpa || null,
        bank: p.bank || null,
        wallet: p.wallet || null,
        acquirerData: p.acquirer_data || null,
        notes: p.notes || {},
        amountRefunded: (p.amount_refunded || 0) / 100,
        refundStatus: p.refund_status || null,
      },
      refunds,
    });
  } catch (err) {
    console.error("Razorpay transactionDetail error:", err);
    res.status(500).json({
      message: err?.error?.description || err.message || "Server error",
    });
  }
};

/**
 * GET /api/payments/admin/stats
 * Dashboard summary for last N days (default 30).
 * Iterates through all payments in the window and computes totals.
 */
exports.paymentStats = async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days || "30")));
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 24 * 60 * 60;

    // Fetch up to 300 payments (Razorpay max 100 per call, 3 pages)
    let all = [];
    let skip = 0;
    for (let i = 0; i < 3; i++) {
      const resp = await razorpayInstance.payments.all({
        from,
        to,
        count: 100,
        skip,
      });
      const arr = resp.items || [];
      all = all.concat(arr);
      if (arr.length < 100) break;
      skip += 100;
    }

    const captured = all.filter((p) => p.status === "captured");
    const failed = all.filter((p) => p.status === "failed");
    const refunded = all.filter((p) => (p.amount_refunded || 0) > 0);

    const totalRevenue = captured.reduce((s, p) => s + (p.amount || 0), 0) / 100;
    const totalFees = captured.reduce((s, p) => s + (p.fee || 0), 0) / 100;
    const totalTax = captured.reduce((s, p) => s + (p.tax || 0), 0) / 100;
    const totalRefunded =
      refunded.reduce((s, p) => s + (p.amount_refunded || 0), 0) / 100;

    // Method breakdown
    const methodMap = {};
    captured.forEach((p) => {
      const m = p.method || "other";
      if (!methodMap[m]) methodMap[m] = { count: 0, value: 0 };
      methodMap[m].count += 1;
      methodMap[m].value += (p.amount || 0) / 100;
    });

    const attempted = all.length;
    const successRate =
      attempted > 0 ? Math.round((captured.length / attempted) * 100) : 0;

    res.json({
      days,
      totalRevenue,
      totalFees,
      totalTax,
      netRevenue: totalRevenue - totalFees,
      totalRefunded,
      capturedCount: captured.length,
      failedCount: failed.length,
      attemptedCount: attempted,
      successRate,
      methodBreakdown: methodMap,
    });
  } catch (err) {
    console.error("Razorpay paymentStats error:", err);
    res.status(500).json({
      message: err?.error?.description || err.message || "Server error",
    });
  }
};

/**
 * GET /api/payments/admin/settlements
 * Razorpay settlement history — when money hit your bank account.
 * https://razorpay.com/docs/api/settlements/
 */
exports.listSettlements = async (req, res) => {
  try {
    const { from, to, count = 50, skip = 0 } = req.query;
    const params = {
      count: Math.min(100, Math.max(1, parseInt(count))),
      skip: Math.max(0, parseInt(skip)),
    };
    if (from) params.from = parseInt(from);
    if (to) params.to = parseInt(to);

    const result = await razorpayInstance.settlements.all(params);
    const items = (result.items || []).map((s) => ({
      id: s.id,
      amount: (s.amount || 0) / 100,
      fees: (s.fees || 0) / 100,
      tax: (s.tax || 0) / 100,
      utr: s.utr,
      status: s.status,
      createdAt: s.created_at ? new Date(s.created_at * 1000).toISOString() : null,
    }));
    res.json({ items, count: items.length });
  } catch (err) {
    console.error("Razorpay listSettlements error:", err);
    res.status(500).json({
      message: err?.error?.description || err.message || "Server error",
    });
  }
};

/**
 * POST /api/payments/admin/refund/:paymentId
 * Body: { amount?: number (rupees, optional full refund if omitted), speed?: "normal"|"optimum", notes?: {} }
 */
exports.refundPayment = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, speed = "normal", notes = {} } = req.body || {};

    const payload = { speed, notes };
    if (amount && Number(amount) > 0) {
      payload.amount = Math.round(Number(amount) * 100); // paise
    }

    const refund = await razorpayInstance.payments.refund(paymentId, payload);
    res.json({
      ok: true,
      refund: {
        id: refund.id,
        amount: (refund.amount || 0) / 100,
        status: refund.status,
        speedRequested: refund.speed_requested,
        createdAt: refund.created_at
          ? new Date(refund.created_at * 1000).toISOString()
          : null,
      },
    });
  } catch (err) {
    console.error("Razorpay refund error:", err);
    res.status(400).json({
      ok: false,
      message:
        err?.error?.description || err.message || "Refund failed",
    });
  }
};

/* ========================================================================
   FINANCE REPORT — Razorpay + Delhivery combined per-order view
   GET /api/payments/admin/finance-report
   Query: page, limit, from (yyyy-mm-dd), to (yyyy-mm-dd), paymentMode
   ======================================================================== */
exports.financeReport = async (req, res) => {
  try {
    const svc = require("../services/delhiveryService");

    const { page = 1, limit = 25, from, to, paymentMode } = req.query;

    const p = Math.max(1, parseInt(page));
    const l = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (p - 1) * l;

    // ── Date range ──────────────────────────────────────────────
    const fromDate = from ? new Date(from) : new Date(Date.now() - 90 * 86400 * 1000);
    const toDate = to ? new Date(to) : new Date();
    toDate.setHours(23, 59, 59, 999);

    const fromTs = Math.floor(fromDate.getTime() / 1000); // unix seconds for Razorpay
    const toTs   = Math.floor(toDate.getTime()   / 1000);

    // ── 1. Fetch orders from DB ──────────────────────────────────
    const filter = { createdAt: { $gte: fromDate, $lte: toDate } };
    if (paymentMode && paymentMode !== "ALL") filter.paymentMode = paymentMode;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(l)
        .select(
          "orderNumber customerId total paymentMode shippingPrice itemsPrice razorpayPaymentId trackingId status shippingAddress createdAt advancePaid remainingAmount"
        )
        .populate("customerId", "firmName shopName otpMobile")
        .lean(),
      Order.countDocuments(filter),
    ]);

    // ── 2. Fetch Razorpay payments for this date range ───────────
    // Fetch up to 100 payments from Razorpay in the same window
    let rzpPayments = [];
    try {
      const rzpResp = await razorpayInstance.payments.all({
        from: fromTs,
        to: toTs,
        count: 100,
      });
      rzpPayments = (rzpResp?.items || []).filter(
        (p) => p.status === "captured"
      );
    } catch (_e) {
      // Razorpay fetch failed — continue without it
    }

    // Build lookup map: paymentId → rzp data
    const rzpById = {};
    rzpPayments.forEach((p) => {
      rzpById[p.id] = p;
    });

    // For matching old orders (no razorpayPaymentId stored):
    // index captured payments by amount-in-paise → array of candidates
    const rzpByAmount = {};
    rzpPayments.forEach((p) => {
      const key = String(p.amount); // paise
      if (!rzpByAmount[key]) rzpByAmount[key] = [];
      rzpByAmount[key].push(p);
    });

    // Helper: find best Razorpay match for an order
    // For ONLINE orders: match by full order total
    // For COD orders with advance: match by advance amount
    const findRzpMatch = (order) => {
      // 1. Exact match by stored paymentId
      if (order.razorpayPaymentId && rzpById[order.razorpayPaymentId]) {
        return rzpById[order.razorpayPaymentId];
      }

      const orderTs = Math.floor(new Date(order.createdAt).getTime() / 1000);

      const closestMatch = (amtPaise) => {
        const candidates = rzpByAmount[String(amtPaise)] || [];
        let best = null, bestDiff = Infinity;
        candidates.forEach((c) => {
          const diff = Math.abs((c.created_at || 0) - orderTs);
          if (diff < 7200 && diff < bestDiff) {
            best = c;
            bestDiff = diff;
          }
        });
        return best;
      };

      // 2. ONLINE order: match by full total amount
      if (order.paymentMode === "ONLINE") {
        return closestMatch(Math.round(order.total * 100));
      }

      // 3. COD order with advance payment: match by advance amount
      if (order.paymentMode === "COD" && order.advancePaid > 0) {
        return closestMatch(Math.round(order.advancePaid * 100));
      }

      return null;
    };

    // ── 3. Fetch Delhivery live tracking ────────────────────────
    const awbs = orders.map((o) => o.trackingId).filter(Boolean);
    const liveMap = {};
    if (awbs.length) {
      try {
        const tracking = await svc.trackMultiple(awbs);
        (tracking?.ShipmentData || []).forEach((entry) => {
          const s = entry?.Shipment;
          if (!s) return;
          liveMap[s.AWB] = {
            liveStatus:    s.Status?.Status || "",
            statusType:    s.Status?.StatusType || "",
            lastUpdate:    s.Status?.StatusDateTime || null,
            location:      s.Status?.StatusLocation || "",
            expectedDate:  s.ExpectedDeliveryDate || null,
            chargedWeight: s.ChargedWeight || 0,
            origin:        s.Origin || "",
            destination:   s.Destination || "",
          };
        });
      } catch (_e) {
        // Delhivery tracking failed — continue
      }
    }

    // ── 4. Fetch actual Delhivery freight + COD charges per order ─
    let delChargeMap = {};
    try {
      delChargeMap = await svc.getActualChargesForOrders(orders, liveMap);
    } catch (_e) {
      // non-fatal — continue without actual charges
    }

    // ── 5. Build report rows ─────────────────────────────────────
    const items = orders.map((o) => {
      const isCOD = o.paymentMode === "COD";
      const rzpRaw = findRzpMatch(o);

      const rzp = rzpRaw
        ? {
            paymentId:      rzpRaw.id,
            status:         rzpRaw.status,
            amountReceived: (rzpRaw.amount || 0) / 100,
            fee:            (rzpRaw.fee || 0) / 100,
            gst:            (rzpRaw.tax || 0) / 100,
            net:            ((rzpRaw.amount || 0) - (rzpRaw.fee || 0)) / 100,
            method:         rzpRaw.method || "",
            amountRefunded: (rzpRaw.amount_refunded || 0) / 100,
          }
        : null;

      const live           = o.trackingId ? liveMap[o.trackingId]     || null : null;
      const delActual      = o.trackingId ? delChargeMap[o.trackingId] || null : null;
      const rzpFee         = rzp ? rzp.fee : 0;
      const rzpTax         = rzp ? rzp.gst : 0;
      const shippingCharge = o.shippingPrice || 0;
      const advancePaid    = o.advancePaid   || 0;
      const remainingAmt   = o.remainingAmount ?? Math.max(o.total - advancePaid, 0);

      // Net receipt = what we actually get into bank:
      // ONLINE:           Razorpay net (after fees)
      // COD (no advance): Full order total (Delhivery remits)
      // COD + advance:    advance net via Razorpay + remaining collected at door
      const netReceipt = isCOD
        ? (rzp ? rzp.net + remainingAmt : o.total)
        : (rzp ? rzp.net : 0);

      return {
        orderNumber:   o.orderNumber,
        date:          o.createdAt,
        customer: {
          name:  o.customerId?.firmName || o.customerId?.shopName || o.shippingAddress?.fullName || "—",
          phone: o.customerId?.otpMobile || o.shippingAddress?.phone || "—",
          city:  o.shippingAddress?.city  || "—",
          state: o.shippingAddress?.state || "—",
        },
        paymentMode:   o.paymentMode,
        orderAmount:   o.total,
        itemsAmount:   o.itemsPrice || 0,
        shippingCharge,
        status:        o.status,

        razorpay: rzp,

        delhivery: {
          awb:              o.trackingId || null,
          shippingCharge,
          codAmount:        isCOD ? o.total : 0,
          advancePaid:      isCOD ? advancePaid : 0,
          remainingAmt:     isCOD ? remainingAmt : 0,
          // Actual Delhivery charges (from rate API)
          actualFreight:    delActual?.freightCharge ?? null,
          actualCodCharge:  delActual?.codCharge     ?? null,
          actualTotal:      delActual?.totalCharge   ?? null,
          zone:             delActual?.zone          || live?.location?.split("_")?.[0] || "",
          // Live tracking
          liveStatus:       live?.liveStatus    || o.status,
          statusType:       live?.statusType    || "",
          lastUpdate:       live?.lastUpdate    || null,
          location:         live?.location      || "",
          expectedDate:     live?.expectedDate  || null,
          chargedWeight:    delActual?.chargedWeight || live?.chargedWeight || 0,
        },

        netReceipt,
        rzpFee,
        rzpTax,
      };
    });

    // ── 5. Page-level summary ────────────────────────────────────
    const summary = items.reduce(
      (acc, row) => {
        acc.totalOrderAmount    += row.orderAmount;
        acc.totalRzpFee         += row.rzpFee;
        acc.totalRzpTax         += row.rzpTax;
        acc.totalShippingCharge += row.shippingCharge;
        acc.totalNetReceipt     += row.netReceipt;
        acc.totalDelFreight     += row.delhivery.actualFreight   ?? 0;
        acc.totalDelCodCharge   += row.delhivery.actualCodCharge ?? 0;
        acc.onlineCount         += row.paymentMode === "ONLINE" ? 1 : 0;
        acc.codCount            += row.paymentMode === "COD"    ? 1 : 0;
        return acc;
      },
      {
        totalOrderAmount: 0,
        totalRzpFee: 0,
        totalRzpTax: 0,
        totalShippingCharge: 0,
        totalNetReceipt: 0,
        totalDelFreight: 0,
        totalDelCodCharge: 0,
        onlineCount: 0,
        codCount: 0,
      }
    );

    res.json({ items, total, page: p, limit: l, pages: Math.ceil(total / l), summary });
  } catch (err) {
    console.error("financeReport error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};
