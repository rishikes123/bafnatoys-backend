/**
 * Category ki MAIN images ka background-removal ImageKit se pehle hi
 * bana kar cache karwa deta hai.
 *
 * Kyun: ImageKit AI cut-out pehli request par banata hai (5-15 sec).
 * Agar ye pehle se na karwaya jaye to us category ka pehla customer
 * khali dabbe dekhta hai. Ye script wo kaam pehle hi kar deti hai.
 *
 * Ye ye bhi batata hai ki kitne AI units lagenge / kitne kam pad rahe hain.
 *
 * Sirf dekhne ke liye (koi unit kharch nahi hoga):
 *   node scripts/warmBgRemove.js --count
 *
 * Ek category warm karo:
 *   node scripts/warmBgRemove.js --category "THE ANIMAL'S KINGDOM"
 *
 * Saari themed categories:
 *   node scripts/warmBgRemove.js --all
 *
 * Options:
 *   --limit 10    sirf pehle 10 (test ke liye)
 *   --width 500   kaunsi width warm karni hai (default 300 aur 400 dono)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");

const argVal = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const hasFlag = (f) => process.argv.includes(f);

const COUNT_ONLY = hasFlag("--count");
const ALL = hasFlag("--all");
const CATEGORY = argVal("--category", null);
const LIMIT = Number(argVal("--limit", 0)) || 0;

// frontend/src/utils/bgRemoveCategories.ts se milti-julti list.
// Yahan wo categories bhi rakh sakte ho jo abhi comment hain.
const THEMED_CATEGORIES = [
  "PULLBACK SERIES",
  "JET BLASTER CARS",
  "PLUSHIES",
  "THE ANIMAL'S KINGDOM",
];

// SIRF EK width. ImageKit har width ko alag AI operation ginta hai,
// isliye 5 widths = 5 units per image. Frontend bhi ab bg-removed
// images ke liye srcSet nahi bhejta — dono ek hi width par hain.
const WIDTHS = [400];

const bgUrl = (url, w) => {
  if (!url.includes("ik.imagekit.io")) return null;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}tr=e-bgremove,w-${w},q-85,f-png`;
};

async function mainImagesOf(categoryName) {
  const Category = mongoose.connection.collection("categories");
  const cat = await Category.findOne({
    name: new RegExp(`^${categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });
  if (!cat) return { found: false, urls: [] };

  const products = await Product.find({ category: cat._id })
    .select("images")
    .lean();

  const urls = products
    .map((p) => (Array.isArray(p.images) ? p.images[0] : p.images))
    .filter((u) => u && String(u).includes("ik.imagekit.io"));

  return { found: true, urls: LIMIT ? urls.slice(0, LIMIT) : urls };
}

async function warmOne(url) {
  const results = [];
  for (const w of WIDTHS) {
    const target = bgUrl(url, w);
    try {
      const res = await fetch(target, { method: "GET" });
      results.push(res.status);
      if (res.status === 403) break; // units khatam — aage koshish bekaar
    } catch (err) {
      results.push(0);
    }
  }
  return results;
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const targets = CATEGORY ? [CATEGORY] : ALL ? THEMED_CATEGORIES : null;

    if (!targets && !COUNT_ONLY) {
      console.log(
        "Kya karna hai bataiye:\n" +
          "  --count                    sirf ginti (koi unit kharch nahi)\n" +
          '  --category "NAME"          ek category warm karo\n' +
          "  --all                      saari themed categories\n"
      );
      return;
    }

    if (COUNT_ONLY) {
      console.log("Kitni MAIN images hain (= kitne AI units lagenge)\n");
      let total = 0;
      for (const name of THEMED_CATEGORIES) {
        const { found, urls } = await mainImagesOf(name);
        console.log(
          "  " + name.padEnd(24) + (found ? String(urls.length).padStart(4) : "  --")
        );
        if (found) total += urls.length;
      }
      console.log("  " + "-".repeat(30));
      console.log("  " + "KUL".padEnd(24) + String(total).padStart(4));
      console.log(
        "\nDhyan: jo images pehle se cached hain unke liye naya unit nahi lagta."
      );
      return;
    }

    let done = 0;
    let quotaHit = false;

    for (const name of targets) {
      const { found, urls } = await mainImagesOf(name);
      if (!found) {
        console.log(`\n${name}: category nahi mili — naam check karo`);
        continue;
      }

      console.log(`\n${name} — ${urls.length} images`);
      for (let i = 0; i < urls.length; i += 1) {
        const codes = await warmOne(urls[i]);
        const ok = codes.every((c) => c === 200);
        const limited = codes.includes(403);
        if (limited) quotaHit = true;

        process.stdout.write(
          `\r  ${i + 1}/${urls.length}  ${ok ? "ok" : limited ? "AI UNITS KHATAM" : "fail " + codes.join(",")}          `
        );
        if (limited) break;
        done += 1;
      }
      console.log("");
      if (quotaHit) break;
    }

    console.log(`\n${done} images warm ho gayin.`);
    if (quotaHit) {
      console.log(
        "\n⚠️  ImageKit ke AI extension units khatam ho gaye (HTTP 403 ELIMIT).\n" +
          "   Dashboard → Billing → AI extension units se top-up karke\n" +
          "   ye script dobara chala dena. Jo ban chuki hain wo dobara\n" +
          "   unit nahi lengi."
      );
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
