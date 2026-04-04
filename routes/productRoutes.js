const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const slugify = require("slugify");
// 🔥 Cloudinary hataya, ImageKit laya
const imagekit = require("../config/imagekit"); 
const multer = require("multer");

// 📥 PDF Generator Package
const PDFDocument = require("pdfkit");
const axios = require("axios");

const HomeConfig = require("../models/homeConfigModel.js");
const Product = require("../models/Product.js");
const Review = require("../models/Review.js");

// 🧠 Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage });

/* ==================================================================
   🔥 MAGIC FUNCTION: ATTACH DEALS & APPLY DISCOUNT
================================================================== */
async function attachDealsToProducts(productsData) {
  try {
    const isArray = Array.isArray(productsData);
    const products = isArray ? productsData : [productsData];

    const config = await HomeConfig.findOne().lean();
    const dealMap = {};

    if (config?.hotDealsItems?.length) {
      const now = new Date();

      config.hotDealsItems.forEach((item) => {
        if (item?.enabled && item?.productId && item?.endsAt) {
          const end = new Date(item.endsAt);
          if (end > now) dealMap[item.productId.toString()] = item;
        }
      });
    }

    const updatedProducts = products.map((prod) => {
      const p = prod?._doc ? prod.toObject() : { ...prod };
      if (!p?._id) return p;

      const prodId = p._id.toString();
      const deal = dealMap[prodId];

      if (deal) {
        p.sale_end_time = deal.endsAt;

        if (
          deal.discountType &&
          deal.discountType !== "NONE" &&
          Number(deal.discountValue) > 0
        ) {
          p.bulkPricing = [];

          if (!p.mrp || p.mrp <= p.price) {
            p.mrp = p.price;
          }

          const basePrice = Number(p.price) || 0;
          let newPrice = basePrice;

          const dType = String(deal.discountType).toUpperCase();

          if (dType === "PERCENT") {
            const discountAmount = (basePrice * Number(deal.discountValue)) / 100;
            newPrice = basePrice - discountAmount;
          } else if (dType === "FLAT") {
            newPrice = basePrice - Number(deal.discountValue);
          }

          p.price = Math.max(0, Math.round(newPrice));
        }
      }

      return p;
    });

    return isArray ? updatedProducts : updatedProducts[0];
  } catch (err) {
    console.error("❌ Error attaching deals:", err);
    return productsData;
  }
}

/* ==================================================================
   ⭐ HELPER: ATTACH RATINGS TO PRODUCTS
================================================================== */
async function attachRatingsToProducts(products) {
  try {
    const productIds = products.map(p => p._id);
    
    const ratingsData = await Review.aggregate([
      { $match: { productId: { $in: productIds } } },
      { 
        $group: { 
          _id: "$productId", 
          avgRating: { $avg: "$rating" }, 
          totalReviews: { $sum: 1 } 
        } 
      }
    ]);

    const ratingMap = {};
    ratingsData.forEach(r => {
      ratingMap[r._id.toString()] = {
        rating: r.avgRating,
        reviews: r.totalReviews
      };
    });

    return products.map(p => {
      const stats = ratingMap[p._id.toString()];
      return {
        ...p,
        rating: stats ? Number(stats.rating.toFixed(1)) : 0, 
        reviews: stats ? stats.reviews : 0
      };
    });
  } catch (error) {
    console.error("❌ Error calculating ratings:", error);
    return products; 
  }
}

/* ------------------------------------------------------------------
🔍 1. SEARCH PRODUCTS
------------------------------------------------------------------ */
router.get("/search/all", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    let products = await Product.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
        { sku: { $regex: query, $options: "i" } },
      ],
    })
      .select("name sku images _id category price mrp stock slug featured")
      .limit(20)
      .lean();

    products = await attachRatingsToProducts(products); 
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
    let products = await Product.find()
      .populate("category", "name")
      .sort({ order: 1 })
      .lean();

    products = await attachRatingsToProducts(products); 
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

    let related = await Product.find({
      category: prod.category,
      _id: { $ne: prod._id },
    })
      .limit(6)
      .populate("category", "name")
      .lean();

    related = await attachRatingsToProducts(related); 
    const finalRelated = await attachDealsToProducts(related);
    res.json(finalRelated);
  } catch (err) {
    console.error("❌ Related fetch error:", err);
    res.status(500).json({ message: "Failed to fetch related products" });
  }
});

