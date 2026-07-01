# Rezeptkasten – Projektübersicht

> Handover-Dokument, damit man in einem neuen Chat sofort weiterarbeiten kann, ohne den ganzen Kontext neu aufzubauen. Stand: 2026-06-16.

---

## 1. Was ist das?

Eine selbst gehostete Rezept-Sammlung aus **zwei Teilen**:

1. **Öffentliche Web-App** – statisch, läuft auf GitHub Pages, jeder mit dem Link kann sie nutzen.
2. **Privates „Rezept-Studio"** – ein lokales Werkzeug auf dem Mac, mit dem neue Rezepte per Foto eingepflegt und bestehende bearbeitet/gelöscht werden.

**Designprinzip:** Die App ist bewusst „dumm" und statisch (kein Backend, keine laufenden Kosten). Sie liest nur eine Datei: `recipes.json`. Die ganze Intelligenz (Foto auslesen, committen, pushen) steckt im lokalen Studio. Der Anthropic-API-Key bleibt komplett beim Nutzer.

- **Live-URL:** https://darthyeti.github.io/rezeptkasten/
- **GitHub-Remote:** https://github.com/darthyeti/rezeptkasten.git (`origin`, Branch `main`)

---

## 2. Wo liegt was? (Pfade)

| Was | Pfad |
|-----|------|
| **Live-Repo (hier wird gearbeitet!)** | `/Users/techterhof/Documents/GitHub/rezeptkasten` |
| Claude-Arbeitsordner dieser Sessions | `/Users/techterhof/Desktop/Claude/rezepte` (NICHT das Repo; enthält Rezeptfotos + alte Kopien/ZIPs + diese CLAUDE.md). Wird beim Session-Start hier automatisch in den Kontext geladen. |
| Studio-Konfig inkl. API-Key (außerhalb Repo!) | `~/.config/rezeptkasten/studio.json` |
| Originalfotos der ersten Rezepte | `/Users/techterhof/Desktop/Claude/rezepte/*.jpeg` |

> ⚠️ Achtung Schreibweise: Es ist `Documents/GitHub` (englisch, großes GitHub) – nicht „Dokumente/Github".

---

## 3. Dateistruktur des Repos

```
rezeptkasten/
├── index.html                  # die komplette öffentliche App (HTML+CSS+JS in einer Datei)
├── recipes.json                # Quelle der Wahrheit: alle Rezepte (Array)
├── img/recipe.png              # Platzhalterbild für schema.org/Bring
├── r/<id>/index.html           # generierte statische Rezeptseiten (für Bring!-Import)
├── scripts/
│   ├── studio.mjs              # das lokale Rezept-Studio (Node-Server)
│   └── build-bring-pages.mjs   # erzeugt r/<id>/ neu aus recipes.json
├── studio.command              # Doppelklick-Starter: ruft `node scripts/studio.mjs`
├── README.md                   # Nutzer-/Setup-Doku (ausführlich, Bring-Troubleshooting)
└── .gitignore                  # .studio.json, .DS_Store
```

---

## 4. Datenmodell: `recipes.json`

Ein JSON-Array. Jedes Rezept:

```jsonc
{
  "id": "kichererbsen-gnocchi",   // slug, stabil; wird NIE geändert (Links/Bring hängen daran)
  "title": "Kichererbsen-Gnocchi One Pot",
  "category": "Hauptgericht",      // "Hauptgericht"|"Suppe"|"Salat"|"Dessert"|"Sonstiges"
  "tags": ["One-Pot"],             // optional; fehlt, wenn leer
  "time": 35,                       // aktive Zeit in Minuten
  "wait": 0,                        // Wartezeit (Backen/Ziehen) in Minuten
  "portions": 4,
  "kcal": 236,                      // pro Person, oder null
  "veg": "vegetarisch",            // "vegan"|"vegetarisch"|null
  "source": "philippsteuer.de",
  "notes": "Eigene Anpassungen …", // optional
  "ingredients": [ { "a": "250 g", "n": "Gnocchi" }, … ],  // a = Menge, n = Name
  "steps": [ "Schritt 1 …", "Schritt 2 …" ]
}
```

