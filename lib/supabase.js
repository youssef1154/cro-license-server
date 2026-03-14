// ============================================================
// Supabase Database Client
// CRO License System — [Your Brand]
// ============================================================
// SETUP:
//   1. Create a free Supabase project at https://supabase.com
//   2. Run the SQL in /setup/schema.sql to create tables
//   3. Copy your project URL and anon key to .env
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl  = process.env.SUPABASE_URL;
const supabaseKey  = process.env.SUPABASE_SERVICE_KEY; // Use service key (not anon) for server-side

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
