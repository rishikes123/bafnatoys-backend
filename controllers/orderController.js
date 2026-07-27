const {
  createOrderFromPayload,
} = require("../services/orderCreationService");

exports.createOrder = async (req, res) => {
  try {
    const result = await createOrderFromPayload(req.body, { req });
    res.status(result.alreadyExists ? 200 : 201).json(result);
  } catch (error) {
    console.error("Order Creation Error:", error);
    res.status(error.statusCode || 500).json({
      message: error.message || "Server error while creating order",
    });
  }
};