**Wichtig:**
- `id` ist der stabile Slug. Beim Bearbeitens-Editor bleibt sie erhalten → bestehende Links und Bring-Seiten brechen nicht.
- Mengen in `a` sollten für die Einkaufslisten-Summierung das Format `Zahl Einheit` haben (`g`, `kg`, `ml`, `l`, `EL`, `TL`), z. B. `250 g`. Nur dann werden gleiche Zutaten automatisch zusammengerechnet; sonst werden sie mit `+` aneinandergehängt.
- **Tag-Konvention (seit Juni 2026 vereinheitlicht):** `tags` sind ausschließlich **beschreibende** Etiketten (z. B. `One-Pot`, `Backofen`, `Pasta`, `Bowl`, `Einfach`) und beginnen **groß**. NICHT als Tag verwenden: `vegan`/`vegetarisch` (gehört ins Feld `veg`) und `schnell` (ergibt sich aus dem „≤ 30 Min"-Filter). Der Studio-Extraktionsprompt setzt das durch.
- `recipes.json` wird **ohne** abschließenden Zeilenumbruch geschrieben (so wie das Studio via `JSON.stringify(catalog, null, 2)`). Bei manuellen Bearbeitungen kein Trailing-Newline anhängen, sonst entsteht unnötiger Diff.

---

## 5. Die öffentliche App (`index.html`)

Single-File-App, Vanilla JS, kein Build. Lädt beim Start `recipes.json` (`cache: no-store`).

**Drei Tabs:**
- **Rezepte:** Zutatensuche (Tokens eintippen → Rezepte nach Trefferzahl sortiert, passende Zutaten in der Detailansicht grün markiert). Filter: Kategorie, dynamische Tag-Pills, „vegetarisch", „≤ 30 Min" (Summe aus time+wait). Kategorie-Pills sind farblich (Terrakotta, eigene Zeile) von den goldenen Tag-Pills abgesetzt. Tag-Filter erlaubt **Mehrfachauswahl** (UND-Logik: Rezept muss alle gewählten Tags haben); State in `tagFilters` (Array).
- **Wochenplan:** Gerichte den 7 Wochentagen zuordnen.
- **Einkaufsliste:** wird automatisch aus dem Wochenplan zusammengeführt (gleiche Zutaten summiert), abhakbar, kopierbar, teilbar (Web-Share).

**Detailansicht** pro Rezept: Zutaten, Schritte, Notizen, „Zum Wochenplan", „Zutaten an Bring! senden" (Deeplink), „Rezeptseite prüfen", „Rezept entfernen".

**localStorage-Keys** (alles nur pro Browser/Gerät, NICHT im Repo):
| Key | Inhalt |
|-----|--------|
| `rk-deleted` | ausgeblendete Katalog-Rezept-IDs |
| `rk-plan` | Wochenplan `{ Montag:[ids], … }` |
| `rk-checked` | abgehakte Einkaufsposten |

**Wochenplan-Sync per Code** (Juni 2026 ergänzt, **Einstellungen**): Der In-App-Foto-Import wurde entfernt (siehe Historie unten). Stattdessen enthalten die Einstellungen jetzt die geräteübergreifende Übertragung von Wochenplan und Einkaufsliste. „Plan-Code erzeugen" kodiert `rk-plan` + `rk-checked` gemeinsam in einen kopierbaren Text (`RKPLAN1:` + Base64 des UTF-8-JSON) und legt ihn zusätzlich in die Zwischenablage. Auf dem Zielgerät fügt man den Code ein → „Plan importieren" → Bestätigung → **ersetzt** den dortigen Plan und die abgehakten Posten vollständig (kein Merge). Der Präfix `RKPLAN1:` erlaubt sauberes Abweisen von Fremdtext; Fehlerfälle (fehlender Präfix, kaputtes Base64, falsches Format) werden im Dialog gemeldet, nicht importiert.

> **Historie – entfernt (Juni 2026):** Früher gab es einen In-App-Foto-Import (FAB „+ Rezept fotografieren", direkter `api.anthropic.com`-Aufruf aus dem Browser, Key in `rk-key`, Ergebnis in `rk-custom`) plus Katalog-Export/-Import in den Einstellungen. Das wurde bewusst ausgebaut: Rezepte werden **ausschließlich über das Studio** (Abschnitt 6) gepflegt. Damit entfielen `rk-key` und `rk-custom` samt zugehöriger Logik (`all()` liest nur noch den Katalog). Falls auf einem Gerät noch alte `rk-custom`-Einträge im localStorage liegen, werden sie ignoriert (nicht mehr angezeigt).

---

## 6. Das Rezept-Studio (`scripts/studio.mjs`)

Lokaler Node-Server (Single-File, eingebettetes HTML). Start:

```bash
cd ~/Documents/GitHub/rezeptkasten
node scripts/studio.mjs          # oder Doppelklick auf studio.command
# → http://localhost:8787   (nur lokal, 127.0.0.1)
```

Port überschreibbar via `STUDIO_PORT=8799 node scripts/studio.mjs`.

**Konfiguration** liegt außerhalb des Repos in `~/.config/rezeptkasten/studio.json` (Felder: `apiKey`, `baseUrl`). Beim ersten Start im UI eintragen. Alter Ort `.studio.json` im Repo wird einmalig automatisch dorthin migriert.

**Funktionen:**
- **Neue Rezepte:** Fotos reinziehen → Claude (`claude-sonnet-4-6`) extrahiert → editierbare Karten → ein Klick: `recipes.json` aktualisieren, Bring-Seiten neu bauen, `git add/commit/push`. Erkennt handschriftliche Korrekturen und setzt `One-Pot`-Tag automatisch.
- **Bestehende Rezepte bearbeiten** (Juni 2026 ergänzt): Panel „Vorhandenes Rezept bearbeiten" → Rezept im Dropdown wählen → „Bearbeiten" lädt es ins gleiche Formular → beim Push wird es per `id` an Ort und Stelle ersetzt (id/Adresse bleibt).
- **Löschen:** „Aus Sammlung löschen" auf der Bearbeiten-Karte (mit Bestätigung) → entfernt Rezept inkl. seiner Bring-Seite beim Push.
- Neue Fotos + Bearbeitungen + Löschungen können in einem Push gemischt werden.

**HTTP-Endpoints (intern):**
| Methode/Pfad | Zweck |
|---|---|
| `GET /` | das Studio-UI |
| `GET /api/status` | hasKey / baseUrl / gitOk |
| `GET /api/recipes` | kompletter Katalog (fürs Bearbeiten-Dropdown) |
| `POST /api/config` | apiKey + baseUrl speichern |
| `POST /api/extract` | Foto → Rezept-JSON via Claude |
| `POST /api/save` | `{ recipes:[…], deletes:[ids] }` → Upsert + Delete, build, commit, push |

**Kernfunktion `saveAndPush(incoming, deletes, baseUrl)`:** Rezepte ohne `id` = neu (Slug wird erzeugt, Kollisionen mit `-2`, `-3` …); Rezepte mit vorhandener `id` = ersetzen; `deletes` = entfernen. Commit-Message fasst zusammen (z. B. „Rezepte aktualisiert: … | gelöscht: …").

---

## 7. Bring!-Integration & `build-bring-pages.mjs`

Bring importiert über einen Deeplink, der eine **öffentliche** Rezept-URL mit schema.org/Recipe-JSON-LD ausliest. Diese Seiten erzeugt:

```bash
node scripts/build-bring-pages.mjs https://darthyeti.github.io/rezeptkasten/
```

Das Skript macht `rmSync("r")` und baut den Ordner `r/` komplett neu aus `recipes.json` → Edits und Löschungen werden automatisch sauber übernommen. **Basis-URL ist Pflicht**, sonst fehlen absolute `url`/`image`-Felder und Bring scheitert. Das Studio ruft das Skript beim Push automatisch mit der konfigurierten `baseUrl` auf.

Konsequenzen / Troubleshooting (Details in README.md):
- Bring funktioniert nur über die öffentliche Pages-URL, nicht lokal (die App blendet den Knopf lokal aus).
- Pro Rezept; für die gesammelte Wochenliste: Liste kopieren und in Bring über Mehrfacheingabe (Komma-getrennt) einfügen.
- Bei „could not detect recipe": Pages-URL? Existiert `…/r/<id>/`? Skript mit Basis-URL gelaufen? `r/` committet?

---

## 8. Typische Workflows

**Neues Rezept hinzufügen (Hauptweg):**
1. Studio starten → Foto(s) reinziehen → Felder prüfen → „Speichern & zu GitHub pushen". ~1–2 Min später live.

**Bestehendes Rezept ändern:**
1. Studio → „Vorhandenes Rezept bearbeiten" → wählen → „Bearbeiten" → anpassen → pushen.

**Rezept löschen:**
1. Studio → Rezept laden → „Aus Sammlung löschen" → pushen.

**Manuell editieren (ohne Studio):**
1. `recipes.json` direkt bearbeiten → `node scripts/build-bring-pages.mjs <baseUrl>` → `git add -A && git commit && git push`.

---

## 9. Sicherheit / Secrets

- API-Key **niemals** ins Repo. Liegt ausschließlich im Studio unter `~/.config/rezeptkasten/studio.json`. `.studio.json` und `.DS_Store` sind in `.gitignore`. (Die öffentliche App verarbeitet seit Juni 2026 keinen API-Key mehr, siehe Abschnitt 5.)
- Historie: Ein API-Key war einmal versehentlich committet und wurde von GitHubs Push-Protection abgefangen → Key gelöscht/neu erstellt, Repo sauber neu aufgesetzt, Konfig strukturell ausgelagert.
- Für Studio-Pushes ohne Login-Abfrage: Personal Access Token (PAT) im macOS-Schlüsselbund.

---

## 10. Offene Punkte / mögliche nächste Schritte

- **PAT-Ablauf** im Blick behalten (läuft je nach Laufzeit ab → einmal neu erstellen).
- **Ausgabenlimit** für den API-Key in der Anthropic-Konsole als Sicherheitsnetz (empfohlen, optional).
- ~~**Geräteübergreifende Sync** des Wochenplans/abgehakter Posten: aktuell nur pro Browser (localStorage).~~ ✅ Erledigt (Juni 2026): Export/Import per kopierbarem Code in den Einstellungen (ersetzt, kein Merge). Siehe Abschnitt 5. Bewusst kein Backend, kein Live-Sync – Übertragung ist manuell und einseitig (Quelle → Ziel).
- ~~**Konventions-Aufräumen:** „vegan"/„schnell" als Tag.~~ ✅ Erledigt (Juni 2026): redundante Tags entfernt, `einfach`→`Einfach`, Studio-Prompt gehärtet. Siehe Tag-Konvention in Abschnitt 4.

---

## 11. Technische Eckdaten

- **Stack:** statisches HTML/CSS/Vanilla-JS (App) + Node 18+ (Studio/Build, ESM `.mjs`). Keine Dependencies, kein Build-Tool.
- **Node liegt** unter `/usr/local/bin/node` (nicht immer im PATH nicht-interaktiver Shells – ggf. absoluten Pfad nutzen).
- **Claude-Modell** für Extraktion: `claude-sonnet-4-6` (App und Studio).
- **Deployment:** GitHub Pages, Settings → Pages → Branch `main`, Ordner `/ (root)`.
- **Lokal testen:** nicht per Doppelklick (dann lädt `recipes.json` nicht), sondern `npx serve` oder `python3 -m http.server`.
