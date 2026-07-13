# MEL Portal – Deployment Guide

## Projektstruktur

```
mel-portal/
├── index.html                  ← Portalseite (Login + App-Übersicht)
├── SUPABASE_SETUP.sql          ← SQL einmal in Supabase ausführen
├── shared/
│   └── supabase.js             ← Referenz-Config (nicht direkt eingebunden)
└── apps/
    └── mel-jaeger/
        └── index.html          ← MEL Jäger App
```

---

## Schritt 1 – Supabase einrichten

1. Gehe zu https://supabase.com und öffne dein Projekt
2. Klicke links auf **SQL Editor**
3. Kopiere den gesamten Inhalt von `SUPABASE_SETUP.sql` und führe ihn aus
4. Gehe zu **Settings → API**
5. Kopiere:
   - **Project URL** → das ist deine `SUPABASE_URL`
   - **anon / public** Key → das ist dein `SUPABASE_ANON`

---

## Schritt 2 – API Keys eintragen

In **beiden** HTML-Dateien diese zwei Zeilen suchen und ersetzen:

```js
const SUPABASE_URL  = 'DEINE_SUPABASE_URL';
const SUPABASE_ANON = 'DEIN_ANON_PUBLIC_KEY';
```

Die Dateien sind:
- `index.html` (Portalseite)
- `apps/mel-jaeger/index.html` (MEL Jäger)

---

## Schritt 3 – GitHub Repository

1. Erstelle ein neues Repository auf https://github.com (z.B. `gapps`)
2. Lade alle Dateien hoch (Upload via Web-Interface oder Git)

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN-USERNAME/gapps.git
git push -u origin main
```

---

## Schritt 4 – Deployment

### Netlify Deployment

1. Gehe zu https://netlify.com und logge dich ein
2. Klicke **Add new site → Import from Git**
3. Verbinde dein GitHub-Konto und wähle das Repository
4. Build-Einstellungen:
   - **Build command**: leer lassen
   - **Publish directory**: `.` (Punkt = Root)
5. Klicke **Deploy site**

Netlify gibt dir eine URL wie `https://gapps-abc123.netlify.app`

Optional: Eigene Domain unter **Domain settings** eintragen.

### Vercel Deployment

1. Gehe zu https://vercel.com und logge dich ein
2. Klicke **New Project**
3. Verbinde dein GitHub-Konto und wähle das Repository
4. Bei den Einstellungen:
   - **Framework Preset**: `Other`
   - **Build Command**: leer lassen
   - **Output Directory**: leer lassen
5. Klicke **Deploy**

Vercel gibt dir eine URL wie `https://dein-projekt.vercel.app`

Optional: Eigene Domain unter **Settings → Domains** eintragen.

---

## Supabase Auth konfigurieren

In Supabase unter **Authentication → URL Configuration**:
- **Site URL**: deine Netlify-URL eintragen (z.B. `https://gapps-abc123.netlify.app`)
- **Redirect URLs**: dieselbe URL hinzufügen

---

## Neue App hinzufügen

1. Neuen Ordner unter `apps/` anlegen (z.B. `apps/meine-app/`)
2. `index.html` der neuen App dort ablegen
3. In `index.html` (Portal) eine neue Karte im App-Grid ergänzen:

```html
<a class="app-card" href="apps/meine-app/index.html">
  <div class="app-card-thumb" style="background: linear-gradient(135deg, #0f1520 0%, #151e2e 100%);">⏱️</div>
  <div class="app-card-body">
    <div class="app-card-name">Meine App</div>
    <div class="app-card-desc">Deine Beschreibung hier.</div>
    <div class="app-card-tag">Kategorie</div>
  </div>
</a>
```

Beispiel: `apps/zeiterfassung/` (siehe eigene `SETUP.md` in diesem Ordner für das Datenbank-Setup).

4. Git commit + push → Netlify deployt automatisch
