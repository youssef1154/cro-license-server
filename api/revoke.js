// ============================================================
// LICENSE REVOKE / TRANSFER ENDPOINT
// POST /api/revoke
// ============================================================
// Admin-only: revoke a license or reset its shop_domain binding
// (used for refunds or store transfers)
//
// Request headers:
//   x-admin-secret: <ADMIN_SECRET>
//
// Request body:
//   { "license_key": "CRO-XXXX-XXXX-XXXX", "action": "revoke" | "reset" }
//
//   revoke → is_active = false (no store can use it)
//   reset  → shop_domain = null (allows re-binding to a new store)
// ============================================================

const supabase = require('../lib/supabase');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const providedSecret = req.headers['x-admin-secret'];
  if (!providedSecret || providedSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { license_key, action } = req.body || {};

  if (!license_key || !['revoke', 'reset'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Provide license_key and action (revoke|reset)' });
  }

  const cleanKey = String(license_key).trim().toUpperCase();

  try {
    let updatePayload = {};

    if (action === 'revoke') {
      updatePayload = { is_active: false, revoked_at: new Date().toISOString() };
    } else if (action === 'reset') {
      updatePayload = { shop_domain: null, activated_at: null };
    }

    const { data, error } = await supabase
      .from('licenses')
      .update(updatePayload)
      .eq('license_key', cleanKey)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: 'License key not found' });
    }

    return res.status(200).json({
      success: true,
      message: action === 'revoke'
        ? `License ${cleanKey} has been revoked`
        : `License ${cleanKey} has been reset — can be activated on a new store`,
      license: { key: data.license_key, is_active: data.is_active, shop_domain: data.shop_domain }
    });

  } catch (err) {
    console.error('[revoke] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
