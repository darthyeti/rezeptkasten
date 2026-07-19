#!/usr/bin/env node
/**
 * Erzeugt für jedes Rezept aus recipes.json eine statische Seite r/<id>/index.html
 * mit schema.org/Recipe-JSON-LD. Diese Seiten liest Bring! über den Deeplink
 * https://api.getbring.com/rest/bringrecipes/deeplink?url=<Rezept-URL>&source=web aus.
 *
 * WICHTIG: Die Basis-URL deiner GitHub-Pages-Seite als Argument übergeben,
 * damit absolute url- und image-Felder erzeugt werden (Bring braucht das):
 *
 *   node scripts/build-bring-pages.mjs https://DEINNAME.github.io/REPO/
 *
 * Danach den Ordner r/ mitcommitten.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const base = (process.argv[2] || "").replace(/\/?$/, "/");
if (!base.startsWith("http")) {
  console.warn("⚠ Keine Basis-URL übergeben. Bitte aufrufen mit:\n  node scripts/build-bring-pages.mjs https://DEINNAME.github.io/REPO/\nOhne absolute URLs kann der Bring-Import fehlschlagen.\n");
}

const recipes = JSON.parse(readFileSync("recipes.json", "utf8"));
rmSync("r", { recursive: true, force: true });

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

for (const r of recipes) {
  const pageUrl = base ? `${base}r/${r.id}/` : undefined;
  const imgUrl = base ? `${base}${r.image || "img/recipe.png"}` : undefined;
  const ld = {
    "@context": "http://schema.org",
    "@type": "Recipe",
    name: r.title,
    ...(pageUrl ? { url: pageUrl, image: imgUrl } : {}),
    author: { "@type": "Person", name: "Rezeptkasten" },
    description: `${r.title} – ${r.category}, ${r.portions} Portionen.`,
    recipeYield: `${r.portions} Portionen`,
    prepTime: `PT${r.time || 0}M`,
    cookTime: `PT${r.wait || 0}M`,
    totalTime: `PT${(r.time || 0) + (r.wait || 0)}M`,
    recipeCategory: r.category,
    recipeIngredient: r.ingredients.map((i) => `${i.a ? i.a + " " : ""}${i.n}`),
    recipeInstructions: (r.steps || []).map((s) => ({ "@type": "HowToStep", text: s })),
  };
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} – Rezeptkasten</title>
${pageUrl ? `<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(r.title)}">
<meta property="og:url" content="${esc(pageUrl)}">
<meta property="og:image" content="${esc(imgUrl)}">` : ""}
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#22302a}
li{margin:4px 0}</style>
</head>
<body>
<p><a href="../../">← zurück zum Rezeptkasten</a></p>
<h1>${esc(r.title)}</h1>
<p>${r.portions} Portionen · ${r.time}${r.wait ? " + " + r.wait : ""} Min</p>
<h2>Zutaten</h2>
<ul>${r.ingredients.map((i) => `<li>${esc((i.a ? i.a + " " : "") + i.n)}</li>`).join("\n")}</ul>
<h2>Zubereitung</h2>
<ol>${(r.steps || []).map((s) => `<li>${esc(s)}</li>`).join("\n")}</ol>
</body>
</html>
`;
  mkdirSync(`r/${r.id}`, { recursive: true });
  writeFileSync(`r/${r.id}/index.html`, html);
  console.log(`✓ r/${r.id}/index.html`);
}
console.log(`\n${recipes.length} Rezeptseiten erzeugt${base ? " für " + base : ""}. Ordner r/ committen, fertig.`);
