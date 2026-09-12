// tools/sitemap.mjs — generiše sitemap.xml iz stabla foldera.
//
// Webflow-ov sitemap nije imao <lastmod>, a i da je imao, poslije migracije ga
// niko ne bi osvježavao. Ovako je izvor istine sam repo: dodaš folder sa
// index.html, pokreneš skriptu, stranica je u sitemapu.

import { readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const KORIJEN = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DOMEN = 'https://www.nordika-agency.com';
const PRESKOCI = new Set(['.git', 'node_modules', 'tools', 'assets', 'fonts', 'css', 'js', 'docs', 'api']);

async function nadjiStranice(dir = '') {
  const stranice = [];
  for (const e of await readdir(join(KORIJEN, dir), { withFileTypes: true })) {
    if (PRESKOCI.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) stranice.push(...(await nadjiStranice(rel)));
    else if (e.name === 'index.html') stranice.push(dir);
  }
  return stranice;
}

const main = async () => {
  const putanje = (await nadjiStranice()).sort((a, b) => {
    if (a === '') return -1; // početna prva
    if (b === '') return 1;
    return a.localeCompare(b);
  });

  const redovi = [];
  for (const p of putanje) {
    const fajl = join(KORIJEN, p, 'index.html');
    const { mtime } = await stat(fajl);
    const loc = p === '' ? DOMEN : `${DOMEN}/${p}`;
    redovi.push(
      `    <url>\n        <loc>${loc}</loc>\n        <lastmod>${mtime.toISOString().slice(0, 10)}</lastmod>\n    </url>`
    );
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...redovi,
    '</urlset>',
    '',
  ].join('\n');

  await writeFile(join(KORIJEN, 'sitemap.xml'), xml);
  console.log(`sitemap.xml: ${putanje.length} stranica.`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
