#!/usr/bin/env node
/**
 * Rezept-Studio: lokales Werkzeug zum Befüllen des Rezeptkastens.
 *
 *   node scripts/studio.mjs
 *
 * Öffnet eine Web-Oberfläche auf http://localhost:8787 (nur lokal erreichbar).
 * Dort Fotos von Rezepten reinziehen, Claude extrahiert die Daten,
 * du prüfst und korrigierst, und ein Knopf erledigt:
 * recipes.json aktualisieren, Bring-Seiten neu bauen, git commit + push.
 *
 * Voraussetzungen: Node 18+, git mit Push-Rechten auf das Repo
 * (einmalig z. B. über GitHub Desktop einrichten und das Repo klonen).
 *
 * Der API-Key wird außerhalb des Repos gespeichert
 * (~/.config/rezeptkasten/studio.json) und kann so nie committet werden.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.STUDIO_PORT) || 8787;

/* Konfiguration liegt AUSSERHALB des Repos, damit der API-Key
   niemals in einen Commit geraten kann.
   macOS/Linux: ~/.config/rezeptkasten/studio.json
   (per XDG_CONFIG_HOME überschreibbar) */
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "rezeptkasten");
const CONFIG_PATH = join(CONFIG_DIR, "studio.json");
const LEGACY_PATH = join(ROOT, ".studio.json"); // alter Ort im Repo

function loadConfig() {
  // Vorhandene neue Konfig hat Vorrang
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch {}
  // Einmalige Migration aus der alten .studio.json im Repo
  try {
    const old = JSON.parse(readFileSync(LEGACY_PATH, "utf8"));
    saveConfig(old);
    try { rmSync(LEGACY_PATH); } catch {}
    console.log("Konfiguration migriert nach " + CONFIG_PATH + " und alte .studio.json entfernt.");
    return old;
  } catch {}
  return {};
}
function saveConfig(c) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout: 120000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout || "") + (stderr || ""), code: err ? err.code : 0 });
    });
  });
}

function slug(title) {
  return title.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "rezept";
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return JSON.parse(data || "{}");
}

/* ---------- Claude: Rezept aus Foto extrahieren ---------- */
async function extractRecipe(apiKey, mediaType, base64) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: 'Extrahiere das Kochrezept aus diesem Foto. Berücksichtige handschriftliche Änderungen (durchgestrichene Zutaten ersetzen, Randnotizen übernehmen). Setze "One-Pot" in tags, wenn das Gericht in einem einzigen Topf oder einer Pfanne zubereitet wird (Hinweise: "One Pot" im Titel, alles nacheinander im selben Topf). Tags sind ausschließlich beschreibende Etiketten (z. B. Backofen, Pasta, Bowl, Sauce) und beginnen mit Großbuchstaben. Verwende NIEMALS "vegan", "vegetarisch" oder "schnell" als Tag: vegan/vegetarisch gehört in das Feld "veg", und Schnelligkeit ergibt sich aus den Zeitangaben. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Markdown, exakt in diesem Schema: {"title":string,"category":"Hauptgericht"|"Suppe"|"Salat"|"Dessert"|"Sonstiges","tags":string[],"time":number,"wait":number,"portions":number,"kcal":number|null,"veg":"vegan"|"vegetarisch"|null,"source":string,"notes":string,"ingredients":[{"a":string,"n":string}],"steps":[string]}' },
        ],
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API-Fehler");
  const text = (data.content || []).map((b) => b.text || "").join("\n");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  if (!parsed.title || !Array.isArray(parsed.ingredients)) throw new Error("Unvollständiges Rezept erkannt");
  return parsed;
}

/* ---------- Speichern, Seiten bauen, pushen ----------
   incoming: Rezepte ohne id = neu (id wird erzeugt),
             Rezepte mit vorhandener id = bestehendes Rezept ersetzen.
   deletes:  Liste von ids, die aus der Sammlung entfernt werden. */
