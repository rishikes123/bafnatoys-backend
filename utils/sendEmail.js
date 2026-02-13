const nodemailer = require("nodemailer");
const dns = require("dns");

const sendEmail = async (options) => {
  try {
    // Step 1: Zabardasti IPv4 Address dhoondo (System DNS bypass)
    const gmailIp = await new Promise((resolve, reject) => {
      dns.resolve4('smtp.gmail.com', (err, addresses) => {
        if (err || !addresses.length) {
          reject(new Error("Failed to resolve Gmail IPv4"));
        } else {
          resolve(addresses[0]); // Pehla IPv4 address utha lo
        }
      });
    });

    console.log(`🔍 Resolved Gmail IP: ${gmailIp}`); // Log me IP dikhega

    // Step 2: Usi IP ko use karke connect karo
    const transporter = nodemailer.createTransport({
      host: gmailIp,          // ✅ Direct IP use kar rahe hain
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        servername: 'smtp.gmail.com', // ✅ Server ko asli naam batana zaroori hai
        rejectUnauthorized: false     // ✅ Strict SSL check disable (Timeout fix)
      }
    });

    const mailOptions = {
      from: `"Bafna Toys System" <${process.env.EMAIL_USER}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully: ${info.messageId}`);
    return info;

  } catch (error) {
    console.error("❌ Email Send Failed:", error.message);
  }
};

module.exports = sendEmail;