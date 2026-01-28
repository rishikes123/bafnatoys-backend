const express = require('express');
const router = express.Router();
const Product = require('../models/Product'); // Ensure this matches your Product Model file

// @route   GET /api/share/product/:id
// @desc    Generate WhatsApp Preview with Image & Redirect
router.get('/product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        
        // If product not found, return 404
        if (!product) return res.status(404).send("Product not found");

        // ✅ CONFIGURATION: Update these domains for your Live Server
        // FRONTEND_DOMAIN: Where the customer should land (e.g., https://bafnatoys.com)
        const FRONTEND_DOMAIN = process.env.FRONTEND_URL || "https://bafnatoys.com"; 
        
        // BACKEND_DOMAIN: Where your images/API are hosted (e.g., https://admin.bafnatoys.com)
        const BACKEND_DOMAIN = process.env.ADMIN_URL || "https://admin.bafnatoys.com"; 

        const destinationUrl = `${FRONTEND_DOMAIN}/product/${product._id}`;
        
        // Image Logic: Handle Cloudinary (http) vs Local Uploads
        let imageUrl = "";
        if (product.images && product.images.length > 0) {
            imageUrl = product.images[0];
            if (imageUrl && !imageUrl.startsWith('http')) {
                 // Remove leading slash if present
                 const cleanPath = imageUrl.startsWith('/') ? imageUrl.slice(1) : imageUrl;
                 imageUrl = `${BACKEND_DOMAIN}/${cleanPath}`;
            }
        }

        // ✅ HTML Response for WhatsApp Bot
        // The <title> and <meta> tags tell WhatsApp what to show.
        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                
                <title>${product.name} | Bafna Toys</title>
                <meta property="og:site_name" content="Bafna Toys" />
                <meta property="og:title" content="${product.name}" />
                <meta property="og:description" content="New Arrival! Price: ₹${product.price}. Order Now!" />
                
                <meta property="og:image" content="${imageUrl}" />
                <meta property="og:image:width" content="600" />
                <meta property="og:image:height" content="600" />
                <meta property="og:type" content="product" />
                <meta property="og:url" content="${destinationUrl}" />
                
                <style>
                    body { font-family: sans-serif; text-align: center; padding: 50px; }
                </style>
            </head>
            <body>
                <p>Redirecting to Bafna Toys...</p>
                <script>
                    // ✅ Redirect user immediately to the actual product page
                    window.location.href = "${destinationUrl}";
                </script>
            </body>
            </html>
        `;

        res.send(html);

    } catch (err) {
        console.error("Share Route Error:", err);
        res.status(500).send("Error generating preview");
    }
});

module.exports = router;