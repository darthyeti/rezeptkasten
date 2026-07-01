# Rezeptkasten

Ein schlanker, statischer Rezeptkatalog für GitHub Pages. Kein Backend, kein Build-Tool, eine HTML-Datei plus eine JSON-Datei.

## Funktionen

- **Zutatensuche:** Zutaten eintippen ("Zucchini", "Sahne", …), Rezepte werden nach Trefferzahl sortiert, passende Zutaten in der Detailansicht markiert.
- **Filter:** Kategorie, vegetarisch, schnelle Gerichte unter 30 Minuten.
- **Wochenplan:** Gerichte den Wochentagen zuordnen (lokal im Browser gespeichert).
- **Einkaufsliste:** Wird automatisch aus dem Wochenplan zusammengeführt (gleiche Zutaten werden summiert), abhakbar, per Knopf kopierbar oder über das Teilen-Menü des Handys weitergebbar.
- **Bring!-Export:** Pro Rezept ein Knopf "Zutaten an Bring! senden". Bring liest dafür die statischen Rezeptseiten unter `r/<id>/` aus (schema.org-Format).
- **Wochenplan-Sync per Code:** Wochenplan und Einkaufsliste liegen pro Browser. Über die Einstellungen erzeugst du einen kopierbaren Code und spielst ihn auf einem anderen Gerät ein. Der Import ersetzt den dortigen Plan vollständig (kein Zusammenführen).

## Deployment auf GitHub Pages

1. Neues Repository anlegen und diese Dateien pushen.
2. Im Repo: **Settings → Pages → Source: Deploy from a branch**, Branch `main`, Ordner `/ (root)`.
3. Nach ein bis zwei Minuten läuft die App unter `https://<dein-name>.github.io/<repo>/`.

Lokal testen: nicht per Doppelklick öffnen (dann kann `recipes.json` nicht geladen werden), sondern z. B. mit

```bash
npx serve
# oder
python3 -m http.server
```

## Rezepte pflegen

Die Quelle der Wahrheit ist `recipes.json` im Repo. Es gibt zwei Wege, Rezepte zu pflegen:

1. **Über das Rezept-Studio (empfohlen):** Lokales Werkzeug am Mac. Fotos reinziehen, Claude extrahiert die Rezepte, prüfen, und ein Klick aktualisiert `recipes.json`, baut die Bring-Seiten neu und pusht. Details unten im Abschnitt "Rezept-Studio".
2. **Direkt in `recipes.json` editieren** (Schema siehe vorhandene Einträge). Danach die Bring-Seiten neu bauen (siehe unten) und committen.

> Hinweis: Der frühere Foto-Import direkt in der öffentlichen App wurde entfernt. Rezepte werden nur noch über das Studio oder von Hand gepflegt. Die Einstellungen der App enthalten jetzt stattdessen die Wochenplan-Sync (siehe unten).

Nach jeder Änderung an `recipes.json` einmal ausführen und mitcommitten (mit deiner echten Pages-Adresse!):

```bash
node scripts/build-bring-pages.mjs https://DEINNAME.github.io/REPO/
```

Das erzeugt die statischen Seiten im Ordner `r/`, die Bring! für den Import braucht. Die Basis-URL ist wichtig, damit absolute `url`- und `image`-Felder im schema.org-Markup stehen.

## Bring!-Integration: wie sie funktioniert

Bring! importiert Rezepte über einen Deeplink: die App ruft eine öffentliche Rezept-URL ab und liest die dort hinterlegten schema.org-Rezeptdaten (JSON-LD) aus. Genau solche Seiten erzeugt `scripts/build-bring-pages.mjs`. Konsequenzen:

- Funktioniert nur, wenn die Seite **öffentlich** erreichbar ist (GitHub Pages, kein privates Repo mit deaktivierten Pages).
- Funktioniert pro Rezept. Für die **gesammelte Wochenliste** kopierst du die Liste und fügst sie in Bring über die Mehrfacheingabe ein (Artikel mit Komma getrennt). Bring importiert keine geteilten Textlisten.

### Fehler „failed to process recipe / could not detect recipe“

In dieser Reihenfolge prüfen:

1. **Läuft die App über die öffentliche Pages-URL?** Lokal (localhost oder Datei) kann Bring die Rezeptseite nicht abrufen. Die App blendet den Knopf lokal inzwischen aus.
2. **Existiert die Rezeptseite?** `https://DEINNAME.github.io/REPO/r/<rezept-id>/` im Browser öffnen. Bei 404: Skript ausführen und den Ordner `r/` committen.
3. **Wurde das Skript mit Basis-URL ausgeführt?** Ohne sie fehlen absolute `url`/`image`-Felder, woran der Bring-Parser scheitern kann.
4. **Gegencheck mit Bring selbst:** Unter https://www.getbring.com/de/integration-prufen kannst du eine Rezept-URL direkt testen.

## Wochenplan geräteübergreifend übertragen

Wochenplan und abgehakte Einkaufsposten liegen nur im Browser des jeweiligen Geräts. Um beides auf ein anderes Gerät zu bringen:

1. Auf dem Quellgerät: **Einstellungen → "Plan-Code erzeugen"**. Der Code erscheint im Textfeld und wird zugleich in die Zwischenablage kopiert.
2. Den Code auf das Zielgerät übertragen (z. B. per Nachricht an dich selbst).
3. Auf dem Zielgerät: **Einstellungen**, den Code in das Import-Feld einfügen und **"Plan importieren"** drücken.

