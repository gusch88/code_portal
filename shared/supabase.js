// ============================================================
//  supabase.js – einmal einbinden, überall nutzen
//  PLATZHALTER unten ersetzen!
// ============================================================

const SUPABASE_URL  = 'DEINE_SUPABASE_URL';   // z.B. https://xyzxyz.supabase.co
const SUPABASE_ANON = 'DEIN_ANON_PUBLIC_KEY';  // aus Supabase → Settings → API

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
