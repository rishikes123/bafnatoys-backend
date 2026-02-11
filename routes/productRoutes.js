const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const slugify = require("slugify");
const Category = require("../models/categoryModel.js");
const cloudinary = require("../config/cloudinary");
const multer = require("multer");

// 👇 IMPORT HOMECONFIG
const HomeConfig = require("../models/homeConfigModel.js"); 
const Product = require("../models/Product.js");

// 🧠 Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ==================================================================
   🔥 MAGIC FUNCTION: ATTACH DEALS & APPLY DISCOUNT
================================================================== */
async function attachDealsToProducts(productsData) {
  try {
    // 1. Array check
    const isArray = Array.isArray(productsData);
    let products = isArray ? productsData : [productsData];

    // 2. Fetch Active Deals
    const config = await HomeConfig.findOne().lean();
    const dealMap = {}; 

    if (config && config.hotDealsItems) {
      const now = new Date();
      config.hotDealsItems.forEach((item) => {
        // Deal must be enabled, have a product ID, and end time must be in the future
        if (item.enabled && item.productId && item.endsAt) {
          const end = new Date(item.endsAt);
          if (end > now) {
             dealMap[item.productId.toString()] = item; 
          }
        }
      });
    }

    // 3. Apply Logic
    const updatedProducts = products.map((prod) => {
      const p = prod._doc ? prod.toObject() : { ...prod }; 
      const prodId = p._id.toString();
      const deal = dealMap[prodId];

      if (deal) {
        // A. Timer Attach
        p.sale_end_time = deal.endsAt;

        // B. Discount Logic
        if (deal.discountType && deal.discountType !== "NONE" && deal.discountValue > 0) {
           
           // 🔥 IMPORTANT: Agar Deal Active hai, to Bulk Pricing hata do.
           // Taaki Frontend sirf Discounted Price dikhaye.
           p.bulkPricing = [];

           // Logic: Agar MRP pehle se set nahi hai ya Price se kam hai, 
           // toh Current Price ko MRP bana do.
           if (!p.mrp || p.mrp <= p.price) {
               p.mrp = p.price; 
           }

           // 🔥 CALCULATION FIX: Discount 'p.price' (99) par lagega
           let basePrice = p.price;
           let newPrice = basePrice;

           // Handle Case Sensitivity (Just in case)
           const dType = deal.discountType.toUpperCase();

           if (dType === "PERCENT") {
               // Calculate % Off
               const discountAmount = (basePrice * deal.discountValue) / 100;
               newPrice = basePrice - discountAmount;
           } else if (dType === "FLAT") {
               // Flat Amount Off
               newPrice = basePrice - deal.discountValue;
           }

           // Price kabhi negative nahi hona chahiye
           p.price = Math.max(0, Math.round(newPrice));
        }
      }
      return p;
    });

    return isArray ? updatedProducts : updatedProducts[0];

  } catch (err) {
    console.error("Error attaching deals:", err);
    return productsData; 
  }
}

/* ==================================================================
   ROUTES START HERE
================================================================== */

/* ------------------------------------------------------------------
🔍 1. SEARCH PRODUCTS
------------------------------------------------------------------ */
router.get("/search/all", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    const products = await Product.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { sku: { $regex: query, $options: "i" } }, 
      ],
    })
    .select("name sku images _id category price mrp stock slug featured") 
    .limit(20)
    .lean();

    const finalProducts = await attachDealsToProducts(products);
    res.json(finalProducts);
  } catch (err) {
    console.error("❌ Search error:", err);
    res.status(500).json({ message: "Search failed" });
  }
});

/* ------------------------------------------------------------------
✅ 2. GET ALL PRODUCTS
------------------------------------------------------------------ */
router.get("/", async (_req, res) => {
  try {
    const products = await Product.find()
      .populate("category", "name")
      .sort({ order: 1 })
      .lean();

    const finalProducts = await attachDealsToProducts(products);
    res.json(finalProducts);
  } catch (err) {
    console.error("❌ Fetch error:", err);
    res.status(500).json({ message: "Failed to fetch products" });
  }
});

/* ------------------------------------------------------------------
✅ 3. GET Related Products
------------------------------------------------------------------ */
router.get("/:id/related", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }
    const prod = await Product.findById(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });

    const related = await Product.find({
      category: prod.category,
      _id: { $ne: prod._id },
    })
      .limit(6)
      .populate("category", "name")
      .lean();

    const finalRelated = await attachDealsToProducts(related);
    res.json(finalRelated);
  } catch (err) {
    console.error("❌ Related fetch error:", err);
    res.status(500).json({ message: "Failed to fetch related products" });
  }
});