Der Import **ersetzt** auf dem Zielgerät den vorhandenen Wochenplan und die Häkchen vollständig, es wird nichts zusammengeführt. Die Übertragung ist einseitig (Quelle überschreibt Ziel) und manuell, es gibt bewusst keinen automatischen Live-Sync und kein Backend. Ungültige oder unvollständige Codes werden abgewiesen und nicht importiert.

## Hinweis zu den Rezeptdaten

Reine Zutatenlisten und Kochanleitungen gelten im Allgemeinen als nicht schutzfähig, die wörtlichen Texte und Fotos aus Magazinen dagegen schon. Die mitgelieferten Rezepte sind deshalb knapp paraphrasiert und enthalten keine Original-Fotos. Wenn du unsicher bist oder wörtliche Texte übernehmen willst, stelle das Repo auf privat (dann entfällt allerdings der Bring-Deeplink) oder lass die Rezeptdaten aus dem öffentlichen Teil heraus. Das ist keine Rechtsberatung.

## Datenhaltung

| Daten | Ort |
|---|---|
| Rezeptkatalog | `recipes.json` im Repo |
| Wochenplan, Häkchen | localStorage des Browsers |

localStorage ist pro Gerät. Den Wochenplan (samt Häkchen) überträgst du bei Bedarf per Code auf ein anderes Gerät, siehe "Wochenplan geräteübergreifend übertragen". Ein automatischer Sync über ein Backend ist bewusst nicht vorgesehen, das würde dem statischen, kostenfreien Ansatz widersprechen.

## Fehlersuche Bring-Import ("could not detect recipe link")

Diese Meldung heißt: Bring konnte unter der übergebenen URL keine Rezeptdaten lesen. In dieser Reihenfolge prüfen:

1. **Öffentliche Adresse nutzen.** Der Knopf funktioniert nur auf der GitHub-Pages-URL, nie auf localhost. Bring ruft die Seite von seinen Servern ab.
2. **Rezeptseite erreichbar?** In der Detailansicht den Knopf "Rezeptseite prüfen" drücken (oder `https://<name>.github.io/<repo>/r/pasta-gemuesesosse/` direkt aufrufen, am besten im Inkognito-Fenster). Kommt ein 404, fehlt der Ordner `r/` im Repo: Skript ausführen und committen.
3. **Seiten mit deiner echten URL neu erzeugen.** Bring ist beim Parsen wählerisch und mag absolute `url`- und `image`-Felder:

   ```bash
   node scripts/build-bring-pages.mjs https://<name>.github.io/<repo>/
   git add r/ img/ && git commit -m "Bring-Seiten" && git push
   ```

4. **JSON-LD validieren:** Die Rezeptseiten-URL bei https://validator.schema.org einfügen. Wird dort ein Recipe erkannt, liegt es nicht an der Seite.
5. Danach den Bring-Knopf erneut testen. GitHub Pages braucht nach dem Push ein bis zwei Minuten.

## Rezept-Studio: Fotos am Mac verarbeiten und automatisch pushen

Das Studio ist ein lokales Werkzeug. Es läuft nur auf deinem Rechner, der API-Key bleibt dort und wird nie ins Repo gepusht.

**Einmalige Einrichtung:**

1. [GitHub Desktop](https://desktop.github.com) installieren, anmelden und das Repo klonen (Code → Open with GitHub Desktop). Damit ist auch die Push-Berechtigung erledigt.
2. [Node.js](https://nodejs.org) installieren (LTS-Version reicht).

**Benutzung:**

```bash
cd pfad/zum/geklonten/rezeptkasten
node scripts/studio.mjs
```

Alternativ einfach die Datei `studio.command` doppelklicken (falls macOS meckert: einmal im Terminal `chmod +x studio.command` ausführen).

Dann http://localhost:8787 öffnen. Beim ersten Start trägst du API-Key und deine GitHub-Pages-Adresse ein. Den API-Key erstellst du unter [console.anthropic.com](https://console.anthropic.com); dort kannst du am besten gleich ein Ausgabenlimit als Sicherheitsnetz setzen. Die Konfiguration landet **außerhalb des Repos** unter `~/.config/rezeptkasten/studio.json` und kann so nie in einen Commit geraten. Eine evtl. noch vorhandene alte `.studio.json` im Repo wird beim Start automatisch dorthin übernommen und entfernt. Danach:

1. Rezeptfotos in die Fläche ziehen (mehrere gleichzeitig möglich).
2. Claude extrahiert die Rezepte, du prüfst und korrigierst sie in den Formularen.
3. Ein Klick auf "Speichern & zu GitHub pushen" aktualisiert `recipes.json`, baut die Bring-Seiten neu und pusht alles. Ein bis zwei Minuten später ist das Rezept in der App, inklusive funktionierendem Bring-Knopf.

Das Studio ist der einzige Weg für den Foto-Import. Die öffentliche App verarbeitet keinen API-Key mehr.

## Etiketten (Tags) wie One-Pot

Neben der einen Kategorie (Hauptgericht, Suppe, …) kann ein Rezept beliebig viele **Tags** tragen. Tags sind unabhängig von der Kategorie: Ein One-Pot-Gericht bleibt z. B. ein Hauptgericht und erscheint trotzdem unter dem One-Pot-Filter.

- In der App taucht für jedes im Katalog vorhandene Tag automatisch eine gestrichelte Filter-Schaltfläche auf. Filter lassen sich kombinieren (Hauptgericht + One-Pot).
- Im Studio setzt du Tags pro Rezept: One-Pot per Häkchen, weitere frei kommagetrennt. Claude schlägt "One-Pot" bei passenden Rezepten schon automatisch vor.
- In der JSON ist es ein optionales Feld, z. B. `"tags": ["One-Pot"]`. Wer von Hand pflegt, fügt es einfach hinzu; ohne Tags lässt man das Feld weg.

