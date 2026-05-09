# Supabase Setup für KFZ-Kennzeichen Sammler

## 1. Tabellen anlegen

Dieses SQL im **Supabase SQL Editor** ausführen:

```sql
-- ============================================================
-- KFZ-Kennzeichen Sammler – Supabase Setup
-- ============================================================

-- 1. Kennzeichen-Plates Tabelle
create table if not exists kennzeichen_plates (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  region      text default '',
  federal_state text default '',
  federal_state_code text default '',
  created_at  timestamptz default now()
);

-- Index für schnelle Suche
create index if not exists idx_plates_code on kennzeichen_plates(code);
create index if not exists idx_plates_state on kennzeichen_plates(federal_state_code);

-- 2. User Collection Tabelle
create table if not exists user_collection (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  plate_id    bigint references kennzeichen_plates(id) on delete cascade not null,
  created_at  timestamptz default now(),
  unique(user_id, plate_id)
);

-- Index für Performance
create index if not exists idx_collection_user on user_collection(user_id);
create index if not exists idx_collection_plate on user_collection(plate_id);

-- 3. Row Level Security aktivieren
alter table kennzeichen_plates disable row level security;

alter table user_collection enable row level security;

create policy "Users können eigene Collection sehen"
  on user_collection for select
  using (auth.uid() = user_id);

create policy "Users können zu eigener Collection hinzufügen"
  on user_collection for insert
  with check (auth.uid() = user_id);

create policy "Users können aus eigener Collection entfernen"
  on user_collection for delete
  using (auth.uid() = user_id);

-- 4. Service Role kann alle lesen (für Admin-Views)
grant select on kennzeichen_plates to authenticated;
grant all on user_collection to authenticated;
```

## 2. Daten mit sync-plates.js laden

### Voraussetzungen
- Node.js 14+
- npm oder yarn

### Installation

```bash
cd apps/kfz-kennzeichen-de-sammler
npm install @supabase/supabase-js dotenv node-fetch
```

### .env Datei erstellen

Kopiere `.env.example` und fülle die Werte ein:

```bash
cp .env.example .env
```

Dann in `.env`:
```
SUPABASE_URL=https://xtbnrrhzhcvcetsdsfao.supabase.co
SUPABASE_ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Diese Werte findest du im Supabase Dashboard:
- **Settings** → **API** → **Project URL** (SUPABASE_URL)
- **Settings** → **API** → **anon public** (SUPABASE_ANON)

### Daten synchen

```bash
node sync-plates.js
```

Output:
```
📥 Downloading CSV from GitHub...
⚙️ Parsing CSV...

🔄 Syncing 620 plates to Supabase...
  → 620 new plates to insert
  → 0 plates already exist
  ✓ Inserted batch 1 / 7
  ✓ Inserted batch 2 / 7
  ...
✅ Successfully synced 620 new plates
```

## 3. App verwenden

Nach dem Sync sind alle Kennzeichen in der App verfügbar!

## Regelmäßig Updates?

Für automatische Updates könntest du einen **Cron-Job** einrichten:

```bash
# täglich um 3 Uhr nachts synchen
0 3 * * * cd /path/to/kfz-kennzeichen-de-sammler && node sync-plates.js
```

Oder GitHub Actions für automatische Syncs nutzen.