async function saveAndPush(incoming, deletes, baseUrl) {
  const log = [];
  const file = join(ROOT, "recipes.json");
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  const ids = new Set(catalog.map((r) => r.id));
  const added = [], updated = [], removed = [];

  // 1) Löschungen (inkl. zugehörigem Gericht-Foto)
  for (const id of (deletes || [])) {
    const idx = catalog.findIndex((r) => r.id === id);
    if (idx > -1) {
      removed.push(catalog[idx].title);
      if (catalog[idx].image) { try { rmSync(join(ROOT, catalog[idx].image)); } catch {} }
      catalog.splice(idx, 1); ids.delete(id);
    }
  }

  // 2) Hinzufügen / Aktualisieren
  //    photoData = neues (bereits verkleinertes) Foto als Base64-JPEG,
  //    removeImage = vorhandenes Foto entfernen. Beides kommt nie zusammen.
  for (const r of incoming) {
    const { id: incomingId, photoData, removeImage, ...data } = r;
    if (Array.isArray(data.tags) && data.tags.length === 0) delete data.tags;
    const idx = incomingId ? catalog.findIndex((x) => x.id === incomingId) : -1;
    let id;
    if (idx > -1) {
      id = incomingId; // bestehende id behalten -> Links bleiben gültig
    } else {
      id = slug(data.title);
      let n = 2;
      while (ids.has(id)) id = slug(data.title) + "-" + n++;
      ids.add(id);
    }
    if (photoData) {
      mkdirSync(join(ROOT, "img"), { recursive: true });
      writeFileSync(join(ROOT, "img", id + ".jpg"), Buffer.from(photoData, "base64"));
      data.image = "img/" + id + ".jpg";
    } else if (removeImage) {
      delete data.image;
      if (idx > -1 && catalog[idx].image) { try { rmSync(join(ROOT, catalog[idx].image)); } catch {} }
    }
    if (idx > -1) {
      catalog[idx] = { id, ...data };
      updated.push(data.title);
    } else {
      catalog.push({ id, ...data });
      added.push(data.title);
    }
  }

  writeFileSync(file, JSON.stringify(catalog, null, 2));
  log.push("✓ recipes.json aktualisiert (" + catalog.length + " Rezepte)");

  const build = await run("node", [join(ROOT, "scripts", "build-bring-pages.mjs"), baseUrl]);
  log.push(build.ok ? "✓ Bring-Seiten neu erzeugt" : "✗ Bring-Seiten: " + build.out);
  if (!build.ok) return { ok: false, log };

  const parts = [];
  if (added.length) parts.push("hinzugefügt: " + added.join(", "));
  if (updated.length) parts.push("aktualisiert: " + updated.join(", "));
  if (removed.length) parts.push("gelöscht: " + removed.join(", "));
  const msg = "Rezepte " + (parts.join(" | ") || "aktualisiert");

  for (const args of [
    ["add", "recipes.json", "r", "img"],
    ["commit", "-m", msg],
    ["push"],
  ]) {
    const res = await run("git", args);
    log.push((res.ok ? "✓ git " : "✗ git ") + args[0] + (res.ok ? "" : ":\n" + res.out.trim()));
    if (!res.ok && !/nothing to commit/.test(res.out)) return { ok: false, log };
  }
  log.push("🎉 Fertig. GitHub Pages braucht jetzt ein bis zwei Minuten.");
  return { ok: true, log };
}

