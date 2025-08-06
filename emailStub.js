// emailStub.js
// Simple email sending abstraction for verification codes and magic links
// Replace with nodemailer, SES, or another provider for production

async function sendVerificationEmail(to, codeOrLink) {
  // Demo: just log to console
  console.log(`[EMAIL STUB] To: ${to} | Code/Link: ${codeOrLink}`);
  // In production, send real email here
  return true;
}

module.exports = { sendVerificationEmail };
