const Order = require('../models/orderModel'); 
const Product = require('../models/Product'); 
const Setting = require('../models/settingModel'); 
const ShippingSettings = require('../models/ShippingSettings'); 
const Category = require('../models/categoryModel');
const Banner = require('../models/bannerModel');
const HomeConfig = require('../models/homeConfigModel'); 
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY); 

/* ==========================================
   🛠️ TOOLS DEFINITION
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

const categoryTool = {
  name: "get_all_categories",
  description: "Get the complete list of active toy categories available on the website.",
  parameters: {
    type: "OBJECT",
    properties: {}, 
  },
};

const offerTool = {
  name: "get_latest_offers",
  description: "Get the latest running banners, offers, and new arrivals on the website.",
  parameters: {
    type: "OBJECT",
    properties: {},
  },
};

const dealOfDayTool = {
  name: "get_deals_of_the_day",
  description: "Get the top 'Deals of the Day' or hot deals configured on the website.",
  parameters: {
    type: "OBJECT",
    properties: {}, 
  },
};

exports.handleChatMessage = async (req, res) => {
  try {
    const { message, chatHistory } = req.body;

    // 💡 FAQ DATA INJECTED INTO BOT RULES 💡
    const botRules = `
      Tum 'Bafna Toys' ke official B2B customer support assistant ho.
      Tumhara kaam wholesale orders, MOQ, pricing, payment, categories, aur dispatch details dena hai.

      ⚠️ **STRICT LANGUAGE RULE:** ⚠️
      - User jis bhasha (language) mein baat kare (English, Hindi, Tamil, Kannada, Telugu, ya Mix Hinglish), tumhe apna poora reply usi language mein aur uski native script mein dena hai.
      - Tone hamesha casual, friendly, aur professional B2B jaisa hona chahiye.

      💳 **PAYMENT & SHIPPING RULES:**
      - Agar user "Payment options", "COD", ya "Shipping details" puche, toh 'get_store_policies' tool use karo.
      - Jab policy ka data mile, toh usey user ki language me samjhao.

      📦 **MOQ (Minimum Order Quantity) RULES:**
      Jab koi "MOQ kya hai?" puche, toh hamesha is professional aur structured format me reply karo:
      **MOQ (Minimum Order Quantity) Policy:**
      Bafna Toys ki wholesale MOQ policy ab har product ke hisaab se dynamically set hoti hai:
      * **1. Strict Bulk / Box Packing:** Kuch items poore dabba, jar ya carton mein aate hain. Unki MOQ bulk box size (e.g. 6, 12 pcs) ke hisaab se hoti hai.
      * **2. Premium/Custom Item MOQ:** Kuch premium ya bade products ke liye MOQ admin define karta hai (jaise sirf **1 piece** ya 5 piece).
      * **3. Standard Open Items:** Agar upar ka koi rule laagu nahi hota, tab price rule apply hota hai:
         - ₹60 se kam price: Minimum **3 pieces** per item.
         - ₹60 ya usse zyada: Minimum **2 pieces** per item.

      📚 **STORE FAQ KNOWLEDGE (RETAILERS KE SAWALO KE JAWAB):**
      Tumhe in sab baaton ka dhyan rakhna hai agar customer pooche:
      - **GST Billing:** Yes, GST invoice is provided. Input tax credit can be claimed. If no GST, billed to personal name.
      - **Dispatch & Delivery:** Dispatched within 24-48 hours from Coimbatore. Delivery takes 2-3 days in South India, 7-8 days in North India. Tracking via WhatsApp/SMS.
      - **Product Quality:** Child-safe, non-toxic, durable, strict quality checks.
      - **Why Buy From Us:** Direct manufacturer, better margins, dynamic MOQ (starting from just 1 piece for heavy items), 400+ products.
      - **Who is this for:** Exclusively for retailers, resellers & shop owners. NOT for single-piece retail.
      - **Damages/Returns:** Inspect within 24 hours. Returns accepted ONLY for incorrect/defective items.
      - **Mix Products:** Yes, can mix and match freely across all categories.
      - **Minimum Order Value:** No strict minimum. Free delivery above ₹3000. Orders below ₹3000 have ₹500 shipping charge.

      📂 **CATEGORIES, OFFERS & DEALS:**
      - Agar user puche "Kya kya milta hai?", "Konsi categories hain?", ya "Toys dikhao", toh 'get_all_categories' tool use karo.
      - Agar user puche "Naya kya hai?", "Offers kya hain?", toh 'get_latest_offers' tool use karo.
      - Agar user puche "Aaj ke deals kya hain?", "Deals of the day", ya "Saste items", toh 'get_deals_of_the_day' tool use karo.
      - 🔥 **CRITICAL FOR DEALS:** Deals ka reply hamesha is line se shuru karo: "**Aaj ki sabse best deals yaha dekhein:** [View All Hot Deals](/hot-deals)". Uske baad top products ki list do.
      - Links ko hamesha clickable Markdown format me do: [Category Name](/?category=category-id)

      🔥🔥 CRITICAL RULES FOR PRODUCT SEARCH 🔥🔥
      1. Agar user product search kare, toh 'search_product' tool use karo.
      2. DB se jo products milen, unhe bulleted list me dikhao.
      3. **SABSE ZAROORI:** Har product/category/offer ke naam ko CLICKABLE LINK banao.
         Format example: [RC Stunt Car](/product/rc-stunt-car) - ₹250

      💡 **MANDATORY FOOTER (FAQ SUGGESTION):**
      Apne har reply ke bottom (end) me ek professional note zaroor add karo taaki customer ko pata chale ki wo FAQ page bhi dekh sakte hain. Isko user ki language me hi likho.
      Hamesha exact yeh link format use karo: [FAQ Page](/faq)
      Example in English: "💡 *For more detailed answers, please visit our [FAQ Page](/faq).*"
      Example in Hindi: "💡 *अधिक जानकारी के लिए, कृपया हमारा [FAQ Page](/faq) देखें।*"
      Example in Hinglish: "💡 *Aur details ke liye, hamara [FAQ Page](/faq) check karein.*"
      
      Agar koi ODR number de, ya Order Details puche, toh 'get_order_status' tool use karke details nikal ke batao. (Format: ODR1000101)
    `;

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
      tools: [{ functionDeclarations: [orderTrackingTool, productSearchTool, storePolicyTool, categoryTool, offerTool, dealOfDayTool] }],
    });

    const chat = model.startChat({
        history: formattedHistory
    });

    let result = await chat.sendMessage(message);
    let response = result.response;

    let functionCall = null;
    const calls = typeof response.functionCalls === 'function' ? response.functionCalls() : response.functionCalls;
    
    if (calls && calls.length > 0) {
      functionCall = calls[0];
    }

    if (functionCall) {
      const toolName = functionCall.name;
      let dbResultObj = {};

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
          dbResultObj = { found: false, message: "Order not found. Please provide a correct ODR number." };
        }
      } 
      
      else if (toolName === "search_product") {
        const searchQuery = functionCall.args.query;
        const productsData = await Product.find({
          $or: [
            { name: { $regex: searchQuery, $options: "i" } },
            { sku: { $regex: searchQuery, $options: "i" } },
            { description: { $regex: searchQuery, $options: "i" } } 
          ]
        }).limit(5); 

        if (productsData && productsData.length > 0) {
          dbResultObj = {
            found: true,
            count: productsData.length,
            products: productsData.map(prod => ({
              name: prod.name,
              sku: prod.sku,
              sellingPrice: prod.price,
              stockAvailable: prod.stock,
              isBulkOnly: prod.isBulkOnly,
              link: `/product/${prod.slug}` 
            }))
          };
        } else {
          dbResultObj = { found: false, message: "No products found matching that name." };
        }
      }

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

      else if (toolName === "get_all_categories") {
        const categories = await Category.find({})
                                         .select('name slug link order _id')
                                         .sort({ order: 1 }) 
                                         .limit(15);
        
        if (categories && categories.length > 0) {
          dbResultObj = {
            found: true,
            count: categories.length,
            categories: categories.map(cat => ({
              name: cat.name,
              link: cat.link ? cat.link : `/?category=${cat._id}`
            }))
          };
        } else {
          dbResultObj = { found: false, message: "No categories available at the moment." };
        }
      }

      else if (toolName === "get_latest_offers") {
        const banners = await Banner.find({ status: 'active' }).select('title link type');
        
        if (banners && banners.length > 0) {
          dbResultObj = {
            found: true,
            offers: banners.map(banner => ({
              title: banner.title,
              link: banner.link || '/',
              type: banner.type
            }))
          };
        } else {
          dbResultObj = { found: false, message: "No special offers running right now." };
        }
      }

      else if (toolName === "get_deals_of_the_day") {
        const homeConfig = await HomeConfig.findOne().populate({
          path: 'hotDealsItems.productId',
          select: 'name slug price stock' 
        });

        if (homeConfig && homeConfig.hotDealsItems && homeConfig.hotDealsItems.length > 0) {
          const activeDeals = homeConfig.hotDealsItems.filter(
            item => item.enabled && item.productId && item.productId.stock > 0
          );

          if (activeDeals.length > 0) {
            dbResultObj = {
              found: true,
              deals: activeDeals.slice(0, 5).map(item => ({
                name: item.productId.name,
                originalPrice: item.productId.price,
                dealPrice: item.dealPrice, 
                discountBadge: item.badge || `${item.discountValue} ${item.discountType === 'PERCENT' ? '%' : '₹'} OFF`,
                link: `/product/${item.productId.slug}`
              }))
            };
          } else {
            dbResultObj = { found: false, message: "Aaj ke liye koi special deals stock me nahi hain." };
          }
        } else {
          dbResultObj = { found: false, message: "Aaj ke liye koi special deals available nahi hain." };
        }
      }

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