/* ---------- Web-Oberfläche ---------- */
const PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rezept-Studio</title>
<style>
  :root{--ink:#22302a;--paper:#fffdf8;--bg:#e9ece3;--line:#cfd6c8;--accent:#c75b39;--match:#3e7c4f;--gold:#d9a13b;--dim:#6b7a70}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;padding-bottom:60px}
  header{background:var(--ink);color:var(--paper);padding:22px 20px}
  .inner{max-width:860px;margin:0 auto}
  .eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);font-weight:600}
  h1{font-size:26px;margin:4px 0 2px;font-weight:700}
  .sub{color:#b8c4ba;font-size:14px;margin:0}
  main{max-width:860px;margin:0 auto;padding:18px 20px}
  .drop{border:2px dashed var(--line);border-radius:16px;background:var(--paper);padding:38px 20px;
    text-align:center;color:var(--dim);font-size:15px;cursor:pointer;transition:border-color .15s}
  .drop.over{border-color:var(--match);color:var(--match)}
  .card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px;margin-top:14px}
  .card h3{margin:0 0 10px;font-size:17px}
  label{display:block;font-size:12px;font-weight:600;color:var(--dim);margin:10px 0 4px;text-transform:uppercase;letter-spacing:.08em}
  input,select,textarea{width:100%;border:1px solid var(--line);border-radius:9px;padding:9px 11px;
    font-size:14px;font-family:inherit;background:#fff;color:var(--ink)}
  textarea{min-height:110px;line-height:1.5;font-family:ui-monospace,Menlo,monospace;font-size:13px}
  .grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
  .row{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
  .btn{border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:10px;
    padding:10px 16px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
  .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
  .btn.ghost{color:var(--dim)}
  .status{font-size:13px;color:var(--dim)}
  .ok{color:var(--match)} .err{color:var(--accent)}
  pre{background:var(--ink);color:#cfe3d4;border-radius:12px;padding:14px;font-size:12.5px;
    white-space:pre-wrap;word-break:break-word}
  .hint{font-size:13px;color:var(--dim);line-height:1.6}
  .photo-thumb{width:72px;height:72px;object-fit:cover;border-radius:9px;border:1px solid var(--line)}
  .pushbar{position:fixed;left:0;right:0;bottom:0;background:var(--paper);border-top:1px solid var(--line);padding:12px 20px}
  .pushbar .inner{display:flex;gap:10px;align-items:center;justify-content:space-between}
</style>
</head>
<body>
<header><div class="inner">
  <div class="eyebrow">Lokal · localhost</div>
  <h1>Rezept-Studio</h1>
  <p class="sub">Fotos rein, prüfen, mit einem Klick in die App pushen.</p>
</div></header>
<main>
  <div id="setup"></div>
  <div class="drop" id="drop">📷 Rezeptfotos hierher ziehen oder klicken<br>
    <span style="font-size:13px">(mehrere gleichzeitig möglich)</span></div>
  <input type="file" id="file" accept="image/*" multiple hidden>
  <input type="file" id="photofile" accept="image/*" hidden>
  <div class="card" id="editpanel">
    <h3>Vorhandenes Rezept bearbeiten</h3>
    <div class="row" style="margin-top:0">
      <select id="existing" style="flex:1;min-width:160px"></select>
      <button class="btn" id="loadbtn">Bearbeiten</button>
    </div>
    <span class="hint">Lädt das Rezept ins Formular. Änderungen (auch Löschen) werden erst beim Pushen übernommen. Die Adresse des Rezepts bleibt gleich.</span>
  </div>
  <div id="cards"></div>
  <pre id="log" hidden></pre>
</main>
<div class="pushbar" id="pushbar" hidden><div class="inner">
  <span class="status" id="pushinfo"></span>
  <button class="btn primary" id="push">Speichern &amp; zu GitHub pushen</button>
</div></div>

<script>
var drafts = [];

function el(id){ return document.getElementById(id); }
function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }

/* ---- Setup-Status laden ---- */
fetch('/api/status').then(function(r){return r.json()}).then(function(s){
  if(!s.hasKey || !s.baseUrl){
    el('setup').innerHTML = '<div class="card"><h3>Einmalige Einrichtung</h3>' +
      '<label>Anthropic-API-Key</label><input id="cfgkey" type="password" placeholder="sk-ant-…" value="">' +
      '<label>GitHub-Pages-Adresse</label><input id="cfgurl" value="' + esc(s.baseUrl || 'https://darthyeti.github.io/rezeptkasten/') + '">' +
      '<div class="row"><button class="btn primary" id="cfgsave">Speichern</button>' +
      '<span class="hint">Wird außerhalb des Repos gespeichert (~/.config/rezeptkasten/studio.json) und kann nie in einen Commit geraten.</span></div></div>';
    el('cfgsave').onclick = function(){
      fetch('/api/config', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({apiKey: el('cfgkey').value.trim(), baseUrl: el('cfgurl').value.trim()})
      }).then(function(){ location.reload(); });
    };
  }
  if(!s.gitOk){
    el('setup').innerHTML += '<div class="card"><h3 class="err">Git-Hinweis</h3><p class="hint">' + esc(s.gitMsg) + '</p></div>';
  }
});

/* ---- Fotos annehmen ---- */
var drop = el('drop'), file = el('file');
drop.onclick = function(){ file.click(); };
drop.ondragover = function(e){ e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = function(){ drop.classList.remove('over'); };
drop.ondrop = function(e){ e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); };
file.onchange = function(){ handleFiles(file.files); file.value=''; };

/* ---- Vorhandene Rezepte zum Bearbeiten laden ---- */
var existingRecipes = [];
function loadExisting(){
  fetch('/api/recipes').then(function(r){ return r.json(); }).then(function(list){
    existingRecipes = list || [];
    el('existing').innerHTML = '<option value="">— Rezept wählen —</option>' +
      existingRecipes.map(function(r){
        return '<option value="' + esc(r.id) + '">' + esc(r.title) + '</option>'; }).join('');
  });
}
loadExisting();

el('loadbtn').onclick = function(){
  var id = el('existing').value;
  if(!id) return;
  var open = drafts.some(function(d){ return d.id===id && d.status!=='entfernt'; });
  if(open){ alert('Dieses Rezept ist schon zum Bearbeiten geöffnet.'); return; }
  var rec = existingRecipes.filter(function(r){ return r.id===id; })[0];
  if(!rec) return;
  drafts.push({ status:'ok', recipe: rec, id: id, edit: true, name: 'bearbeiten' });
  render();
  window.scrollTo(0, document.body.scrollHeight);
};

function handleFiles(list){
  Array.prototype.forEach.call(list, function(f){
    if(f.type.indexOf('image/') !== 0) return;
    var idx = drafts.length;
    drafts.push({ status:'lädt', recipe:null, name:f.name });
    render();
    var reader = new FileReader();
    reader.onload = function(){
      var b64 = reader.result.split(',')[1];
      fetch('/api/extract', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ media_type: f.type, data: b64 })
      }).then(function(r){ return r.json(); }).then(function(res){
        if(res.error){ drafts[idx] = { status:'fehler', error:res.error, name:f.name }; }
        else { drafts[idx] = { status:'ok', recipe:res, name:f.name }; }
        render();
      }).catch(function(e){ drafts[idx] = { status:'fehler', error:String(e), name:f.name }; render(); });
    };
    reader.readAsDataURL(f);
  });
}

