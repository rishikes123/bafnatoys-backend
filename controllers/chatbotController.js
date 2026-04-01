const Order = require('../models/orderModel'); 
const Product = require('../models/Product'); 
const Setting = require('../models/settingModel'); 
const ShippingSettings = require('../models/ShippingSettings'); 
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 

/* ==========================================
   🛠️ TOOLS DEFINITION (Gemini ko DB sikhana)
   ========================================== */

const orderTrackingTool = {
  name: "get_order_status",
  description: "Get the shipping, processing status, and remaining amount of an order using its ODR number.",
  parameters: {
    type: "OBJECT",
    properties: {
      orderNumber: { 
        type: "STRING", 
        description: "The order number provided by the user, starting with ODR (e.g., ODR1001001)" 
      },
    },
    required: ["orderNumber"],
  },
};

const productSearchTool = {
  name: "search_product",
  description: "Search for toys (like 'car', 'teddy') to get a list of matching products, their prices, stock, and frontend links.",
  parameters: {
    type: "OBJECT",
    properties: {
      query: { 
        type: "STRING", 
        description: "Name of the product category or SKU to search (e.g., 'car', 'teddy', 'doll')" 
      },
    },
    required: ["query"],
  },
};

const storePolicyTool = {
  name: "get_store_policies",
  description: "Get the current store policies including Payment Options, COD rules, and Shipping charges/discounts.",
  parameters: {
    type: "OBJECT",
    properties: {
      topic: { type: "STRING", description: "The topic user is asking about (e.g., 'payment', 'shipping', 'all')" },
    },
    required: ["topic"],
  },
};

