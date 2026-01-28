const mongoose = require("mongoose");
const slugify = require("slugify");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true },
    mrp: { type: Number, default: 0 }, // Maximum Retail Price
    price: { type: Number, default: 0 }, // Selling Price
    
    // ✅ STOCK AND UNIT
    stock: { type: Number, default: 0 }, 
    unit: { type: String, default: "Piece" }, // ✅ Added Unit (Packet/Box/Piece)

    description: { type: String, trim: true },
    tagline: { type: String, trim: true },
    packSize: { type: String, trim: true },
    images: [String],
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    bulkPricing: [
      {
        inner: String,
        qty: { type: Number, min: 1 },
        price: { type: Number, min: 0 },
      },
    ],
    taxFields: { type: [String], default: [] },
    order: { type: Number, default: 0 },
    slug: { type: String, unique: true, trim: true },
    relatedProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------
✨ Auto Slug + Auto Order Before Save
------------------------------------------------------------------ */
productSchema.pre("save", async function (next) {
  try {
    if (this.isModified("name") || !this.slug) {
      this.slug = slugify(this.name, { lower: true, strict: true });
    }

    if (this.isNew) {
      const last = await mongoose
        .model("Product")
        .findOne({ category: this.category })
        .sort({ order: -1 });
      this.order = last ? last.order + 1 : 1;
    }

    next();
  } catch (err) {
    console.error("❌ Error in pre-save hook:", err);
    next(err);
  }
});

module.exports =
  mongoose.models.Product || mongoose.model("Product", productSchema);