/**
 * Sync German license plates from GitHub CSV to Supabase
 * Usage: node sync-plates.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON;
const CSV_URL = 'https://raw.githubusercontent.com/openpotato/kfz-kennzeichen/main/src/de/kennzeichen.csv';

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Error: SUPABASE_URL and SUPABASE_ANON must be set in .env');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

async function fetchCSV() {
  console.log('📥 Downloading CSV from GitHub...');
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.statusText}`);
  return res.text();
}

function parseCSV(csv) {
  console.log('⚙️ Parsing CSV...');
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.trim());
  const plates = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse CSV with quoted fields support
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current.trim().replace(/^"|"$/g, ''));

    // Map fields
    const plate = {
      code: fields[1]?.trim() || '',
      region: fields[2]?.trim() || '',
      federal_state: fields[4]?.trim() || '',
      federal_state_code: fields[5]?.trim() || '',
    };

    if (plate.code) {
      plates.push(plate);
    }
  }

  return plates;
}

async function syncPlates(plates) {
  console.log(`\n🔄 Syncing ${plates.length} plates to Supabase...`);

  // Get existing plates
  const { data: existing } = await sb.from('kennzeichen_plates').select('code');
  const existingCodes = new Set(existing?.map(p => p.code) || []);

  // Filter new plates
  const newPlates = plates.filter(p => !existingCodes.has(p.code));
  console.log(`  → ${newPlates.length} new plates to insert`);
  console.log(`  → ${existingCodes.size} plates already exist`);

  if (newPlates.length === 0) {
    console.log('✅ Database is up to date');
    return;
  }

  // Insert in batches
  const batchSize = 100;
  for (let i = 0; i < newPlates.length; i += batchSize) {
    const batch = newPlates.slice(i, i + batchSize);
    const { error } = await sb.from('kennzeichen_plates').insert(batch);
    
    if (error) {
      console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, error);
      throw error;
    }
    
    console.log(`  ✓ Inserted batch ${Math.floor(i / batchSize) + 1} / ${Math.ceil(newPlates.length / batchSize)}`);
  }

  console.log(`\n✅ Successfully synced ${newPlates.length} new plates`);
}

async function main() {
  try {
    const csv = await fetchCSV();
    const plates = parseCSV(csv);
    await syncPlates(plates);
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
