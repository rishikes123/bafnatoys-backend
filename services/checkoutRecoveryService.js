const Razorpay = require("razorpay");

const CheckoutAttempt = require("../models/CheckoutAttempt");
const Order = require("../models/orderModel");
const {
  createOrderFromPayload,
  OrderCreationError,
} = require("./orderCreationService");

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY,
  key_secret: process.env.RAZORPAY_SECRET,
});

const PROCESSING_LOCK_MS = 2 * 60 * 1000;

async function getCompletedOrder(attempt) {
  if (attempt.orderId) {
    const byId = await Order.findById(attempt.orderId).lean();
    if (byId) return byId;
  }
  if (attempt.razorpayPaymentId) {
    return Order.findOne({
      razorpayPaymentId: attempt.razorpayPaymentId,
    }).lean();
  }
  return null;
}

async function findCapturedPayment(razorpayOrderId) {
  const result = await razorpayInstance.orders.fetchPayments(
    razorpayOrderId
  );
  return (result?.items || []).find(
    (payment) => payment.status === "captured"
  );
}

async function finalizeCheckoutAttempt({
  razorpayOrderId,
  razorpayPaymentId,
  req,
}) {
  let attempt = await CheckoutAttempt.findOne({ razorpayOrderId });
  if (!attempt) {
    throw new OrderCreationError(
      "Checkout recovery record not found",
      404
    );
  }

  if (attempt.status === "completed") {
    const order = await getCompletedOrder(attempt);
    if (order) return { order, alreadyExists: true };
  }

  const staleBefore = new Date(Date.now() - PROCESSING_LOCK_MS);
  attempt = await CheckoutAttempt.findOneAndUpdate(
    {
      _id: attempt._id,
      status: { $ne: "completed" },
      $or: [
        { status: { $in: ["created", "failed"] } },
        { processingStartedAt: { $lt: staleBefore } },
        { processingStartedAt: null },
      ],
    },
    {
      $set: {
        status: "processing",
        processingStartedAt: new Date(),
        lastError: "",
      },
      $inc: { recoveryCount: 1 },
    },
    { new: true }
  );

  if (!attempt) {
    const current = await CheckoutAttempt.findOne({ razorpayOrderId });
    if (current?.status === "completed") {
      const order = await getCompletedOrder(current);
      if (order) return { order, alreadyExists: true };
    }
    throw new OrderCreationError(
      "Order finalization is already in progress",
      409
    );
  }

  try {
    const rzpOrder = await razorpayInstance.orders.fetch(
      razorpayOrderId
    );
    if (!rzpOrder || rzpOrder.status !== "paid") {
      throw new OrderCreationError("Razorpay order is not paid", 400);
    }

    let payment = null;
    if (razorpayPaymentId) {
      payment = await razorpayInstance.payments.fetch(
        razorpayPaymentId
      );
    } else {
      payment = await findCapturedPayment(razorpayOrderId);
    }

    if (!payment || payment.status !== "captured") {
      throw new OrderCreationError("Payment not captured", 400);
    }
    if (payment.order_id !== razorpayOrderId) {
      throw new OrderCreationError(
        "Payment does not belong to this Razorpay order",
        400
      );
    }
    if (payment.amount !== rzpOrder.amount) {
      throw new OrderCreationError("Payment amount mismatch", 400);
    }

    attempt.razorpayPaymentId = payment.id;
    await attempt.save();

    const result = await createOrderFromPayload(
      {
        customerId: attempt.customerId,
        items: attempt.items,
        shippingAddress: attempt.shippingAddress,
        paymentMode: attempt.paymentMode,
        razorpayPaymentId: payment.id,
        razorpayOrderId,
      },
      { req }
    );

    await CheckoutAttempt.findByIdAndUpdate(attempt._id, {
      $set: {
        status: "completed",
        orderId: result.order._id,
        razorpayPaymentId: payment.id,
        completedAt: new Date(),
        processingStartedAt: null,
        lastError: "",
      },
    });

    return result;
  } catch (error) {
    await CheckoutAttempt.findByIdAndUpdate(attempt._id, {
      $set: {
        status: "failed",
        processingStartedAt: null,
        lastError: String(error.message || error).slice(0, 1000),
      },
    });
    throw error;
  }
}

async function reconcileCapturedCheckouts() {
  const oldestAllowed = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const attempts = await CheckoutAttempt.find({
    status: { $in: ["created", "failed"] },
    createdAt: { $gte: oldestAllowed },
    recoveryCount: { $lt: 20 },
  })
    .sort({ createdAt: 1 })
    .limit(20)
    .select("razorpayOrderId")
    .lean();

  let recovered = 0;
  for (const attempt of attempts) {
    try {
      const rzpOrder = await razorpayInstance.orders.fetch(
        attempt.razorpayOrderId
      );
      if (rzpOrder?.status !== "paid") continue;
      await finalizeCheckoutAttempt({
        razorpayOrderId: attempt.razorpayOrderId,
      });
      recovered += 1;
    } catch (error) {
      if (error.statusCode !== 409) {
        console.error(
          `[Checkout recovery] ${attempt.razorpayOrderId}:`,
          error.message
        );
      }
    }
  }
  return recovered;
}

module.exports = {
  finalizeCheckoutAttempt,
  reconcileCapturedCheckouts,
};
