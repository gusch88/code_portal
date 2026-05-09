-- ============================================================
--  MEL Portal – Supabase Setup
--  Dieses SQL einmal im Supabase SQL Editor ausführen
-- ============================================================

-- 1. Kennzeichen-Tabelle für MEL Jäger
create table if not exists mel_kennzeichen (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  num         integer not null,
  brand       text default '–',
  model       text default '–',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Unique: pro User kann jede Nummer nur einmal vorkommen
alter table mel_kennzeichen
  add constraint mel_kennzeichen_user_num_unique unique (user_id, num);

-- 2. Row Level Security aktivieren
alter table mel_kennzeichen enable row level security;

-- Jeder User sieht nur seine eigenen Einträge
create policy "Eigene Kennzeichen lesen"
  on mel_kennzeichen for select
  using (auth.uid() = user_id);

create policy "Eigene Kennzeichen einfügen"
  on mel_kennzeichen for insert
  with check (auth.uid() = user_id);

create policy "Eigene Kennzeichen aktualisieren"
  on mel_kennzeichen for update
  using (auth.uid() = user_id);

create policy "Eigene Kennzeichen löschen"
  on mel_kennzeichen for delete
  using (auth.uid() = user_id);

-- 3. Optional: Profile-Tabelle (für Anzeigenamen etc.)
create table if not exists profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  username    text,
  created_at  timestamptz default now()
);

alter table profiles enable row level security;

create policy "Eigenes Profil lesen"
  on profiles for select
  using (auth.uid() = id);

create policy "Eigenes Profil bearbeiten"
  on profiles for update
  using (auth.uid() = id);

-- Automatisch Profil anlegen wenn sich jemand registriert
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
