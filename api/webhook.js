// ============================================================
// SHOPIFY ORDER WEBHOOK HANDLER
// POST /api/webhook
// ============================================================
// Shopify calls this URL automatically when a new order is paid.
// This handler:
//   1. Verifies the webhook is genuinely from Shopify (HMAC)
//   2. Generates a license key for each CRO product in the order
//   3. Emails the license key to the customer via SendGrid
//
// HOW TO REGISTER THIS WEBHOOK IN SHOPIFY:
//   Admin → Settings → Notifications → Webhooks
//   Event: orders/paid
//   URL: https://YOUR-VERCEL-APP.vercel.app/api/webhook
//   Format: JSON
// ============================================================

const crypto   = require('crypto');
const supabase = require('../lib/supabase');

// Read raw body from stream (needed for HMAC verification)
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString(); });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

// Product handles that should trigger license generation
// IMPORTANT: These must match your Shopify product handles exactly
const CRO_PRODUCT_HANDLES = [
  'cro-countdown-timer',
  'cro-sticky-atc-bar',
  'cro-trust-badges',
  'cro-upsell-bundle',
  'cro-booster-pack',       // The bundle listing
  'cro-starter-pack'
];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // ── 1. Read raw body from stream ──────────────────────────
  const rawBody    = await getRawBody(req);
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];

  if (!verifyShopifyHmac(hmacHeader, rawBody)) {
    console.warn('[webhook] Invalid HMAC — rejecting request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Parse the order ────────────────────────────────────
  let order;
  try {
    order = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const orderId       = String(order.id);
  const customerEmail = order.email?.toLowerCase()?.trim();
  const customerName  = order.billing_address?.first_name || order.customer?.first_name || 'there';
  const lineItems     = order.line_items || [];

  if (!customerEmail) {
    console.warn('[webhook] No customer email in order', orderId);
    return res.status(200).json({ received: true });
  }

  // ── 3. Find CRO products in this order ────────────────────
  const croItems = lineItems.filter(item =>
    CRO_PRODUCT_HANDLES.some(handle =>
      item.handle === handle ||
      (item.product_handle && item.product_handle.includes(handle))
    )
  );

  if (croItems.length === 0) {
    // Not a CRO product order — ignore
    return res.status(200).json({ received: true, message: 'No CRO products in order' });
  }

  // ── 4. Generate a license key per line item ────────────────
  const generatedKeys = [];

  for (const item of croItems) {
    const quantity = item.quantity || 1;

    for (let q = 0; q < quantity; q++) {
      const key = generateLicenseKey();

      await supabase.from('licenses').insert({
        license_key:    key,
        order_id:       orderId,
        customer_email: customerEmail,
        product_id:     item.product_handle || item.handle || 'unknown',
        shop_domain:    null,
        is_active:      true,
        created_at:     new Date().toISOString(),
        activated_at:   null,
        revoked_at:     null
      });

      generatedKeys.push({ key, product: item.title });
    }
  }

  // ── 5. Send license keys to customer via email ────────────
  if (process.env.SENDGRID_API_KEY) {
    await sendLicenseEmail(customerEmail, customerName, generatedKeys, orderId);
  } else {
    console.warn('[webhook] SENDGRID_API_KEY not set — skipping email. Keys:', generatedKeys);
  }

  console.log(`[webhook] Order ${orderId}: ${generatedKeys.length} key(s) generated for ${customerEmail}`);
  return res.status(200).json({ received: true, keys_generated: generatedKeys.length });
};

// ── HMAC Verification ──────────────────────────────────────
function verifyShopifyHmac(hmacHeader, rawBody) {
  if (!hmacHeader || !process.env.SHOPIFY_WEBHOOK_SECRET) return false;
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  const a = Buffer.from(computed);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── License Key Generator ──────────────────────────────────
function generateLicenseKey() {
  const { randomBytes } = require('crypto');
  const parts = Array.from({ length: 4 }, () => randomBytes(2).toString('hex').toUpperCase());
  return 'CRO-' + parts.join('-');
}

// ── Send email via SendGrid ────────────────────────────────
async function sendLicenseEmail(toEmail, customerName, keys, orderId) {
  const keyRows = keys.map(k =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#111;">${k.product}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:15px;color:#2563EB;letter-spacing:1px;">${k.key}</td>
    </tr>`
  ).join('');

  const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#111;">
  <h2 style="color:#111;">Your CRO Booster Pack License Keys 🔑</h2>
  <p>Hi ${customerName},</p>
  <p>Thank you for your purchase! Here are your license keys for order <strong>#${orderId}</strong>:</p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #eee;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:#F3F4F6;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#6B7280;">Product</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;text-transform:uppercase;color:#6B7280;">License Key</th>
      </tr>
    </thead>
    <tbody>${keyRows}</tbody>
  </table>

  <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:14px 16px;margin:20px 0;">
    <strong>⚠️ Important:</strong> Each license key works on <strong>one store only</strong>.
    The key is automatically locked to the first Shopify store that activates it.
    If you need to transfer your license, contact our support.
  </div>

  <h3>How to activate your section:</h3>
  <ol>
    <li>In your Shopify Admin go to <strong>Online Store → Themes → Edit Code</strong></li>
    <li>Under Sections, add a new section with the name from the README</li>
    <li>Paste the section code and Save</li>
    <li>In the Theme Editor (Customize), add the section to your product page</li>
    <li>In the section settings, paste your <strong>License Key</strong></li>
    <li>Save — your section is now active! 🎉</li>
  </ol>

  <p>Questions? Reply to this email or contact us at <a href="mailto:support@yourbrand.com">support@yourbrand.com</a></p>
  <p style="color:#9CA3AF;font-size:12px;margin-top:30px;">CRO Booster Pack · License is non-transferable without permission · Single store use only</p>
</body>
</html>`;

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: toEmail }] }],
        from: { email: process.env.FROM_EMAIL || 'noreply@yourbrand.com', name: 'CRO Booster Pack' },
        subject: `Your License Keys — Order #${orderId}`,
        content: [{ type: 'text/html', value: htmlBody }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[email] SendGrid error:', err);
    } else {
      console.log(`[email] License email sent to ${toEmail}`);
    }
  } catch (err) {
    console.error('[email] Fetch error:', err.message);
  }
}