exports.handleChatMessage = async (req, res) => {
  try {
    const { message, chatHistory } = req.body;

    // 👇 MULTI-LANGUAGE Bot Rules 
    const botRules = `
      Tum 'Bafna Toys' ke official B2B customer support assistant ho.
      Tumhara kaam wholesale orders, MOQ, pricing, payment, aur dispatch details dena hai.

      ⚠️ **STRICT LANGUAGE RULE (VERY IMPORTANT):** ⚠️
      - User jis bhasha (language) mein baat kare (English, Hindi, Tamil, Kannada, Telugu, ya Mix Hinglish), tumhe apna poora reply usi language mein aur uski native script mein dena hai.
      - Example: Agar user 'Tamil' select kare, toh Tamil script (தமிழ்) use karo. Agar 'Hindi' bole, toh Devanagari (हिंदी) use karo. Agar 'Mix Hinglish' bole, toh Hinglish use karo.
      - Tone hamesha casual, friendly, aur professional B2B jaisa hona chahiye (jaise "Sir", "Bhai", "Aap" us language mein jo suit kare).

      💳 **PAYMENT, SHIPPING & DISCOUNT RULES:**
      - Agar user "Payment options", "COD", ya "Shipping details" puche, toh 'get_store_policies' tool use karo. **Order Number mat mango.**
      - Jab policy ka data mile, toh usey user ki language me samjhao. Example: Online payment & COD both available.
      - Agar user "Bulk discount" ke baare me puche, toh batao ki hum carton orders par special discounted rates dete hain.

      📦 **MOQ (Minimum Order Quantity) RULES:**
      Jab koi puche "MOQ kya hai?", toh ye logic user ki bhasha me samjhao:
      - Agar item ka price ₹60 se kam hai (< ₹60) → Minimum order 3 pieces hai.
      - Agar item ka price ₹60 ya usse zyada hai (>= ₹60) → Minimum order 2 pieces hai.
      - Note: Box/Carton items ki MOQ dibbe ke hisaab se hoti hai.
      
      🔥🔥 CRITICAL RULES FOR PRODUCT SEARCH 🔥🔥
      1. Agar user product search kare, toh 'search_product' tool use karo.
      2. DB se jo products milen, unhe bulleted list me dikhao.
      3. **SABSE ZAROORI:** Har product ke naam ko CLICKABLE LINK banao. Link DB tool se 'link' field me milega.
         Format example: [RC Stunt Car](/product/rc-stunt-car) - ₹250
      4. List dene ke baad, hamesha ek HELP SUGGESTION do.
      
      Agar koi ODR number de, toh 'get_order_status' tool use karo. Faltu baaton ko politely mana kar do.
    `;

    // 🔥 HISTORY CRASH FIX 🔥
    let formattedHistory = [];
    let lastRole = null;

    for (let msg of (chatHistory || [])) {
      let currentRole = msg.sender === 'bot' ? 'model' : 'user';

      if (formattedHistory.length === 0 && currentRole === 'model') continue;

      if (formattedHistory.length > 0 && lastRole === currentRole) {
        formattedHistory[formattedHistory.length - 1].parts[0].text += `\n${msg.text}`;
      } else {
        formattedHistory.push({ role: currentRole, parts: [{ text: msg.text }] });
        lastRole = currentRole;
      }
    }

    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      systemInstruction: botRules,
      tools: [{ functionDeclarations: [orderTrackingTool, productSearchTool, storePolicyTool] }],
    });

    const chat = model.startChat({
        history: formattedHistory
    });

    let result = await chat.sendMessage(message);
    let response = result.response;

    // 🔥 FAQ CRASH FIX 🔥
    let functionCall = null;
    const calls = typeof response.functionCalls === 'function' ? response.functionCalls() : response.functionCalls;
    
    if (calls && calls.length > 0) {
      functionCall = calls[0];
    }

    if (functionCall) {
      const toolName = functionCall.name;
      let dbResultObj = {};

      // 🔍 CASE 1: ORDER TRACKING
      if (toolName === "get_order_status") {
        const requestedOrderNumber = functionCall.args.orderNumber;
        const orderData = await Order.findOne({ orderNumber: requestedOrderNumber });

        if (orderData) {
          dbResultObj = {
            found: true,
            status: orderData.status,
            totalAmount: orderData.total,
            isShipped: orderData.isShipped,
            courier: orderData.courierName || "Not assigned yet",
            trackingId: orderData.trackingId || "N/A"
          };
        } else {
          dbResultObj = { found: false, message: "Order not found." };
        }
      } 
      
      // 🧸 CASE 2: PRODUCT SEARCH
      else if (toolName === "search_product") {
        const searchQuery = functionCall.args.query;
        const productsData = await Product.find({
          $or: [
            { name: { $regex: searchQuery, $options: "i" } },
            { sku: { $regex: searchQuery, $options: "i" } },
            { description: { $regex: searchQuery, $options: "i" } } 
          ]
        }).limit(3); 

        if (productsData && productsData.length > 0) {
          const formattedProducts = productsData.map(prod => ({
            name: prod.name,
            sku: prod.sku,
            sellingPrice: prod.price,
            stockAvailable: prod.stock,
            isBulkOnly: prod.isBulkOnly,
            link: `/product/${prod.slug}` 
          }));

          dbResultObj = {
            found: true,
            count: formattedProducts.length,
            products: formattedProducts
          };
        } else {
          dbResultObj = { found: false, message: "No products found matching that name." };
        }
      }

      // 💳📦 CASE 3: STORE POLICIES
      else if (toolName === "get_store_policies") {
        const codSettings = await Setting.findOne({ key: 'cod' });
        const shipSettings = await ShippingSettings.findOne();

        dbResultObj = {
          found: true,
          paymentPolicy: codSettings ? codSettings.data : { message: "Online and COD available." },
          shippingPolicy: shipSettings ? {
            baseCharge: shipSettings.shippingCharge,
            freeShippingAbove: shipSettings.freeShippingThreshold,
            discountRules: shipSettings.discountRules
          } : { message: "Standard shipping applies." }
        };
      }

      // DB result Gemini ko bheja
      result = await chat.sendMessage([{
        functionResponse: {
          name: toolName,
          response: { result: dbResultObj }
        }
      }]);
      
      response = result.response;
    }

    const finalReply = response.text();
    res.json({ success: true, reply: finalReply });

  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ 
        success: false, 
        message: "Error communicating with AI",
        reply: "Sorry, abhi server pe thoda load hai. Please thodi der baad try kijiye." 
    });
  }
};