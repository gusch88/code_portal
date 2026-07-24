# Kennzeichen-Bestand / Seltenheit Setup

Diese Erweiterung zeigt pro Kennzeichen-Code an, wie viele Fahrzeuge damit
bundesweit zugelassen sind ("Bestand") und leitet daraus eine Seltenheits-
Einstufung ab (Häufig / Mittel / Selten).

Datenquelle: **Kraftfahrt-Bundesamt (KBA), Statistik FZ 1 – "Bestand an
Kraftfahrzeugen und Kraftfahrzeuganhängern nach Zulassungsbezirken"**,
jährlich veröffentlicht (Stichtag 1. Januar) unter
https://www.kba.de/DE/Statistik/Produktkatalog/produkte/Fahrzeuge/fz1_b_uebersicht.html
als XLSX-Datei. Lizenz: **Datenlizenz Deutschland – Namensnennung 2.0**
(freie Nutzung mit Quellenangabe).

## 1. Tabelle anlegen

Im **Supabase SQL Editor** ausführen:

```sql
-- ============================================================
-- KFZ-Kennzeichen Sammler – Bestand/Seltenheit Setup
-- Quelle: KBA-Statistik FZ 1 "Bestand an Kraftfahrzeugen und
-- Kraftfahrzeuganhängern nach Zulassungsbezirken"
-- Lizenz: Datenlizenz Deutschland – Namensnennung 2.0
-- ============================================================

create table if not exists kennzeichen_bestand (
  code             text primary key references bundesland_codes(code) on delete cascade,
  ars              text,                    -- 5-stelliger Amtlicher Regionalschlüssel des Zulassungsbezirks
  kreis_name       text,                    -- Name des Zulassungsbezirks laut KBA
  bestand_kreis    bigint not null,         -- Gesamt-Bestand des Zulassungsbezirks laut KBA
  code_count       integer not null,        -- Anzahl KFZ-Codes, die sich diesen Bestand teilen (aus KFZ-Feld)
  bestand_estimate bigint not null,         -- bestand_kreis / code_count, gerundet
  is_shared        boolean not null default false, -- true wenn code_count > 1 (Schätzwert)
  source_year      integer not null,        -- Jahr der KBA-Statistik (z.B. 2026)
  source_label     text default 'KBA FZ 1', -- Attribution für UI
  updated_at       timestamptz not null default now()
);

create index if not exists idx_bestand_estimate on kennzeichen_bestand(bestand_estimate);

-- Lesen ist öffentlich (Rarity-Info ist kein Nutzerdatum) — kein RLS-Login nötig für SELECT.
-- Schreiben nur über Service-Role (Import-Skript), nicht über den Client.
alter table kennzeichen_bestand enable row level security;

create policy "Bestand ist öffentlich lesbar"
  on kennzeichen_bestand for select
  using (true);

-- Bewusst KEINE insert/update/delete-Policy für 'anon' oder 'authenticated' —
-- das Import-Skript schreibt ausschließlich mit dem Service-Role-Key,
-- der RLS ohnehin umgeht. Das unterscheidet sich von sync-plates.js
-- (nutzt den anon-Key bei disabled RLS), ist hier aber sicherer: ein
-- kompromittierter Client-Key kann so keine Bestandsdaten verfälschen.

-- Optionale View für serverseitige Seltenheits-Quintile (aktuell nicht
-- zwingend genutzt, die App berechnet Tiers clientseitig, siehe unten):
create or replace view kennzeichen_bestand_ranked as
  select *, ntile(5) over (order by bestand_estimate asc) as rarity_quintile
  from kennzeichen_bestand;

grant select on kennzeichen_bestand_ranked to authenticated, anon;
```

## 2. Woher die Rohdaten kommen

1. Auf der KBA-Produktseite (Link oben) die aktuelle **FZ 1**-Datei als
   XLSX herunterladen (Dateiname meist `fz1_<jahr>.xlsx`, z.B. `fz1_2026.xlsx`).
