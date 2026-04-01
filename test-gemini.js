require('dotenv').config();

async function checkAvailableModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ No API key found!");
        return;
    }

    console.log("🔑 Checking API Key ending in:", apiKey.slice(-4));
    console.log("📡 Contacting Google Servers directly...");

    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok && data.models) {
            console.log("\n✅ SUCCESS! Google says your key can use these models:");
            // Filter to show only the important generative models
            const genModels = data.models.filter(m => 
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")
            );
            genModels.forEach(m => console.log(`  👉 ${m.name}`));
            
            const hasFlash = genModels.some(m => m.name === 'models/gemini-1.5-flash');
            if (hasFlash) {
                console.log("\n🎯 RESULT: Your key IS allowed to use gemini-1.5-flash! The Node package is definitely the problem.");
            } else {
                console.log("\n🚨 RESULT: Google is NOT giving this key access to gemini-1.5-flash. We need to check your Google Cloud Console project.");
            }
        } else {
            console.error("\n❌ API REJECTED THE REQUEST:");
            console.error(data);
        }
    } catch (error) {
        console.error("\n❌ NETWORK ERROR:", error.message);
    }
}

checkAvailableModels();