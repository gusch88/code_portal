/**
 * Importiert die KBA-Bestandsstatistik (FZ 1, lokale XLSX-Datei) und schreibt
 * pro Kennzeichen-Code eine geschätzte Fahrzeuganzahl nach Supabase.
 *
 * Läuft einmal jährlich manuell, siehe SETUP_BESTAND.md für den vollen Ablauf.
 *
 * Usage:
 *   node import-bestand.js <pfad-zur-xlsx> <jahr> [--dry-run]
 *   node import-bestand.js fz1_2026.xlsx 2026 --dry-run
 *
 *   node import-bestand.js <pfad-zur-xlsx> --inspect
 *     Zeigt Tabellenblätter + erste Zeilen roh an, ohne zu parsen — hilft,
 *     die Spaltennamen/Header-Position herauszufinden, falls das reale
 *     KBA-Layout von der erwarteten Struktur abweicht.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const inspect = args.includes('--inspect');
const positional = args.filter(a => !a.startsWith('--'));
const [xlsxPath, yearArg] = positional;

if (!xlsxPath || !fs.existsSync(xlsxPath)) {
  console.error('Error: Pfad zur XLSX-Datei fehlt oder existiert nicht.');
  console.error('Usage: node import-bestand.js <pfad-zur-xlsx> <jahr> [--dry-run]');
  process.exit(1);
}

async function inspectFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  console.log(`📄 ${workbook.worksheets.length} Tabellenblatt/-blätter gefunden:\n`);
  workbook.worksheets.forEach(ws => {
    const rows = sheetToRows(ws);
    console.log(`── "${ws.name}" (${rows.length} Zeilen) ──`);
    rows.slice(0, 15).forEach((r, i) => console.log(`  [${i}]`, JSON.stringify(r)));
    console.log('');
  });
}

let sourceYear;
if (!inspect) {
  sourceYear = parseInt(yearArg, 10);
  if (!sourceYear) {
    console.error('Error: Jahr fehlt oder ist ungültig.');
    console.error('Usage: node import-bestand.js <pfad-zur-xlsx> <jahr> [--dry-run]');
    process.exit(1);
  }
  if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE)) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE must be set in .env (nicht der anon-Key — siehe SETUP_BESTAND.md).');
    process.exit(1);
  }
}

// Von KBA verwendete Präfixe/Suffixe, die die geojson-Namen nicht führen.
const NAME_AFFIXES = /^(LK|SK|Landkreis|Kreisfreie Stadt|Stadtkreis|Kreis)\s+|,?\s*(Landkreis|Kreisfreie Stadt|Stadtkreis|Kreis|Stadt)$/gi;

// Bekannte hartnäckige Fälle, bei denen Namensnormalisierung allein nicht
// reicht (z.B. Gebietskörperschaften ohne klassisches "Landkreis X"-Muster,
// oder Stadt/Kreis-Homonyme). Wird bei Bedarf nach einem ersten Dry-Run
// gegen die echte KBA-Datei ergänzt — key ist der normalisierte KBA-Name,
// Wert die ARS (5-stellig) aus kreise.geojson.
const OVERRIDES = {};

// KBA schreibt Namen in Großbuchstaben mit transliterierten Umlauten
// (z.B. "BOEBLINGEN" statt "Böblingen"). Beide Seiten auf dieselbe
// ASCII-Form zu bringen ist zuverlässiger, als KBAs verlustbehaftete
// Transliteration wieder rückgängig machen zu wollen.
function normalizeName(raw) {
  return raw
    .normalize('NFC')
    .replace(NAME_AFFIXES, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

function loadKreise() {
  const geoPath = path.join(__dirname, 'kreise.geojson');
  const geo = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
  return geo.features.map(f => ({
    name: f.properties.NAME,
    ars: f.properties.ARS,
    ars5: String(f.properties.ARS).slice(0, 5),
    codes: (f.properties.KFZ || '').trim().split(/\s+/).filter(Boolean),
  }));
}

// Das reale KBA-FZ1-Layout (Blatt "FZ1.1") hat einen zweizeiligen Header:
// eine Kategorie-Zeile (z.B. "Kraftfahrzeuge") direkt über einer
// Unterspalten-Zeile (z.B. "insgesamt") — Excel zeigt die Kategorie als
// verbundene Zelle über mehrere Spalten. "insgesamt" taucht dabei mehrfach
// auf (Krafträder insgesamt, PKW insgesamt, LKW insgesamt, ...), daher
// reicht die Unterspalten-Zeile allein nicht: erst die Kombination aus
// Kategorie == "Kraftfahrzeuge" UND Unterspalte == "insgesamt" trifft
// eindeutig die Gesamt-Bestandsspalte (alle Fahrzeugarten zusammen).
// Zulassungsbezirk-Schlüssel und -Name stehen kombiniert in einer Spalte,
// z.B. "08111 STUTTGART,STADT" (siehe parseFZ1).
function findHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const nameArsCol = row.findIndex(c => typeof c === 'string' && /zulassungsbezirk/i.test(c));
    if (nameArsCol === -1) continue;

    const categoryRow = rows[i - 1] || [];
    let bestandCol = -1;
    for (let c = 0; c < row.length; c++) {
      const sub = typeof row[c] === 'string' ? row[c].trim().toLowerCase() : '';
      const cat = typeof categoryRow[c] === 'string' ? categoryRow[c].trim().toLowerCase() : '';
      if (sub === 'insgesamt' && cat === 'kraftfahrzeuge') { bestandCol = c; break; }
    }
    if (bestandCol === -1) continue;
    return { headerIdx: i, nameArsCol, bestandCol };
  }
  return null;
}

function sheetToRows(worksheet) {
  const rows = [];
  worksheet.eachRow({ includeEmpty: true }, sheetRow => {
    const arr = [];
    sheetRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      arr[colNumber - 1] = cell.value;
    });
    rows.push(arr);
  });
  return rows;
}

// KBA-Exporte haben mehrere Tabellenblätter (Deckblatt, Impressum,
// Inhaltsverzeichnis, FZ1.1, FZ1.2, ...) — alle Sheets nach der ersten
// Zeile durchsuchen, die zur erwarteten Kopf-Struktur passt.
async function parseFZ1(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  for (const worksheet of workbook.worksheets) {
    const rows = sheetToRows(worksheet);
    const header = findHeader(rows);
    if (!header) continue;

    const { headerIdx, nameArsCol, bestandCol } = header;
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[nameArsCol]) continue;
      // Zeile ist "<5-stelliger Schlüssel> <Name>", z.B. "08111 STUTTGART,STADT".
      // Zwischensummen/Fußnoten ohne diesen Schlüssel werden übersprungen.
      const match = String(row[nameArsCol]).trim().match(/^(\d{5})\s+(.+)$/);
      if (!match) continue;
      const bestand = Number(row[bestandCol]);
      if (!bestand || Number.isNaN(bestand)) continue;
      out.push({ ars: match[1], name: match[2].trim(), bestand });
    }
    if (out.length) return out;
  }

  throw new Error('Konnte in keinem Tabellenblatt eine passende Kopf-Struktur finden. Führe "node import-bestand.js <datei> --inspect" aus und schau dir die echten Spaltenüberschriften an.');
}

function matchKreis(row, kreise) {
  if (row.ars) {
    const ars5 = row.ars.slice(0, 5);
    const byArs = kreise.find(k => k.ars5 === ars5);
    if (byArs) return byArs;
  }
  const norm = normalizeName(row.name);
  const byName = kreise.find(k => normalizeName(k.name) === norm);
  if (byName) return byName;

  if (OVERRIDES[norm]) {
    return kreise.find(k => k.ars5 === OVERRIDES[norm]) || null;
  }
  return null;
}

function buildBestandRows(fz1Rows, kreise, year) {
  const out = [];
  const unmatched = [];
  const now = new Date().toISOString();

  fz1Rows.forEach(row => {
    const kreis = matchKreis(row, kreise);
    if (!kreis || kreis.codes.length === 0) {
      unmatched.push(row);
      return;
    }
    const n = kreis.codes.length;
    const estimate = Math.round(row.bestand / n);
    kreis.codes.forEach(code => {
      out.push({
        code,
        ars: kreis.ars5,
        kreis_name: kreis.name,
        bestand_kreis: row.bestand,
        code_count: n,
        bestand_estimate: estimate,
        is_shared: n > 1,
        source_year: year,
        source_label: 'KBA FZ 1',
        updated_at: now,
      });
    });
  });

  return { rows: out, unmatched };
}

async function upsertBestand(sb, rows) {
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await sb.from('kennzeichen_bestand').upsert(batch, { onConflict: 'code' });
    if (error) throw error;
    console.log(`  ✓ Batch ${i / batchSize + 1} / ${Math.ceil(rows.length / batchSize)}`);
  }
}

async function main() {
  try {
    if (inspect) {
      await inspectFile(xlsxPath);
      return;
    }

    console.log(`⚙️  Lese kreise.geojson und ${xlsxPath}...`);
    const kreise = loadKreise();
    const fz1Rows = await parseFZ1(xlsxPath);
    console.log(`  → ${fz1Rows.length} Zeilen aus der KBA-Datei gelesen`);

    const { rows: bestandRows, unmatched } = buildBestandRows(fz1Rows, kreise, sourceYear);
    console.log(`  → ${bestandRows.length} Code-Zeilen erzeugt (${fz1Rows.length - unmatched.length} von ${fz1Rows.length} Kreisen zugeordnet)`);

    if (unmatched.length) {
      console.warn(`⚠️  ${unmatched.length} KBA-Zeilen konnten keinem Kreis zugeordnet werden:`);
      unmatched.forEach(r => console.warn('   -', r.name, r.ars || ''));
    }

    if (dryRun) {
      console.log('\n🔎 Dry-Run — es wird nichts geschrieben. Beispielzeilen:');
      console.log(bestandRows.slice(0, 10));
      console.log(`\n✅ Dry-Run abgeschlossen (${bestandRows.length} Zeilen wären geschrieben worden).`);
      return;
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    console.log(`\n🔄 Schreibe ${bestandRows.length} Zeilen nach Supabase...`);
    await upsertBestand(sb, bestandRows);
    console.log('✅ Bestand erfolgreich importiert');
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
