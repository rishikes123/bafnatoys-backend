/**
 * Har product par ratings ko ek target tak le jaata hai (top-up).
 *
 * Jitni ratings pehle se hain wo ginti me aati hain — sirf kami poori hoti
 * hai. Isliye baar-baar chalane par bhi ratings phoolti nahi.
 *
 * Style maujooda ratings jaisa hi:
 *   shop name  : "<Dukaan ka naam> – <Sheher>"  (Indian B2B retailer)
 *   rating mix : 5★ ~90%, 4★ ~9%, 3★ ~1%
 *   date       : pichle kuch mahine me bikhri hui
 *
 * Dry run (sirf batata hai, kuch add nahi karta):
 *   node scripts/seedProductRatings.js
 * Sach me add karne ke liye:
 *   node scripts/seedProductRatings.js --apply
 *
 * Control:
 *   --min 15 --max 25    har product par kitni ratings honi chahiye (default 15-25)
 *   --limit 20           sirf pehle 20 products (test ke liye)
 *   --months 10          kitne mahine peeche tak ki date (default 10)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Review = require("../models/Review");

const argVal = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
};

const APPLY = process.argv.includes("--apply");
const TARGET_MIN = Math.max(1, argVal("--min", 15));
const TARGET_MAX = Math.max(TARGET_MIN, argVal("--max", 25));
const LIMIT = argVal("--limit", 0);
const MONTHS_BACK = Math.max(1, argVal("--months", 10));

/* ── Dukaan ke naam ke tukde — Indian toy/gift retailers jaise ── */
const SHOP_PREFIXES = [
  // Toy shop style (maujooda naamon se)
  "Kids Toy Corner", "Kids Toy Hub", "Kids Toy Mart", "Kids Toy Land",
  "Kids Toy Express", "Kids Toy Kingdom", "Kids Toy Arena", "Kids Toy Plaza",
  "Kids Toy Mall", "Kids Toy Bazaar", "Kids Toy Gallery", "Kids Toy Point",
  "Toy Fun World", "Toy Fun Zone", "Toy Kids Hub", "Toy Wonder World",
  "Toy Planet", "Toy Junction", "Toy Galaxy", "Toy Treasure",
  "Little Toy Shop", "Happy Toy Store", "Smart Toy Store", "Star Toy Mart",
  "Baby Toy Corner", "Play House Toys", "Happy Kids Store", "Fun Kids Store",
  "Toy Villa", "Toy Cottage", "Toy Square", "Toy Street",
  "Rainbow Toys", "Sunshine Toys", "Dreamland Toys", "Funtime Toys",
  // Gift / general store style
  "Shree Gift House", "Shree Toys & Gifts", "New Gift Gallery",
  "Balaji Gift House", "Ganesh Toys & Gifts", "Krishna Gift Centre",
  "Laxmi Toys & Novelty", "Sai Gift Corner", "Maa Gift Centre",
  "Annapurna Stores", "Jai Bharat Stores", "National Gift House",
  "Modern Novelty Store", "City Gift Centre", "Super Gift Mart",
  "Variety Gift House", "Deluxe Novelty Store", "Ideal Gift Centre",
];

/* Indian surname wali dukaanein — B2B me bahut common */
const SURNAMES = [
  "Sharma", "Verma", "Gupta", "Agarwal", "Jain", "Mehta", "Patel", "Shah",
  "Singhal", "Bansal", "Mittal", "Goyal", "Khandelwal", "Chopra", "Kapoor",
  "Malhotra", "Arora", "Bhatia", "Saini", "Yadav", "Prajapati", "Chauhan",
  "Rathore", "Pandey", "Mishra", "Tiwari", "Dubey", "Joshi", "Desai",
  "Kulkarni", "Deshmukh", "Naik", "Reddy", "Rao", "Nair", "Menon",
  "Iyer", "Pillai", "Das", "Ghosh", "Dutta", "Banerjee", "Mondal",
  "Sahu", "Behera", "Mohanty", "Panda", "Barik",
];
const SURNAME_SUFFIX = [
  "Toys", "Toys & Gifts", "Traders", "Enterprises", "Stores",
  "Gift House", "Novelty Store", "Agencies", "Collection", "Sales",
];

const CITIES = [
  "Jodhpur", "Bareilly", "Mysore", "Salem", "Jalandhar", "Bhubaneswar",
  "Aurangabad", "Dehradun", "Raipur", "Chandigarh", "Amritsar", "Guwahati",
  "Aligarh", "Meerut", "Solapur", "Nashik", "Kota", "Udaipur", "Bhopal",
  "Indore", "Nagpur", "Vadodara", "Rajkot", "Jamshedpur", "Ranchi", "Patna",
  "Varanasi", "Kanpur", "Lucknow", "Agra", "Gwalior", "Jabalpur", "Trichy",
  "Madurai", "Coimbatore", "Kochi", "Warangal", "Vijayawada", "Hubli",
  "Belgaum", "Ajmer", "Bikaner", "Siliguri", "Cuttack", "Durgapur",
  "Rourkela", "Bilaspur", "Sagar", "Ujjain", "Mathura", "Firozabad",
  "Pune", "Mumbai", "Surat", "Ahmedabad", "Jaipur", "Ludhiana", "Patiala",
  "Panipat", "Rohtak", "Hisar", "Karnal", "Saharanpur", "Moradabad",
  "Gorakhpur", "Allahabad", "Jhansi", "Rewa", "Satna", "Ratlam", "Dewas",
  "Akola", "Amravati", "Jalgaon", "Kolhapur", "Sangli", "Latur", "Nanded",
  "Tirupati", "Guntur", "Nellore", "Kurnool", "Davangere", "Shimoga",
  "Mangalore", "Thrissur", "Kollam", "Kannur", "Erode", "Vellore",
  "Thanjavur", "Dindigul", "Hosur", "Asansol", "Howrah", "Malda",
  "Muzaffarpur", "Bhagalpur", "Darbhanga", "Gaya", "Dhanbad", "Bokaro",
  "Korba", "Raigarh", "Bhilai", "Jagdalpur", "Balasore", "Berhampur",
  "Sambalpur", "Puri", "Silchar", "Dibrugarh", "Imphal", "Agartala",
];

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