/* ------------------------------------------------------------------
✅ 4. GET SINGLE PRODUCT (slug or id)
------------------------------------------------------------------ */
router.get("/:slugOrId", async (req, res, next) => {
  try {
    const { slugOrId } = req.params;

    if (slugOrId === "search" || slugOrId === "reorder" || slugOrId === "download-catalogue") return next();

    const query = mongoose.Types.ObjectId.isValid(slugOrId)
      ? { _id: slugOrId }
      : { slug: slugOrId };

    let prod = await Product.findOne(query)
      .populate("category", "name")
      .populate({
        path: "relatedProducts",
        populate: { path: "category", select: "name" },
      })
      .lean();

    if (!prod) return res.status(404).json({ message: "Product not found" });

    const ratingData = await Review.aggregate([
      { $match: { productId: prod._id } },
      { $group: { _id: null, avgRating: { $avg: "$rating" }, totalReviews: { $sum: 1 } } }
    ]);
    
    if (ratingData.length > 0) {
      prod.rating = Number(ratingData[0].avgRating.toFixed(1));
      prod.reviews = ratingData[0].totalReviews;
    } else {
      prod.rating = 0;
      prod.reviews = 0;
    }

    let finalProd = await attachDealsToProducts(prod);

    if (finalProd.relatedProducts?.length) {
      finalProd.relatedProducts = await attachRatingsToProducts(finalProd.relatedProducts); 
      finalProd.relatedProducts = await attachDealsToProducts(finalProd.relatedProducts);
    }

    res.json(finalProd);
  } catch (err) {
    console.error("❌ Single fetch error:", err);
    res.status(400).json({ message: "Invalid product ID or slug" });
  }
});