2. Datei irgendwo lokal ablegen, z.B. direkt im App-Ordner
   `apps/kfz-kennzeichen-de-sammler/fz1_2026.xlsx` (Datei ist **nicht**
   committen — in `.gitignore` aufnehmen, falls noch nicht geschehen).

Es gibt **keinen automatischen Download**: die KBA-Seite hat keine stabile
API, und diese Sandbox-Umgebung kann kba.de aus Netzwerk-Policy-Gründen
ohnehin nicht erreichen. Der Download ist bewusst ein manueller,
einmal-im-Jahr-Schritt.

## 3. `.env` ergänzen

Zusätzlich zu den bestehenden Variablen aus `.env.example` wird ein
**Service-Role-Key** benötigt (nicht der `anon`-Key!), weil die
`kennzeichen_bestand`-Tabelle bewusst keine Schreib-Policy für Client-Keys hat:

```
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Zu finden im Supabase Dashboard unter **Settings → API → service_role**
(geheim halten, niemals im Client-Code oder committed `.env` verwenden!).

## 4. Import ausführen

```bash
cd apps/kfz-kennzeichen-de-sammler
npm install
node import-bestand.js fz1_2026.xlsx 2026
```

Empfohlen: erst mit `--dry-run` gegenprüfen, bevor wirklich geschrieben wird:

```bash
node import-bestand.js fz1_2026.xlsx 2026 --dry-run
```

Der Dry-Run zeigt dieselbe Konsolenausgabe (inkl. `unmatched`-Warnungen),
schreibt aber nichts in Supabase.

### Was das Skript inhaltlich macht

1. Liest die lokale `kreise.geojson` ein — die kennt zu jedem der 409
   deutschen Kreise bereits den amtlichen Regionalschlüssel (ARS) und
   den/die zugehörigen Kennzeichen-Code(s) (Feld `KFZ`, z.B. "AIC FDB"
   für Kreise mit mehreren gültigen Codes).
2. Liest die KBA-XLSX ein und sucht pro Zeile (ein Zulassungsbezirk) den
   passenden Kreis in der geojson — zunächst über den amtlichen Schlüssel,
   sonst über einen normalisierten Namensvergleich (KBA schreibt
   Kreisnamen z.B. als "Landkreis X" oder "X, Landkreis", die geojson nur
   als "X" — das Skript gleicht das an), sonst über eine kleine
   fest hinterlegte Liste von Sonderfällen (z.B. Region Hannover,
   Städteregion Aachen).
3. Hat ein Kreis nur **einen** Kennzeichen-Code, wird der Bestand 1:1
   übernommen. Hat er **mehrere** Codes, wird der Bestand **gleichmäßig
   durch die Anzahl Codes geteilt** und als Schätzung (`is_shared = true`)
   markiert — die KBA-Statistik unterscheidet nicht, wie viele Fahrzeuge
   welchen der mehreren gültigen Codes tatsächlich tragen.
4. Zeilen, die sich keinem Kreis zuordnen lassen, werden als Warnung
   ausgegeben (`unmatched`) statt stillschweigend ignoriert.
5. Das Ergebnis (eine Zeile pro Kennzeichen-Code) wird per Upsert
   (`onConflict: 'code'`) in `kennzeichen_bestand` geschrieben — ein
   erneuter Lauf im nächsten Jahr überschreibt die alten Werte einfach.

## 5. Turnus

Dieser Import läuft **einmal jährlich manuell**, sobald KBA die neue FZ1-
Statistik veröffentlicht (üblicherweise im Frühjahr, Stichtag ist der
1. Januar). Es gibt bewusst **keinen Cronjob**, anders als es für
`sync-plates.js` optional vorgeschlagen wird — die Quelldaten ändern sich
nur einmal pro Jahr, ein täglicher Sync wäre sinnlos.

## 6. Attribution

Da die Daten unter der Datenlizenz Deutschland – Namensnennung 2.0 stehen,
muss überall, wo Bestandszahlen in der App angezeigt werden, ein
Quellenhinweis erscheinen, z.B.:

> Bestandsdaten: Kraftfahrt-Bundesamt (KBA), FZ 1, Datenlizenz Deutschland
> – Namensnennung 2.0, Stand: {source_year}
