// ============================================================
// LICENSE KEY GENERATOR ENDPOINT
// POST /api/generate
// ============================================================
// Called by Shopify Order webhook (or manually) to create a
// new license key after a customer completes a purchase.
//
// This endpoint is PROTECTED — requires ADMIN_SECRET header.
//
// Request headers:
//   x-admin-secret: <your ADMIN_SECRET env var>
//
// Request body:
//   {
//     "order_id": "shopify_order_id",
//     "customer_email": "buyer@example.com",
//     "product_handle": "cro-countdown-timer",   // product slug
//     "quantity": 1                               // keys to generate
//   }
//
// Response:
//   { success: true, keys: ["CRO-XXXX-XXXX-XXXX"] }
// ============================================================

const { randomBytes } = require('crypto');
const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'null'); // No CORS — internal only
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // ── Admin auth ────────────────────────────────────────────
  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || providedSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { order_id, customer_email, product_handle, quantity = 1 } = req.body || {};

  if (!order_id || !customer_email || !product_handle) {
    return res.status(400).json({ success: false, message: 'Missing required fields: order_id, customer_email, product_handle' });
  }

  const count = Math.min(parseInt(quantity) || 1, 10); // max 10 keys per request
  const generatedKeys = [];

  try {
    for (let i = 0; i < count; i++) {
      const key = generateLicenseKey();

      const { error } = await supabase.from('licenses').insert({
        license_key:     key,
        order_id:        String(order_id),
        customer_email:  String(customer_email).toLowerCase().trim(),
        product_id:      String(product_handle),
        shop_domain:     null,          // bound on first activation
        is_active:       true,
        created_at:      new Date().toISOString(),
        activated_at:    null,
        revoked_at:      null
      });

      if (error) throw error;
      generatedKeys.push(key);
    }

    console.log(`[generate] Created ${count} key(s) for order ${order_id} — ${customer_email}`);

    return res.status(200).json({
      success: true,
      keys:    generatedKeys,
      message: `${count} license key(s) generated successfully`
    });

  } catch (err) {
    console.error('[generate] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate license key' });
  }
};

// ── Key format: CRO-XXXX-XXXX-XXXX-XXXX (hex, uppercase) ──
function generateLicenseKey() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(randomBytes(2).toString('hex').toUpperCase());
  }
  return 'CRO-' + segments.join('-');
}
