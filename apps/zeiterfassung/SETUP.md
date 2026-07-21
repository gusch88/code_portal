# Supabase Setup für Zeiterfassung

## 1. Tabellen anlegen

Dieses SQL im **Supabase SQL Editor** ausführen (gleiches Projekt wie Portal und die anderen Apps):

```sql
-- ============================================================
-- Zeiterfassung – Supabase Setup
-- ============================================================

-- 1. Arbeits-Sessions
create table if not exists time_sessions (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  work_date   date not null,
  start_time  timestamptz not null,
  end_time    timestamptz,
  note        text default '',
  created_at  timestamptz default now()
);

create index if not exists idx_sessions_user_date on time_sessions(user_id, work_date);

-- Optional (empfohlen): verhindert zwei parallel laufende Sessions je Nutzer
create unique index if not exists uniq_running_session_per_user
  on time_sessions(user_id) where end_time is null;

-- 2. Pausen (an eine Session gebunden)
create table if not exists time_pauses (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  session_id  bigint references time_sessions(id) on delete cascade not null,
  start_time  timestamptz not null,
  end_time    timestamptz,
  note        text default '',
  created_at  timestamptz default now()
);

create index if not exists idx_pauses_user_session on time_pauses(user_id, session_id);

-- 3. Einstellungen pro Nutzer (wöchentliche Soll-Stunden, optionaler Arbeitsort)
create table if not exists time_settings (
  user_id              uuid references auth.users(id) on delete cascade primary key,
  weekly_target_hours  numeric(5,2) not null default 40,
  work_lat             numeric(9,6),
  work_lon             numeric(9,6),
  work_radius_m        integer not null default 150,
  updated_at           timestamptz default now()
);

-- Migration für bereits bestehende Installationen (falls time_settings schon existiert):
-- alter table time_settings add column if not exists work_lat numeric(9,6);
-- alter table time_settings add column if not exists work_lon numeric(9,6);
-- alter table time_settings add column if not exists work_radius_m integer not null default 150;

-- 4. Abwesenheiten (Krank / Urlaub) — zählen nicht als Arbeitstag
create table if not exists time_absences (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  date        date not null,
  type        text not null check (type in ('krank', 'urlaub')),
  note        text default '',
  created_at  timestamptz default now(),
  unique(user_id, date)
);

create index if not exists idx_absences_user_date on time_absences(user_id, date);

-- 5. Row Level Security aktivieren
alter table time_sessions enable row level security;
alter table time_pauses   enable row level security;
alter table time_settings enable row level security;
alter table time_absences enable row level security;

create policy "Users können eigene Sessions sehen"
  on time_sessions for select using (auth.uid() = user_id);
create policy "Users können eigene Sessions anlegen"
  on time_sessions for insert with check (auth.uid() = user_id);
create policy "Users können eigene Sessions bearbeiten"
  on time_sessions for update using (auth.uid() = user_id);
create policy "Users können eigene Sessions löschen"
  on time_sessions for delete using (auth.uid() = user_id);

create policy "Users können eigene Pausen sehen"
  on time_pauses for select using (auth.uid() = user_id);
create policy "Users können eigene Pausen anlegen"
  on time_pauses for insert with check (auth.uid() = user_id);
create policy "Users können eigene Pausen bearbeiten"
  on time_pauses for update using (auth.uid() = user_id);
create policy "Users können eigene Pausen löschen"
  on time_pauses for delete using (auth.uid() = user_id);

create policy "Users können eigene Settings sehen"
  on time_settings for select using (auth.uid() = user_id);
create policy "Users können eigene Settings anlegen"
  on time_settings for insert with check (auth.uid() = user_id);
create policy "Users können eigene Settings bearbeiten"
  on time_settings for update using (auth.uid() = user_id);

create policy "Users können eigene Abwesenheiten sehen"
  on time_absences for select using (auth.uid() = user_id);
create policy "Users können eigene Abwesenheiten anlegen"
  on time_absences for insert with check (auth.uid() = user_id);
create policy "Users können eigene Abwesenheiten bearbeiten"
  on time_absences for update using (auth.uid() = user_id);
create policy "Users können eigene Abwesenheiten löschen"
  on time_absences for delete using (auth.uid() = user_id);
```

## 2. App verwenden

Kein separates Sync-Skript nötig — alle Daten werden direkt über die App-Oberfläche erfasst (Timer, manuelle Einträge). Die wöchentliche Soll-Stundenzahl ist standardmäßig **40h** und kann im Tab „Einstellungen“ jederzeit angepasst werden.

In der Tagesansicht (Übersicht → Tag) kann ein Tag als **Krank** oder **Urlaub** markiert werden. Für solche Tage wird die Soll-Zeit auf 0 gesetzt — sie zählen also nicht als Arbeitstag und erzeugen keine negative Differenz im Überstundenkonto.

## Bekannte Einschränkungen (v1)

- **Kein Offline-Modus.** Die App braucht eine aktive Verbindung zu Supabase; anders als die KFZ-Kennzeichen-App gibt es keine Offline-Warteschlange.
- **Sessions über Mitternacht** zählen komplett auf den Kalendertag, an dem sie gestartet wurden — keine Aufteilung auf zwei Tage.
- **Rückwirkende Soll-Änderung:** Wird die wöchentliche Soll-Stundenzahl geändert, wirkt sich das auf alle historischen Tage aus (kein Snapshot pro Tag). Für ein persönliches Tool ist das beabsichtigt.
- **Automatischer Start per Standort** (Geofencing): Im Tab „Einstellungen" kann der aktuelle Standort als Arbeitsort gespeichert werden (mit Radius in Metern). Solange der Timer-Tab offen ist, prüft die App in Abständen den Standort und schlägt vor, den Timer zu starten (Ankunft im Radius) bzw. zu stoppen (Verlassen des Radius). Echtes Hintergrund-Geofencing (auch bei geschlossener App) ist im Browser/PWA-Kontext nicht zuverlässig möglich.
