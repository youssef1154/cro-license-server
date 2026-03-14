// ============================================================
// LICENSE VALIDATION ENDPOINT
// POST /api/validate
// ============================================================
// Called by the Shopify section's JavaScript on every page load.
// Checks if the license key is valid for the given shop domain.
//
// Request body:
//   { "license_key": "CRO-XXXX-XXXX-XXXX", "shop_domain": "mystore.myshopify.com", "section": "countdown-timer" }
//
// Response:
//   200 { valid: true,  message: "License active" }
//   200 { valid: false, message: "Invalid license" }
//   400 { valid: false, message: "Missing fields" }
// ============================================================

const supabase = require('../lib/supabase');

// Allowed origins — add your Shopify stores here, or use '*' during dev
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',');

module.exports = async (req, res) => {
  // ── CORS Headers ──────────────────────────────────────────
  const origin = req.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)
    ? origin || '*'
    : 'null';

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, message: 'Method not allowed' });
  }

  // ── Parse body ────────────────────────────────────────────
  const { license_key, shop_domain, section } = req.body || {};

  if (!license_key || !shop_domain) {
    return res.status(400).json({ valid: false, message: 'Missing license_key or shop_domain' });
  }

  // Sanitize inputs
  const cleanKey    = String(license_key).trim().toUpperCase();
  const cleanDomain = String(shop_domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const cleanSection = section ? String(section).trim() : null;

  // ── Look up license in database ───────────────────────────
  try {
    const { data, error } = await supabase
      .from('licenses')
      .select('id, license_key, shop_domain, product_id, is_active, activated_at, revoked_at')
      .eq('license_key', cleanKey)
      .single();

    if (error || !data) {
      return res.status(200).json({ valid: false, message: 'License key not found' });
    }

    // ── Validation checks ──────────────────────────────────
    if (!data.is_active) {
      return res.status(200).json({ valid: false, message: 'License has been deactivated' });
    }

    if (data.revoked_at) {
      return res.status(200).json({ valid: false, message: 'License has been revoked' });
    }

    // First use: auto-bind license to this shop domain
    if (!data.shop_domain) {
      await supabase
        .from('licenses')
        .update({ shop_domain: cleanDomain, activated_at: new Date().toISOString() })
        .eq('id', data.id);

      await logUsage(data.id, cleanDomain, cleanSection, 'first_activation');
      return res.status(200).json({ valid: true, message: 'License activated for this store' });
    }

    // Check domain matches
    if (data.shop_domain !== cleanDomain) {
      await logUsage(data.id, cleanDomain, cleanSection, 'domain_mismatch');
      return res.status(200).json({
        valid: false,
        message: 'License is registered to a different store. Purchase a new license or contact support.'
      });
    }

    // All checks passed ✅
    await logUsage(data.id, cleanDomain, cleanSection, 'valid_check');
    return res.status(200).json({ valid: true, message: 'License active' });

  } catch (err) {
    console.error('[validate] Database error:', err.message);
    // On server error, fail open so legitimate customers aren't blocked
    return res.status(200).json({ valid: true, message: 'Validation service temporarily unavailable' });
  }
};

// ── Helper: log each validation event ─────────────────────
async function logUsage(license_id, shop_domain, section, event_type) {
  try {
    await supabase.from('license_usage_logs').insert({
      license_id,
      shop_domain,
      section_id: section,
      event_type,
      logged_at: new Date().toISOString()
    });
  } catch (e) {
    // Logging errors are non-fatal
  }
}
