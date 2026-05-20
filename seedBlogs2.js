require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const Blog = require("./models/Blog");
const imagekit = require("./config/imagekit");

const imagePaths = {
  pullback: "C:\\Users\\bafna\\.gemini\\antigravity\\brain\\88fc5cae-3340-404b-9f88-1df73952ffaf\\blog_pullback_cars_wholesale_1779277928360.png",
  bis: "C:\\Users\\bafna\\.gemini\\antigravity\\brain\\88fc5cae-3340-404b-9f88-1df73952ffaf\\blog_bis_certified_toys_1779277893000.png",
  retail: "C:\\Users\\bafna\\.gemini\\antigravity\\brain\\88fc5cae-3340-404b-9f88-1df73952ffaf\\blog_how_to_start_toy_business_1779277912640.png",
};

const uploadImage = async (filePath, fileName) => {
  const buffer = fs.readFileSync(filePath);
  const result = await imagekit.upload({
    file: buffer,
    fileName,
    folder: "/bafnatoys_blogs",
  });
  console.log(`✅ Uploaded: ${result.url}`);
  return result.url;
};

const blogs = async (pullbackUrl, bisUrl, retailUrl) => [
  {
    title: "Wholesale Pullback Cars in India: Complete Buyer's Guide for Retailers (2026)",
    slug: "wholesale-pullback-cars-india-buyers-guide-2026",
    excerpt: "Looking to stock pullback cars at wholesale prices? This complete guide covers everything Indian retailers need to know — from minimum order quantities and pricing to quality checks and the best factory-direct suppliers in India.",
    author: "Bafna Toys Team",
    coverImage: pullbackUrl,
    tags: ["Pullback Cars", "Wholesale", "Retail Guide", "Toy Business"],
    published: true,
    metaTitle: "Wholesale Pullback Cars India 2026 | Buy Factory Direct | Bafna Toys",
    metaDescription: "Complete guide to buying pullback cars at wholesale prices in India. Learn MOQ, pricing, BIS certification, and how to source directly from Bafna Toys factory in Coimbatore.",
    content: `
<p>Pullback cars are one of the <strong>fastest-moving toy products</strong> in India's retail market. Whether you run a general store, a dedicated toy shop, or a wholesale distribution business, pullback toy cars offer exceptional margins and near-zero returns. In this guide, we break down everything you need to know about sourcing them at the best wholesale prices.</p>

<h2>Why Pullback Cars Are a Retail Goldmine 🚗</h2>
<p>Pullback cars appeal to children aged 2–10 years — one of the largest buyer demographics for toy retailers. Their simple mechanics (pull back, let go, and zoom!) make them instantly understandable to both children and parents. This means:</p>
<ul>
  <li><strong>No explanation needed</strong> at the point of sale — they sell themselves.</li>
  <li><strong>High impulse purchase rate</strong> — parents buy them on the spot.</li>
  <li><strong>Low breakage rate</strong> means fewer complaints and returns.</li>
  <li><strong>Wide price range</strong> (₹30 to ₹250 retail) allows stocking for all budgets.</li>
</ul>

<h2>Types of Pullback Cars Available in India</h2>
<p>When sourcing from a manufacturer like Bafna Toys, you'll find a wide variety of pullback car styles:</p>
<ul>
  <li>🏎️ <strong>Sports & Racing Cars</strong> — most popular, bright colours, aerodynamic designs</li>
  <li>🚚 <strong>Trucks & Heavy Vehicles</strong> — great for older kids, higher price points</li>
  <li>🏍️ <strong>Motorcycles & Bikes</strong> — popular in Tier 2 & Tier 3 cities</li>
  <li>🚌 <strong>Buses & Public Transport</strong> — educational value, great for gift sets</li>
  <li>✈️ <strong>Aeroplanes & Helicopters</strong> — unique novelty items, high margin</li>
</ul>

<h2>What to Check Before Placing a Wholesale Order</h2>
<p>Not all toy suppliers are equal. Before placing a bulk order, verify the following:</p>
<ol>
  <li><strong>BIS Certification</strong> — All toy manufacturers in India must hold a valid BIS (Bureau of Indian Standards) license. Ask for the license number and verify it on the BIS website. Selling uncertified toys is illegal and can result in heavy fines.</li>
  <li><strong>Material Safety</strong> — Ensure the toys are made from non-toxic, child-safe plastic. Ask if the manufacturer uses virgin plastic or recycled materials.</li>
  <li><strong>Minimum Order Quantity (MOQ)</strong> — Most manufacturers have a minimum order per SKU. At Bafna Toys, our MOQ starts from as low as 2 pieces per SKU for registered B2B buyers.</li>
  <li><strong>Sample First</strong> — Always order samples before placing a large order to check the pullback mechanism quality, paint finish, and packaging.</li>
</ol>

<h2>Wholesale Pricing: What to Expect</h2>
<p>Factory-direct wholesale prices for pullback cars in India typically range from <strong>₹30 to ₹200 per piece</strong> depending on size, mechanism quality, and packaging. When you buy directly from a manufacturer like Bafna Toys (Coimbatore), you eliminate distributor and agent margins — saving 25–40% compared to buying from a secondary wholesaler.</p>

<h2>Why Choose Bafna Toys for Pullback Car Wholesale?</h2>
<p>Bafna Toys is a <strong>BIS-certified toy manufacturer based in Coimbatore, Tamil Nadu</strong>, with over a decade of experience supplying retailers and distributors across India. Our pullback car collection is:</p>
<ul>
  <li>✅ <strong>BIS Certified & ISI Marked</strong> — legally compliant for all-India sales</li>
  <li>✅ <strong>Factory Direct</strong> — best wholesale prices, no middlemen</li>
  <li>✅ <strong>300+ SKUs</strong> — wide variety in a single catalogue</li>
  <li>✅ <strong>Pan-India Delivery</strong> — courier to all pin codes</li>
  <li>✅ <strong>Low MOQ</strong> — flexible ordering for small retailers</li>
</ul>
<p>Ready to stock up? <a href="/products">Browse our full pullback car catalogue here</a> or <a href="https://wa.me/919043347300">WhatsApp us at +91 90433 47300</a> to discuss your requirements.</p>
    `,
  },
  {
    title: "BIS Certification for Toys in India: What Every Retailer & Distributor Must Know",
    slug: "bis-certification-toys-india-retailers-guide",
    excerpt: "BIS certification is now mandatory for all toys sold in India. Understand what it means, why it matters for your business, and how to verify if your supplier is compliant before you stock their products.",
    author: "Bafna Toys Team",
    coverImage: bisUrl,
    tags: ["BIS Certification", "Toy Safety", "Legal Compliance", "India"],
    published: true,
    metaTitle: "BIS Certification for Toys India | What Retailers Must Know | Bafna Toys",
    metaDescription: "All toys in India must have BIS certification. Learn what BIS means, how to verify your supplier's compliance, and why Bafna Toys' BIS-certified products protect your business.",
    content: `
<p>If you sell toys in India — whether you're a retailer, distributor, or online reseller — <strong>BIS (Bureau of Indian Standards) certification is no longer optional</strong>. It's the law. In this article, we explain what BIS certification means for toys, why it matters for your business, and how to protect yourself from legal risk.</p>

<h2>What is BIS Certification for Toys?</h2>
<p>The Bureau of Indian Standards (BIS) is India's national standards body. Under the <strong>Toys (Quality Control) Order, 2020</strong> issued by the Ministry of Commerce, all toys sold in India must conform to Indian standards and carry the <strong>ISI Mark</strong> (the BIS quality mark).</p>
<p>This regulation applies to:</p>
<ul>
  <li>Domestically manufactured toys</li>
  <li>Imported toys</li>
  <li>Toys sold online and offline</li>
  <li>All toy categories including plastic toys, electronic toys, and soft toys</li>
</ul>

<h2>Why Was This Regulation Introduced?</h2>
<p>Before 2020, India's toy market was flooded with low-quality, often hazardous toys — mostly imported from China — that contained toxic paints, sharp edges, and small parts that posed serious choking hazards to children. The BIS regulation was introduced to:</p>
<ol>
  <li>Protect Indian children from unsafe toys</li>
  <li>Boost domestic toy manufacturing (part of the "Make in India" initiative)</li>
  <li>Level the playing field for Indian manufacturers who already followed quality standards</li>
</ol>

<h2>What Standards Do Toys Need to Meet?</h2>
<p>Different types of toys must comply with different Indian Standards:</p>
<ul>
  <li><strong>IS 9873</strong> — Safety requirements for non-electric toys</li>
  <li><strong>IS 15644</strong> — Safety requirements for electric toys</li>
  <li><strong>IS 16014</strong> — Safety requirements for toy projectiles</li>
</ul>
<p>Manufacturers must get their products tested at BIS-accredited laboratories and then apply for a BIS license before they can legally sell their toys in India.</p>

<h2>How to Verify if Your Toy Supplier is BIS Certified</h2>
<p>This is the most important step before placing a wholesale order. Here's how to verify:</p>
<ol>
  <li><strong>Ask for the BIS License Number</strong> — Every certified manufacturer has a unique license number. Ask for it before you place your first order.</li>
  <li><strong>Check the BIS Website</strong> — Visit <strong>bis.gov.in</strong>, go to the "License" section, and search for the manufacturer's name or license number.</li>
  <li><strong>Look for the ISI Mark</strong> — All certified products must have the ISI mark printed on the toy or its packaging.</li>
  <li><strong>Request Test Reports</strong> — Legitimate manufacturers will have third-party lab test reports from BIS-accredited labs.</li>
</ol>

<h2>What Happens if You Sell Non-BIS Certified Toys?</h2>
<p>The penalties for selling non-compliant toys in India are severe:</p>
<ul>
  <li>⚠️ <strong>Confiscation of stock</strong> by government authorities</li>
  <li>⚠️ <strong>Heavy fines</strong> up to ₹2 lakh per violation</li>
  <li>⚠️ <strong>Criminal prosecution</strong> for repeat offenders</li>
  <li>⚠️ <strong>Business license cancellation</strong> in extreme cases</li>
</ul>
<p>This isn't just a risk for manufacturers — <strong>retailers and distributors are also liable</strong> if they knowingly stock non-certified toys.</p>

<h2>Bafna Toys: Your Safe, BIS-Certified Wholesale Partner</h2>
<p>At Bafna Toys, all our products are manufactured to <strong>BIS-compliant standards</strong> at our factory in Coimbatore, Tamil Nadu. We use <strong>non-toxic, child-safe materials</strong> and maintain rigorous quality control at every stage of production. When you stock Bafna Toys products, you're not just getting great wholesale prices — you're protecting your business from legal risk and your customers' children from harm.</p>
<p><a href="/contact">Contact us today</a> to request our BIS certification details or to place your first wholesale order.</p>
    `,
  },
  {
    title: "How to Start a Profitable Toy Retail Business in India: Step-by-Step Guide (2026)",
    slug: "how-to-start-toy-retail-business-india-2026",
    excerpt: "Want to open a toy shop or start selling toys wholesale in India? This step-by-step guide covers everything — investment, location, supplier selection, margins, and marketing strategies to make your toy business profitable from day one.",
    author: "Bafna Toys Team",
    coverImage: retailUrl,
    tags: ["Toy Business", "Retail", "Entrepreneurship", "India", "Business Tips"],
    published: true,
    metaTitle: "How to Start a Toy Retail Business in India 2026 | Complete Guide | Bafna Toys",
    metaDescription: "Complete step-by-step guide to starting a profitable toy retail business in India in 2026. Learn investment, location, margins, and how to source toys at wholesale prices from BIS-certified manufacturers.",
    content: `
<p>India's toy market is one of the fastest-growing consumer segments in the country, projected to reach <strong>₹40,000 crore by 2028</strong>. With a young population, rising disposable incomes, and increasing awareness about quality and educational toys, there has never been a better time to start a toy retail business in India. Here's your complete roadmap.</p>

<h2>Step 1: Research Your Market & Choose Your Niche</h2>
<p>Before spending a rupee, understand your target customer. The Indian toy market has several distinct segments:</p>
<ul>
  <li><strong>Budget/Value Toys (₹30–₹200)</strong> — Pullback cars, PVC dolls, windup toys. Best for Tier 2 & 3 cities. High volume, good margins.</li>
  <li><strong>Mid-Range Toys (₹200–₹800)</strong> — Board games, puzzles, activity sets. Growing segment in urban areas.</li>
  <li><strong>Educational Toys (₹500–₹3000)</strong> — STEM kits, Montessori materials. Premium segment with excellent margins but slower sales.</li>
  <li><strong>Baby & Toddler Toys (₹100–₹1500)</strong> — Rattles, teethers, soft toys. Year-round demand, gifting market.</li>
</ul>
<p><strong>Pro Tip:</strong> For beginners, starting with a mixed store focusing on budget-to-mid range toys gives you the best cash flow and fastest inventory turns.</p>

<h2>Step 2: Plan Your Investment</h2>
<p>A typical small toy retail shop in India requires:</p>
<ul>
  <li>🏪 <strong>Shop Rent Deposit</strong> — ₹50,000 to ₹2,00,000 depending on location</li>
  <li>🪑 <strong>Shop Fitting & Display</strong> — ₹30,000 to ₹80,000 for shelving, racks, signage</li>
  <li>📦 <strong>Initial Inventory</strong> — ₹1,00,000 to ₹3,00,000 for a good variety</li>
  <li>📄 <strong>Licenses & Registration</strong> — GST registration (free), Shop Act License (₹2,000–₹5,000)</li>
  <li>💰 <strong>Working Capital</strong> — 2–3 months of operating expenses as buffer</li>
</ul>
<p><strong>Total Estimated Startup Investment: ₹2,00,000 – ₹6,00,000</strong></p>

<h2>Step 3: Choose the Right Location</h2>
<p>Location is everything in toy retail. Look for:</p>
<ul>
  <li>✅ Areas with high foot traffic of families with young children</li>
  <li>✅ Near schools, playgrounds, parks, or residential colonies</li>
  <li>✅ Markets with competitor toy shops (counter-intuitive but true — it means buyers already come here)</li>
  <li>✅ Ground floor shop with good visibility from the street</li>
</ul>

<h2>Step 4: Find the Right Wholesale Supplier</h2>
<p>Your supplier relationship is the foundation of your business. A good supplier gives you:</p>
<ul>
  <li><strong>Competitive pricing</strong> — 40–60% margin over cost is achievable with factory-direct buying</li>
  <li><strong>BIS-certified products</strong> — protects you from legal issues</li>
  <li><strong>Good variety</strong> — so you can have a complete, appealing shop</li>
  <li><strong>Reliable stock</strong> — so you don't face out-of-stock situations during peak seasons</li>
  <li><strong>Flexible MOQ</strong> — especially important when you're just starting</li>
</ul>
<p>At <strong>Bafna Toys</strong>, we supply over <strong>300+ toy products</strong> directly from our Coimbatore factory to retailers across India. Our prices are factory-direct, our products are BIS-certified, and we offer <strong>pan-India courier delivery</strong>. <a href="https://wa.me/919043347300">WhatsApp us at +91 90433 47300</a> to get our latest catalogue and wholesale price list.</p>

<h2>Step 5: Manage Your Margins</h2>
<p>Understanding retail margins in the toy business:</p>
<ul>
  <li>Budget toys (pullback cars, PVC dolls): <strong>40–60% gross margin</strong></li>
  <li>Board games & puzzles: <strong>35–50% gross margin</strong></li>
  <li>Educational toys: <strong>50–70% gross margin</strong></li>
</ul>
<p><strong>Key tip:</strong> Offer bundled deals ("Buy 2 Get 1 at 50% off") during peak seasons like Diwali, Children's Day, and summer holidays to increase average transaction value.</p>

<h2>Step 6: Market Your Toy Shop</h2>
<p>Modern toy retail success requires both offline and online presence:</p>
<ul>
  <li>📍 <strong>Google Business Profile</strong> — Set up your free listing so parents searching "toy shop near me" find you</li>
  <li>📱 <strong>WhatsApp Business</strong> — Share new arrivals and offers with your regular customers</li>
  <li>📸 <strong>Instagram & Facebook</strong> — Post videos of toys in action (kids love this, parents share it)</li>
  <li>🎁 <strong>Seasonal Promotions</strong> — Diwali, Christmas, Children's Day are peak buying seasons — plan your inventory 2 months in advance</li>
</ul>

<h2>Ready to Start? Let's Partner!</h2>
<p>Starting a toy retail business is one of the best business opportunities in India right now. The demand is consistent, the products are fun to work with, and the margins are attractive when you source right.</p>
<p>Bafna Toys has been the wholesale toy supplier of choice for <strong>1,000+ retailers across India</strong>. We'd love to be your supplier too. <a href="/contact">Contact us today</a> to get started.</p>
    `,
  },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Upload all images
    console.log("\n📸 Uploading images to ImageKit...");
    const [pullbackUrl, bisUrl, retailUrl] = await Promise.all([
      uploadImage(imagePaths.pullback, "blog_pullback_cars.png"),
      uploadImage(imagePaths.bis, "blog_bis_certified_toys.png"),
      uploadImage(imagePaths.retail, "blog_how_to_start_toy_business.png"),
    ]);

    const blogData = await blogs(pullbackUrl, bisUrl, retailUrl);

    // Insert blogs
    console.log("\n📝 Saving blogs to database...");
    for (const blog of blogData) {
      const existing = await Blog.findOne({ slug: blog.slug });
      if (existing) {
        console.log(`⏭️  Skipped (already exists): ${blog.title}`);
        continue;
      }
      await Blog.create(blog);
      console.log(`✅ Created: ${blog.title}`);
    }

    console.log("\n🎉 All done! 3 professional SEO blogs are now live.");
    mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
};

seed();