/* ------------------------------------------------------------------
✅ 4. GET SINGLE PRODUCT
------------------------------------------------------------------ */
router.get("/:slugOrId", async (req, res) => {
  try {
    const { slugOrId } = req.params;
    
    if (slugOrId === "search" || slugOrId === "reorder") return res.next();

    const query = mongoose.Types.ObjectId.isValid(slugOrId)
      ? { _id: slugOrId }
      : { slug: slugOrId };

    const prod = await Product.findOne(query)
      .populate("category", "name")
      .populate({
        path: "relatedProducts",
        populate: { path: "category", select: "name" },
      })
      .lean();

    if (!prod) return res.status(404).json({ message: "Product not found" });

    // 🔥 Timer + Discount Call
    const finalProd = await attachDealsToProducts(prod);
    
    // 🔥 Nested: Related Products ke andar bhi Deals lagao
    if (finalProd.relatedProducts && finalProd.relatedProducts.length > 0) {
        finalProd.relatedProducts = await attachDealsToProducts(finalProd.relatedProducts);
    }

    res.json(finalProd);
  } catch (err) {
    console.error("❌ Single fetch error:", err);
    res.status(400).json({ message: "Invalid product ID or slug" });
  }
});

/* ------------------------------------------------------------------
✅ 5. CREATE product
------------------------------------------------------------------ */
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => (error ? reject(error) : resolve(result))
          );
          stream.end(file.buffer);
        });
        imageUrls.push(result.secure_url);
      }
    }

    if (req.body.images) {
      const bodyImages = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
      const validUrls = bodyImages.filter(url => url && typeof url === 'string');
      imageUrls = [...imageUrls, ...validUrls];
    }

    const slug = slugify(req.body.name, { lower: true, strict: true });

    const prod = new Product({
      ...req.body,
      images: imageUrls,
      slug,
      tagline: req.body.tagline || "",
      packSize: req.body.packSize || "",
      stock: req.body.stock || 0,
      unit: req.body.unit || "Piece",
      relatedProducts: req.body.relatedProducts || [],
    });

    await prod.save();
    res.status(201).json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message || "Failed to create product" });
  }
});

/* ------------------------------------------------------------------
✅ 6. REORDER PRODUCTS
------------------------------------------------------------------ */
router.put("/reorder", async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) return res.status(400).json({ message: "Invalid" });

    const bulkOps = products.map((item) => ({
      updateOne: { filter: { _id: item._id }, update: { $set: { order: item.order } } },
    }));

    await Product.bulkWrite(bulkOps);
    res.json({ ok: true, message: "Order updated!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to reorder" });
  }
});

/* ------------------------------------------------------------------
✅ 7. MOVE PRODUCT
------------------------------------------------------------------ */
router.put("/:id/move", async (req, res) => {
  try {
    const { direction } = req.body;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid ID" });

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Not found" });

    const categoryId = product.category;
    let products = await Product.find({ category: categoryId }).sort({ order: 1 });
    const index = products.findIndex((p) => p._id.toString() === id.toString());

    if (index === -1) return res.status(400).json({ message: "Not found in category" });

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= products.length) return res.status(400).json({ message: "Boundary reached" });

    [products[index], products[swapIndex]] = [products[swapIndex], products[index]];

    for (let i = 0; i < products.length; i++) {
      products[i].order = i + 1;
      await products[i].save();
    }

    const updatedCategoryProducts = await Product.find({ category: categoryId }).sort({ order: 1 });
    res.json({ ok: true, message: "Moved", updatedCategoryProducts });
  } catch (err) {
    res.status(500).json({ message: "Failed to move" });
  }
});

/* ------------------------------------------------------------------
✅ 8. UPDATE product
------------------------------------------------------------------ */
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    let updateData = { ...req.body };
    let newImageUrls = [];

    if (req.files?.length > 0) {
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "bafnatoys/products" },
            (error, result) => (error ? reject(error) : resolve(result))
          );
          stream.end(file.buffer);
        });
        newImageUrls.push(result.secure_url);
      }
    }

    if (newImageUrls.length > 0) {
        let bodyImages = req.body.images ? (Array.isArray(req.body.images) ? req.body.images : [req.body.images]) : [];
        updateData.images = [...bodyImages, ...newImageUrls];
    } else {
        if (req.body.images !== undefined) {
           updateData.images = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
        }
    }

    if (updateData.name) {
      updateData.slug = slugify(updateData.name, { lower: true, strict: true });
    }

    const prod = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!prod) return res.status(404).json({ message: "Product not found" });

    res.json(prod);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ------------------------------------------------------------------
✅ 9. DELETE product
------------------------------------------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    const prod = await Product.findByIdAndDelete(req.params.id);
    if (!prod) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(400).json({ message: "Invalid ID" });
  }
});

module.exports = router;