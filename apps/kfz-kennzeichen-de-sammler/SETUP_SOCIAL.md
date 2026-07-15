# Supabase Setup für Freunde & Bestenliste

Dieses SQL einmal, in der angegebenen Reihenfolge, im **Supabase SQL Editor** ausführen.

Die Reihenfolge ist wichtig: Schritt 1 (Profile bereinigen) muss **vor** Schritt 2
(Profile-Leserechte öffnen) laufen, sonst sind für einen kurzen Moment noch
E-Mail-Adressen als Klarname für alle sichtbar.

⚠️ `profiles` ist projektweit geteilt (auch von `mel-jaeger` und `zeiterfassung`
genutzt) — die Änderungen an `handle_new_user()` und der Profiles-Policy wirken
sich auf das ganze Portal aus (gewollt: eine gemeinsame Identität).

```sql
-- ============================================================
-- KFZ-Kennzeichen Sammler – Freunde & Rangliste: Supabase Setup
-- ============================================================

-- 1. Bestehende Profile, deren Name noch die E-Mail-Adresse ist,
--    einmalig anonymisieren (WICHTIG: vor Schritt 2 ausführen!)
update profiles
  set username = 'Spieler-' || substr(replace(id::text, '-', ''), 1, 8)
  where username like '%@%' or username is null;

-- Verifikation: muss 0 zurückgeben
-- select count(*) from profiles where username like '%@%';

-- 2. Neue Nutzer nicht mehr standardmäßig mit E-Mail als Namen anlegen
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'Spieler-' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end;
$$ language plpgsql security definer;
-- Der bestehende Trigger on_auth_user_created nutzt automatisch diese neue Funktion.

-- 3. Validierung: keine E-Mail-artigen oder zu kurzen/langen Namen
alter table profiles
  add constraint profiles_username_format check (username !~ '@' and char_length(username) between 3 and 24);

-- 4. Eindeutigkeit (case-insensitive) für Suche/Anzeige
create unique index if not exists idx_profiles_username_lower on profiles (lower(username));

-- 5. Profile für alle angemeldeten Nutzer lesbar machen (Freundessuche + Rangliste)
--    Ergänzt die bestehende "Eigenes Profil lesen"-Policy (Policies werden per OR kombiniert)
create policy "Alle Profile lesen (Freunde und Rangliste)"
  on profiles for select
  to authenticated
  using (true);

-- 6. Freundschaften / Freundschaftsanfragen
create table if not exists friendships (
  id            bigint generated always as identity primary key,
  requester_id  uuid references auth.users(id) on delete cascade not null,
  addressee_id  uuid references auth.users(id) on delete cascade not null,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  constraint friendships_no_self check (requester_id <> addressee_id)
);

-- Verhindert Duplikate in beide Richtungen (A→B und B→A gleichzeitig)
create unique index if not exists idx_friendships_unique_pair
  on friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists idx_friendships_requester on friendships(requester_id);
create index if not exists idx_friendships_addressee on friendships(addressee_id);

alter table friendships enable row level security;

create policy "Eigene Freundschaften lesen"
  on friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Anfrage senden"
  on friendships for insert
  with check (auth.uid() = requester_id);

create policy "Anfrage annehmen"
  on friendships for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (status = 'accepted');

create policy "Anfrage ablehnen, zurückziehen oder entfreunden"
  on friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

grant select, insert, update, delete on friendships to authenticated;
grant usage, select on sequence friendships_id_seq to authenticated;

-- 7. Freunde dürfen die Kennzeichen-Einträge des jeweils anderen sehen (nur SELECT, nur bei
--    akzeptierter Freundschaft). Insert/Update/Delete bleiben ausschließlich beim Eigentümer.
--    Dies ist eine ZUSÄTZLICHE Policy neben der bestehenden Eigentümer-Policy auf "kennzeichen".
create policy "Freunde können Kennzeichen sehen"
  on kennzeichen for select
  using (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = kennzeichen.user_id)
          or
          (f.addressee_id = auth.uid() and f.requester_id = kennzeichen.user_id)
        )
    )
  );

-- 8. Test-Accounts-Markierung (damit man lokale Testuser nie wieder löschen muss)
alter table profiles add column if not exists is_test boolean not null default false;

-- 9. Aggregierte Bestenliste – gibt NUR Zähldaten zurück, keine einzelnen Kennzeichen-Zeilen
--    Test-Accounts (is_test = true) werden ausgeschlossen, damit die Bestenliste sauber bleibt.
create or replace function get_kennzeichen_leaderboard()
returns table (
  user_id        uuid,
  username       text,
  total_count    bigint,
  distinct_codes bigint
)
language sql
security definer
set search_path = public
as $$
  select
    k.user_id,
    coalesce(p.username, 'Unbekannt') as username,
    count(*)::bigint as total_count,
    count(distinct k.code)::bigint as distinct_codes
  from kennzeichen k
  left join profiles p on p.id = k.user_id
  where coalesce(p.is_test, false) = false
  group by k.user_id, p.username
  order by total_count desc;
$$;

revoke all on function get_kennzeichen_leaderboard() from public;
grant execute on function get_kennzeichen_leaderboard() to authenticated;
```

## Danach prüfen

```sql
select count(*) from profiles where username like '%@%'; -- muss 0 sein
select * from get_kennzeichen_leaderboard() limit 5;
```

## Update: Test-Accounts dauerhaft ausblenden

Falls das SQL oben schon mal ausgeführt wurde (also Schritte 1–7 bereits existieren),
reicht dieser Nachtrag — er ist idempotent und kann gefahrlos erneut laufen:

```sql
-- Spalte anlegen (falls noch nicht vorhanden)
alter table profiles add column if not exists is_test boolean not null default false;

-- Bestenliste-Funktion so ersetzen, dass Test-Accounts ausgeschlossen werden
create or replace function get_kennzeichen_leaderboard()
returns table (
  user_id        uuid,
  username       text,
  total_count    bigint,
  distinct_codes bigint
)
language sql
security definer
set search_path = public
as $$
  select
    k.user_id,
    coalesce(p.username, 'Unbekannt') as username,
    count(*)::bigint as total_count,
    count(distinct k.code)::bigint as distinct_codes
  from kennzeichen k
  left join profiles p on p.id = k.user_id
  where coalesce(p.is_test, false) = false
  group by k.user_id, p.username
  order by total_count desc;
$$;

revoke all on function get_kennzeichen_leaderboard() from public;
grant execute on function get_kennzeichen_leaderboard() to authenticated;

-- Eigene Test-Accounts markieren (E-Mails anpassen!)
update profiles set is_test = true where id in (
  select id from auth.users where email in ('test1@example.com', 'test2@example.com')
);
```

**Verhalten danach:**
- Als `is_test = true` markierte Accounts tauchen in der globalen Bestenliste für **niemanden** mehr auf.
- In der Freunde-Suche sind sie für normale (nicht-Test-) Accounts unsichtbar, aber Test-Accounts
  können sich weiterhin gegenseitig finden — so lässt sich die Such-/Anfrage-Funktion beliebig oft
  zwischen den beiden Testusern durchspielen, ohne dass echte Nutzer sie je zu sehen bekommen.
- Löschen ist damit nicht mehr nötig; die Accounts können dauerhaft für lokale Tests bestehen bleiben.

```sql
-- Verifikation: sollten NICHT mehr in der Bestenliste auftauchen
select * from get_kennzeichen_leaderboard();
```