/* ---- Karten rendern ---- */
function ingText(r){ return r.ingredients.map(function(i){ return (i.a||'') + ' | ' + i.n; }).join('\\n'); }
function stepText(r){ return (r.steps||[]).join('\\n'); }

/* ---- Gericht-Foto (optional, Downscale ist Pflicht) ---- */
function photoRowHtml(d, i){
  var src = d.photo ? 'data:image/jpeg;base64,' + d.photo
    : (d.edit && d.recipe.image && !d.photoRemoved ? '/' + esc(d.recipe.image) : '');
  return (src ? '<img class="photo-thumb" src="' + src + '" alt="">' : '') +
    '<button class="btn" type="button" data-photo="' + i + '">' + (src ? 'Foto ersetzen' : 'Foto wählen') + '</button>' +
    (src ? '<button class="btn ghost" type="button" data-photorm="' + i + '">Foto entfernen</button>' : '') +
    '<span class="hint">wird automatisch verkleinert</span>';
}

/* Verkleinert das Foto clientseitig (max 800 px Kante, JPEG),
   damit das Repo nicht mit Original-Handyfotos vollläuft. */
function downscale(f, cb){
  var url = URL.createObjectURL(f);
  var img = new Image();
  img.onload = function(){
    URL.revokeObjectURL(url);
    var max = 800, s = Math.min(1, max / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
  };
  img.onerror = function(){ URL.revokeObjectURL(url); alert('Bild konnte nicht gelesen werden (' + (f.type || 'unbekanntes Format') + '). Bitte als JPEG oder PNG versuchen.'); };
  img.src = url;
}

/* Nur die Foto-Zeile neu zeichnen, damit Eingaben in den übrigen Feldern erhalten bleiben */
function updatePhotoRow(idx){
  var row = el('photorow-' + idx);
  if(!row) return;
  row.innerHTML = photoRowHtml(drafts[idx], idx);
  bindPhotoButtons(row);
}

/* Festes (verstecktes) Datei-Feld statt eines dynamisch erzeugten:
   in Safari feuert das change-Event auf losen Inputs sonst oft nicht. */
var photoTarget = -1;
el('photofile').onchange = function(){
  var f = el('photofile').files[0], idx = photoTarget;
  el('photofile').value = '';
  if(!f || idx < 0 || !drafts[idx]) return;
  downscale(f, function(b64){
    drafts[idx].photo = b64;
    drafts[idx].photoRemoved = false;
    updatePhotoRow(idx);
  });
};

function bindPhotoButtons(scope){
  Array.prototype.forEach.call(scope.querySelectorAll('[data-photo]'), function(b){
    b.onclick = function(){
      photoTarget = Number(b.dataset.photo);
      el('photofile').click();
    };
  });
  Array.prototype.forEach.call(scope.querySelectorAll('[data-photorm]'), function(b){
    b.onclick = function(){
      var idx = Number(b.dataset.photorm);
      drafts[idx].photo = null;
      drafts[idx].photoRemoved = true;
      updatePhotoRow(idx);
    };
  });
}

function render(){
  el('cards').innerHTML = drafts.map(function(d, i){
    if(d.status==='lädt') return '<div class="card"><span class="status">⏳ ' + esc(d.name) + ' wird gelesen …</span></div>';
    if(d.status==='fehler') return '<div class="card"><span class="status err">✗ ' + esc(d.name) + ': ' + esc(d.error) + '</span></div>';
    if(d.status==='entfernt') return '';
    if(d.status==='todelete') return '<div class="card"><span class="status err">🗑 ' +
      esc(d.recipe.title) + ' wird beim Speichern gelöscht.</span> ' +
      '<button class="btn ghost" data-undel="' + i + '">Rückgängig</button></div>';
    var r = d.recipe;
    var badge = d.edit
      ? '<span class="status" style="color:var(--gold)">● bearbeiten</span>'
      : '<span class="status">(' + esc(d.name) + ')</span>';
    return '<div class="card" data-i="' + i + '">' +
      '<h3>✓ ' + esc(r.title) + ' ' + badge + '</h3>' +
      '<label>Titel</label><input data-f="title" value="' + esc(r.title) + '">' +
      '<div class="grid2">' +
      '<div><label>Kategorie</label><select data-f="category">' +
        ['Hauptgericht','Suppe','Salat','Dessert','Sonstiges'].map(function(c){
          return '<option' + (r.category===c?' selected':'') + '>' + c + '</option>'; }).join('') + '</select></div>' +
      '<div><label>Zeit (Min)</label><input data-f="time" type="number" value="' + (r.time||0) + '"></div>' +
      '<div><label>Wartezeit</label><input data-f="wait" type="number" value="' + (r.wait||0) + '"></div>' +
      '<div><label>Portionen</label><input data-f="portions" type="number" value="' + (r.portions||4) + '"></div>' +
      '<div><label>kcal</label><input data-f="kcal" type="number" value="' + (r.kcal==null?'':r.kcal) + '"></div>' +
      '<div><label>Ernährung</label><select data-f="veg"><option value="">–</option>' +
        '<option' + (r.veg==='vegetarisch'?' selected':'') + '>vegetarisch</option>' +
        '<option' + (r.veg==='vegan'?' selected':'') + '>vegan</option></select></div>' +
      '</div>' +
      '<label>Quelle</label><input data-f="source" value="' + esc(r.source||'') + '">' +
      '<label>Etiketten</label>' +
      '<div class="row" style="margin-top:0;gap:14px">' +
        '<label style="display:flex;align-items:center;gap:7px;text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);margin:0">' +
          '<input type="checkbox" data-f="onepot" style="width:auto" ' +
          (((r.tags||[]).indexOf('One-Pot')>-1)?'checked':'') + '> One-Pot</label>' +
        '<input data-f="tagsextra" placeholder="weitere, mit Komma getrennt" ' +
          'value="' + esc((r.tags||[]).filter(function(t){return t!=='One-Pot';}).join(', ')) + '" style="flex:1">' +
      '</div>' +
      '<label>Zutaten (eine pro Zeile, Format: Menge | Zutat)</label>' +
      '<textarea data-f="ingredients">' + esc(ingText(r)) + '</textarea>' +
      '<label>Zubereitung (ein Schritt pro Zeile)</label>' +
      '<textarea data-f="steps">' + esc(stepText(r)) + '</textarea>' +
      '<label>Notizen</label><input data-f="notes" value="' + esc(r.notes||'') + '">' +
      '<label>Foto vom Gericht (optional)</label>' +
      '<div class="row" style="margin-top:0" id="photorow-' + i + '">' + photoRowHtml(d, i) + '</div>' +
      '<div class="row"><button class="btn ghost" data-rm="' + i + '">Verwerfen</button>' +
        (d.edit ? '<button class="btn ghost err" data-del="' + i + '">Aus Sammlung löschen</button>' : '') +
      '</div>' +
      '</div>';
  }).join('');

  Array.prototype.forEach.call(document.querySelectorAll('[data-rm]'), function(b){
    b.onclick = function(){ drafts[Number(b.dataset.rm)].status = 'entfernt'; render(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function(b){
    b.onclick = function(){
      if(!confirm('Dieses Rezept wirklich aus der Sammlung löschen? Es wird beim nächsten Push dauerhaft entfernt.')) return;
      drafts[Number(b.dataset.del)].status = 'todelete'; render();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-undel]'), function(b){
    b.onclick = function(){ drafts[Number(b.dataset.undel)].status = 'ok'; render(); };
  });
  bindPhotoButtons(el('cards'));

  var ready = drafts.filter(function(d){ return d.status==='ok' || d.status==='todelete'; }).length;
  el('pushbar').hidden = ready === 0;
  el('pushinfo').textContent = ready + (ready===1 ? ' Änderung bereit' : ' Änderungen bereit');
}

/* ---- Formulardaten einsammeln & pushen ---- */
function collect(){
  return drafts.map(function(d, i){
    if(d.status!=='ok') return null;
    var card = document.querySelector('.card[data-i="' + i + '"]');
    var get = function(f){ return card.querySelector('[data-f="' + f + '"]').value; };
    var num = function(f){ var v = parseFloat(get(f)); return isNaN(v) ? 0 : v; };
    var tags = [];
    if(card.querySelector('[data-f="onepot"]').checked) tags.push('One-Pot');
    get('tagsextra').split(',').map(function(t){ return t.trim(); }).filter(Boolean)
      .forEach(function(t){ if(tags.indexOf(t) === -1) tags.push(t); });
    var rec = {
      title: get('title').trim(),
      category: get('category'),
      tags: tags,
      time: num('time'), wait: num('wait'), portions: num('portions') || 4,
      kcal: get('kcal') === '' ? null : num('kcal'),
      veg: get('veg') || null,
      source: get('source').trim(),
      notes: get('notes').trim(),
      ingredients: get('ingredients').split('\\n').map(function(l){ return l.trim(); }).filter(Boolean)
        .map(function(l){ var p = l.indexOf('|');
          return p === -1 ? { a:'', n:l } : { a:l.slice(0,p).trim(), n:l.slice(p+1).trim() }; }),
      steps: get('steps').split('\\n').map(function(l){ return l.trim(); }).filter(Boolean),
    };
    if(d.edit && d.id) rec.id = d.id;
    if(d.photo) rec.photoData = d.photo;
    else if(d.photoRemoved && d.edit) rec.removeImage = true;
    else if(d.edit && d.recipe.image) rec.image = d.recipe.image;
    return rec;
  }).filter(Boolean);
}

function collectDeletes(){
  return drafts.filter(function(d){ return d.status==='todelete' && d.id; })
    .map(function(d){ return d.id; });
}

el('push').onclick = function(){
  var recipes = collect();
  var deletes = collectDeletes();
  if(!recipes.length && !deletes.length) return;
  el('push').disabled = true; el('push').textContent = 'Pushe …';
  fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ recipes: recipes, deletes: deletes })
  }).then(function(r){ return r.json(); }).then(function(res){
    el('log').hidden = false;
    el('log').textContent = res.log.join('\\n');
    el('push').disabled = false; el('push').textContent = 'Speichern & zu GitHub pushen';
    if(res.ok){ drafts = []; render(); loadExisting(); }
    window.scrollTo(0, document.body.scrollHeight);
  });
};
</script>
</body>
</html>`;

/* ---------- Server ---------- */
const server = createServer(async (req, res) => {
  const send = (code, obj, type = "application/json") => {
    res.writeHead(code, { "Content-Type": type + "; charset=utf-8" });
    res.end(type === "application/json" ? JSON.stringify(obj) : obj);
  };
  try {
    if (req.method === "GET" && req.url === "/") return send(200, PAGE, "text/html");

    // Gericht-Fotos für die Vorschau im Bearbeiten-Modus ausliefern
    if (req.method === "GET" && req.url.startsWith("/img/")) {
      const name = req.url.slice(5).split("?")[0];
      if (!/^[\w.-]+$/.test(name) || name.includes("..")) return send(404, { error: "not found" });
      try {
        const buf = readFileSync(join(ROOT, "img", name));
        res.writeHead(200, { "Content-Type": name.endsWith(".png") ? "image/png" : "image/jpeg" });
        return res.end(buf);
      } catch {
        return send(404, { error: "not found" });
      }
    }

    if (req.method === "GET" && req.url === "/api/status") {
      const cfg = loadConfig();
      const git = await run("git", ["remote", "-v"]);
      return send(200, {
        hasKey: !!(process.env.ANTHROPIC_API_KEY || cfg.apiKey),
        baseUrl: cfg.baseUrl || "",
        gitOk: git.ok && /push/.test(git.out),
        gitMsg: git.ok ? "" : "Dieses Verzeichnis ist kein Git-Repository. Bitte das Repo einmal mit GitHub Desktop oder „git clone“ klonen und das Studio aus dem Klon starten.",
      });
    }

    if (req.method === "GET" && req.url === "/api/recipes") {
      try {
        const catalog = JSON.parse(readFileSync(join(ROOT, "recipes.json"), "utf8"));
        return send(200, catalog);
      } catch {
        return send(200, []);
      }
    }

    if (req.method === "POST" && req.url === "/api/config") {
      const body = await readBody(req);
      const cfg = loadConfig();
      if (body.apiKey) cfg.apiKey = body.apiKey;
      if (body.baseUrl) cfg.baseUrl = body.baseUrl.replace(/\/?$/, "/");
      saveConfig(cfg);
      return send(200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/extract") {
      const cfg = loadConfig();
      const key = process.env.ANTHROPIC_API_KEY || cfg.apiKey;
      if (!key) return send(200, { error: "Kein API-Key hinterlegt (Einrichtung oben ausfüllen)." });
      const body = await readBody(req);
      try {
        const recipe = await extractRecipe(key, body.media_type || "image/jpeg", body.data);
        return send(200, recipe);
      } catch (e) {
        return send(200, { error: e.message });
      }
    }

    if (req.method === "POST" && req.url === "/api/save") {
      const cfg = loadConfig();
      const body = await readBody(req);
      const result = await saveAndPush(body.recipes || [], body.deletes || [], cfg.baseUrl || "");
      return send(200, result);
    }

    send(404, { error: "not found" });
  } catch (e) {
    send(500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Rezept-Studio läuft: http://localhost:" + PORT);
  console.log("Beenden mit Strg+C");
});