/* ------------------------------------------------------------------
✅ 5. CREATE product (ImageKit updated)
------------------------------------------------------------------ */
router.post("/", upload.array("images", 5), async (req, res) => {
  try {
    let imageUrls = [];

    // ImageKit Multiple Upload Logic
    if (req.files?.length) {
      const uploadPromises = req.files.map((file) => {
        return imagekit.upload({
          file: file.buffer,
          fileName: file.originalname,
          folder: "/bafnatoys/products",
        });
      });
      const results = await Promise.all(uploadPromises);
      imageUrls = results.map(result => result.url);
    }

    if (req.body.images) {
      const bodyImages = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
      const validUrls = bodyImages.filter((url) => url && typeof url === "string");
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
      piecesPerUnit: Number(req.body.piecesPerUnit) || 1,
      isBulkOnly: req.body.isBulkOnly === true || req.body.isBulkOnly === "true",
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
    if (!Array.isArray(products) || !products.length) {
      return res.status(400).json({ message: "Invalid" });
    }

    const bulkOps = products.map((item) => ({
      updateOne: {
        filter: { _id: item._id },
        update: { $set: { order: item.order } },
      },
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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID" });
    }

    const product = await Product.findById(id);
    if (!product) return res.status(404).json({ message: "Not found" });

    const categoryId = product.category;
    const products = await Product.find({ category: categoryId }).sort({ order: 1 });

    const index = products.findIndex((p) => p._id.toString() === id.toString());
    if (index === -1) return res.status(400).json({ message: "Not found in category" });

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= products.length) {
      return res.status(400).json({ message: "Boundary reached" });
    }

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
✅ 8. UPDATE product (ImageKit updated)
------------------------------------------------------------------ */
router.put("/:id", upload.array("images", 5), async (req, res) => {
  try {
    const updateData = { ...req.body };
    let newImageUrls = [];

    // ImageKit Multiple Upload Logic
    if (req.files?.length) {
      const uploadPromises = req.files.map((file) => {
        return imagekit.upload({
          file: file.buffer,
          fileName: file.originalname,
          folder: "/bafnatoys/products",
        });
      });
      const results = await Promise.all(uploadPromises);
      newImageUrls = results.map(result => result.url);
    }

    if (newImageUrls.length) {
      const bodyImages = req.body.images
        ? Array.isArray(req.body.images)
          ? req.body.images
          : [req.body.images]
        : [];
      updateData.images = [...bodyImages, ...newImageUrls];
    } else if (req.body.images !== undefined) {
      updateData.images = Array.isArray(req.body.images) ? req.body.images : [req.body.images];
    }

    if (updateData.name) {
      updateData.slug = slugify(updateData.name, { lower: true, strict: true });
    }

    if (req.body.piecesPerUnit !== undefined) {
      updateData.piecesPerUnit = Number(req.body.piecesPerUnit) || 1;
    }
    if (req.body.isBulkOnly !== undefined) {
      updateData.isBulkOnly = req.body.isBulkOnly === true || req.body.isBulkOnly === "true";
    }

    const prod = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    });

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


/* ------------------------------------------------------------------
✅ 12. DOWNLOAD PDF CATALOGUE (FIXED EMOJIS & BLANK IMAGES)
------------------------------------------------------------------ */
router.get("/download-catalogue/pdf", async (req, res) => {
  try {
    const products = await Product.find({ stock: { $gt: 0 } })
      .select("name sku price mrp images stock piecesPerUnit innerQty") 
      .sort({ order: 1 })
      .lean();

    const finalProducts = await attachDealsToProducts(products);

    const doc = new PDFDocument({ margin: 30, size: 'A4' });

    res.setHeader("Content-disposition", 'attachment; filename="BafnaToys-Catalogue.pdf"');
    res.setHeader("Content-type", "application/pdf");
    doc.pipe(res);

    // Header
    doc.fontSize(24).fillColor("#4f46e5").text("Bafna Toys Wholesale Catalogue", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#475569").text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: "center" });
    doc.moveDown(2);

    let currentX = 30;
    let currentY = doc.y;
    const itemWidth = 170;
    const itemHeight = 220;
    const itemsPerRow = 3;
    let col = 0;

    // Fetch Image and Force JPG (Updated for ImageKit & Legacy Cloudinary)
    const fetchImageBuffer = async (url) => {
      try {
        if(!url) return null;
        let optimizedUrl = url;
        
        if (url.includes("ik.imagekit.io")) {
          // ImageKit JPG & resize optimization
          const urlParts = new URL(url);
          optimizedUrl = `${urlParts.origin}${urlParts.pathname}?tr=w-200,h-200,c-at_max,f-jpg,q-80`;
        } else if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
          optimizedUrl = url.replace("/upload/", "/upload/w_200,h_200,c_fit,q_80,f_jpg/");
        }
        
        const response = await axios.get(optimizedUrl, { responseType: 'arraybuffer', timeout: 8000 });
        return response.data;
      } catch (e) {
        console.log(`Failed to fetch image: ${url}`);
        return null;
      }
    };

    for (let i = 0; i < finalProducts.length; i++) {
      const p = finalProducts[i];

      if (currentY + itemHeight > doc.page.height - 50) {
        doc.addPage();
        currentY = 40;
        currentX = 30;
        col = 0;
      }

      // Draw Box Background
      doc.lineWidth(1).strokeColor("#e2e8f0").rect(currentX, currentY, itemWidth, itemHeight).stroke();

      // Draw Image
      if (p.images && p.images.length > 0) {
        const imgBuffer = await fetchImageBuffer(p.images[0]);
        if (imgBuffer) {
          try {
            doc.image(imgBuffer, currentX + 10, currentY + 10, { fit: [150, 130], align: 'center', valign: 'center' });
          } catch (e) { 
            console.log(`PDFKit failed to parse image for ${p.sku}`);
          }
        }
      }

      // 🔥 FIX: STRICT EMOJI & SPECIAL CHARACTER REMOVER
      let cleanName = "Product";
      if (p.name) {
         cleanName = p.name.replace(/[^\x20-\x7E]/g, "").trim();
      }
      cleanName = cleanName.substring(0, 40) + (cleanName.length > 40 ? "..." : "");

      // Draw Text Details
      doc.fillColor("#0f172a").fontSize(10).text(cleanName, currentX + 10, currentY + 150, { width: 150, height: 25, ellipsis: true });
      doc.fillColor("#64748b").fontSize(9).text(`SKU: ${p.sku || 'N/A'}`, currentX + 10, currentY + 175);
      
      const minQty = p.piecesPerUnit > 1 ? p.piecesPerUnit : (p.price < 60 ? 3 : 2);
      doc.fillColor("#64748b").fontSize(9).text(`Min Qty: ${minQty} Pcs`, currentX + 10, currentY + 188);
      
      doc.fillColor("#059669").fontSize(12).font('Helvetica-Bold').text(`Rs. ${p.price}`, currentX + 10, currentY + 200);
      doc.font('Helvetica'); // Reset font back to normal

      // Move Positions
      col++;
      if (col >= itemsPerRow) {
        col = 0;
        currentX = 30;
        currentY += itemHeight + 20;
      } else {
        currentX += itemWidth + 10;
      }
    }

    doc.end();

  } catch (error) {
    console.error("❌ PDF Generation Final Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to generate PDF Catalogue" });
    }
  }
});


/* ------------------------------------------------------------------
✅ 10. GOOGLE MERCHANT CENTER PRODUCT FEED (XML)
------------------------------------------------------------------ */
router.get("/feed/google-shopping", async (req, res) => {
  try {
    const products = await Product.find()
      .populate("category", "name")
      .lean();

    const finalProducts = await attachDealsToProducts(products);

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Bafna Toys</title>
    <link>https://bafnatoys.com</link>
    <description>Best wholesale toys for kids</description>
`;

    finalProducts.forEach((product) => {
      const availability = product.stock > 0 ? "in_stock" : "out_of_stock";
      
      const imageUrl = (product.images && product.images.length > 0) 
        ? product.images[0] 
        : "https://bafnatoys.com/default-image.jpg"; 
        
      const description = product.description || product.tagline || product.name;

      xml += `
    <item>
      <g:id>${product.sku || product._id.toString()}</g:id>
      <g:title><![CDATA[${product.name}]]></g:title>
      <g:description><![CDATA[${description}]]></g:description>
      <g:link>https://bafnatoys.com/product/${product.slug}</g:link>
      <g:image_link><![CDATA[${imageUrl}]]></g:image_link>
      <g:condition>new</g:condition>
      <g:availability>${availability}</g:availability>
      <g:price>${product.price}.00 INR</g:price>`;
      
      if (product.category && product.category.name) {
          xml += `\n      <g:product_type><![CDATA[${product.category.name}]]></g:product_type>`;
      }

      xml += `
      <g:brand>Bafna Toys</g:brand>
    </item>`;
    });

    xml += `
  </channel>
</rss>`;

    res.set("Content-Type", "text/xml");
    res.send(xml);
  } catch (err) {
    console.error("❌ Google Feed generation error:", err);
    res.status(500).json({ message: "Failed to generate Google Feed" });
  }
});

/* ------------------------------------------------------------------
✅ 11. FACEBOOK CATALOG FEED (CSV)
------------------------------------------------------------------ */
router.get("/feed/facebook-catalog", async (req, res) => {
  try {
    const products = await Product.find().lean();
    const finalProducts = await attachDealsToProducts(products);

    let csv = 'id,title,description,availability,condition,price,link,image_link,brand\n';

    finalProducts.forEach((product) => {
      const id = product.sku || product._id.toString();
      
      const rawTitle = (product.name || 'Bafna Toy').replace(/"/g, '""');
      const title = `"${rawTitle}"`;
      
      const rawDesc = (product.description || product.tagline || product.name || 'Best quality toy').replace(/"/g, '""');
      const description = `"${rawDesc}"`;
      
      const availability = (product.stock && product.stock > 0) ? 'in stock' : 'out of stock';
      const condition = 'new';
      const price = `${product.price} INR`;
      const link = `https://bafnatoys.com/product/${product.slug || product._id.toString()}`;
      const image_link = (product.images && product.images.length > 0) ? product.images[0] : 'https://bafnatoys.com/default-image.jpg';
      const brand = 'Bafna Toys';

      csv += `${id},${title},${description},${availability},${condition},${price},${link},${image_link},${brand}\n`;
    });

    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.attachment('facebook_catalog.csv');
    return res.send('\uFEFF' + csv);

  } catch (error) {
    console.error("❌ Facebook feed error:", error);
    res.status(500).send('Server Error in generating feed');
  }
});

module.exports = router;