function makeShopName() {
  // ~35% surname wali dukaanein, baaki toy/gift shop names
  if (Math.random() < 0.35) {
    return `${pick(SURNAMES)} ${pick(SURNAME_SUFFIX)} – ${pick(CITIES)}`;
  }
  return `${pick(SHOP_PREFIXES)} – ${pick(CITIES)}`;
}

/** 5★ ~90%, 4★ ~9%, 3★ ~1% — maujooda mix se match karta hai */
function weightedRating() {
  const r = Math.random();
  if (r < 0.905) return 5;
  if (r < 0.993) return 4;
  return 3;
}

function randomDateWithinMonths(months) {
  const now = Date.now();
  const past = now - months * 30 * 24 * 60 * 60 * 1000;
  return new Date(past + Math.random() * (now - past));
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB Connected  (${APPLY ? "APPLY MODE" : "DRY RUN"})`);
    console.log(`   Target: har product par ${TARGET_MIN}–${TARGET_MAX} ratings\n`);

    let products = await Product.find().select("name sku").lean();
    if (LIMIT > 0) products = products.slice(0, LIMIT);

    // Kis product par abhi kitni ratings hain
    const counts = await Review.aggregate([
      { $group: { _id: "$productId", n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.n]));

    // Poore DB me jo naam pehle se use ho chuke hain
    const existingNames = new Set(await Review.distinct("shopName"));

    const docs = [];
    let alreadyOk = 0;

    for (const product of products) {
      const have = countMap.get(String(product._id)) || 0;
      const target = TARGET_MIN + rand(TARGET_MAX - TARGET_MIN + 1);
      const need = target - have;
      if (need <= 0) {
        alreadyOk += 1;
        continue;
      }

      // Ek hi product par ek dukaan ka naam do baar na aaye
      const usedHere = new Set();
      for (let i = 0; i < need; i += 1) {
        let shopName;
        let guard = 0;
        do {
          shopName = makeShopName();
          guard += 1;
        } while (usedHere.has(shopName) && guard < 40);
        usedHere.add(shopName);

        docs.push({
          productId: product._id,
          shopName,
          rating: weightedRating(),
          createdAt: randomDateWithinMonths(MONTHS_BACK),
        });
      }
    }

    const totalExisting = await Review.countDocuments();
    console.log(`Products                : ${products.length}`);
    console.log(`Pehle se target par     : ${alreadyOk}`);
    console.log(`Ratings abhi DB me      : ${totalExisting}`);
    console.log(`Jodni hain              : ${docs.length}`);
    console.log(`Baad me total           : ${totalExisting + docs.length}\n`);

    if (!docs.length) {
      console.log("👍 Har product target par hai. Kuch nahi kiya.");
      return;
    }

    const dist = docs.reduce((acc, d) => {
      acc[d.rating] = (acc[d.rating] || 0) + 1;
      return acc;
    }, {});
    const avg = docs.reduce((s, d) => s + d.rating, 0) / docs.length;
    const uniqueNames = new Set(docs.map((d) => d.shopName));
    const brandNew = [...uniqueNames].filter((n) => !existingNames.has(n)).length;

    console.log("Banne wali ratings:");
    console.log(`  5 star                : ${dist[5] || 0}`);
    console.log(`  4 star                : ${dist[4] || 0}`);
    console.log(`  3 star                : ${dist[3] || 0}`);
    console.log(`  average               : ${avg.toFixed(2)}`);
    console.log(`  alag-alag shop naam   : ${uniqueNames.size} (${brandNew} naye)\n`);

    console.log("Sample shop names:");
    [...uniqueNames].slice(0, 8).forEach((n) => console.log(`  ${n}`));

    if (!APPLY) {
      console.log(
        `\n⚠️  DRY RUN — kuch add nahi hua.\n    Add karne ke liye:  node scripts/seedProductRatings.js --apply`
      );
      return;
    }

    // Bade batch ko tukdon me daalo
    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const part = docs.slice(i, i + CHUNK);
      await Review.insertMany(part, { ordered: false });
      inserted += part.length;
      process.stdout.write(`\r   inserting... ${inserted}/${docs.length}`);
    }
    console.log(`\n\n✅ ${inserted} ratings add kar di gayin.`);
    console.log(`   Ab total reviews: ${await Review.countDocuments()}`);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
