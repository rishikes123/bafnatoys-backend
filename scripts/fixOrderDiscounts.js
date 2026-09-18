/**
 * Purane orders me volume discount galat pada ho sakta hai.
 *
 * Jab admin ne order ke items remove/replace kiye, tab discountAmount purane
 * (bade) subtotal ka hi pada reh gaya — itemsPrice ghat gaya par discount nahi.
 * Ye script har order ka discount aur total dobara calculate karti hai.
 *
 * Dry run (sirf dikhata hai, kuch badalta nahi):
 *   node scripts/fixOrderDiscounts.js
 * Sirf ek order theek karne ke liye (safest):
 *   node scripts/fixOrderDiscounts.js --only ODR1001089 --apply
 * Sabhi galat orders theek karne ke liye:
 *   node scripts/fixOrderDiscounts.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const ShippingSettings = require("../models/ShippingSettings");
const { calculateDiscountAmount } = require("../services/orderTotalsService");

const APPLY = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(
      `✅ MongoDB Connected  (${APPLY ? "APPLY MODE" : "DRY RUN"})` +
        (ONLY ? `  order: ${ONLY}` : "") +
        "\n"
    );

    const shippingSettings = await ShippingSettings.findOne().lean();
    const orders = await Order.find(ONLY ? { orderNumber: ONLY } : {}).select(
      "orderNumber status items itemsPrice shippingPrice discountAmount total advancePaid remainingAmount paymentMode"
    );

    const wrong = [];
    for (const order of orders) {
      const itemsPrice = order.items.reduce(
        (sum, item) => sum + (Number(item.qty) || 1) * (Number(item.price) || 0),
        0
      );
      const discount = calculateDiscountAmount(itemsPrice, shippingSettings);
      const shipping = Number(order.shippingPrice) || 0;
      const total = Math.max(0, Math.round(itemsPrice + shipping - discount));

      const changed =
        Math.abs(itemsPrice - (order.itemsPrice || 0)) > 0.01 ||
        discount !== (order.discountAmount || 0) ||
        total !== (order.total || 0);
      if (!changed) continue;

      wrong.push({
        orderNumber: order.orderNumber,
        status: order.status,
        oldDiscount: order.discountAmount,
        newDiscount: discount,
        oldTotal: order.total,
        newTotal: total,
      });

      if (APPLY) {
        order.itemsPrice = itemsPrice;
        order.discountAmount = discount;
        order.total = total;
        if (order.paymentMode === "COD") {
          order.remainingAmount = Math.max(
            0,
            total - (Number(order.advancePaid) || 0)
          );
        }
        await order.save();
      }
    }

    if (wrong.length === 0) {
      console.log("👍 Sabhi orders ka discount sahi hai. Kuch change nahi kiya.");
    } else {
      console.table(wrong);
      console.log(
        APPLY
          ? `\n✅ ${wrong.length} orders update kar diye.`
          : `\n⚠️  ${wrong.length} orders me farak hai. Update karne ke liye --apply lagao.` +
              `\n    Dhyan do: jin orders me oldDiscount 0 hai aur newDiscount kuch aur,` +
              `\n    wo shayad discount rules banne se pehle ke hain — unhe chhodna behtar hai.`
      );
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
