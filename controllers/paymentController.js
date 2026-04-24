const Razorpay = require("razorpay");
const crypto = require("crypto");

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

    // Slim payload for table — convert paise->rupees, pick core fields
    const mapped = items.map((p) => ({
      id: p.id,
      orderId: p.order_id,
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
