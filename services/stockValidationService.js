const Product = require("../models/Product");

/**
 * Stock guard for checkout.
 *
 * Stock is only reduced when an order is marked delivered, so `product.stock`
 * always reflects what is physically on the shelf. A cart that was filled
 * before an item went out of stock (or a client that skips the UI checks)
 * could still place an order for it — this guard blocks that server-side.
 */

const buildIssueMessage = (issue) =>
  issue.reason === "out_of_stock"
    ? `${issue.name} is out of stock. Please remove it from your cart.`
    : `Only ${issue.available} of ${issue.name} ${
        issue.available === 1 ? "is" : "are"
      } available (you selected ${issue.requested}).`;

const buildStockErrorMessage = (issues) =>
  issues.map(buildIssueMessage).join(" ");

/**
 * @param {Array} items        cart items ({ productId, qty })
 * @param {Array} [preloaded]  already-fetched product docs (must carry name + stock)
 * @returns {Promise<{ ok: boolean, issues: Array, message: string }>}
 */
async function checkItemsStock(items = [], preloaded = null) {
  const requestedMap = {};
  (items || []).forEach((item) => {
    const id = String(item?.productId || "");
    if (!id) return;
    requestedMap[id] = (requestedMap[id] || 0) + (Number(item?.qty) || 0);
  });

  const ids = Object.keys(requestedMap);
  if (ids.length === 0) return { ok: true, issues: [], message: "" };

  let products = preloaded;
  const hasStockField =
    Array.isArray(products) &&
    products.length > 0 &&
    products.every((product) => product.stock !== undefined);

  if (!hasStockField) {
    products = await Product.find({ _id: { $in: ids } })
      .select("name stock")
      .lean();
  }

  const productMap = {};
  (products || []).forEach((product) => {
    productMap[String(product._id)] = product;
  });

  const issues = [];
  ids.forEach((id) => {
    const product = productMap[id];
    // Missing products are reported by the existing price validation.
    if (!product) return;

    const available = Number(product.stock) || 0;
    const requested = requestedMap[id];
    const name = product.name || "This product";

    if (available <= 0) {
      issues.push({ productId: id, name, requested, available, reason: "out_of_stock" });
    } else if (requested > available) {
      issues.push({ productId: id, name, requested, available, reason: "insufficient_stock" });
    }
  });

  return {
    ok: issues.length === 0,
    issues,
    message: buildStockErrorMessage(issues),
  };
}

module.exports = { checkItemsStock, buildStockErrorMessage };
