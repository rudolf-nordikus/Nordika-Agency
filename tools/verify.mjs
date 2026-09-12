// tools/verify.mjs — provjerava da svaka lokalna referenca u HTML-u pokazuje
// na fajl koji zaista postoji, i da nijedna referenca nije ostala na Webflowu.
//
// Pisano zato što naivni grep po `"/assets/[^"]+"` hvata cijelu srcset listu
// kao jedan put i lažno prijavljuje da fajlovi fale. Ovdje se srcset, liste u
// data-video-urls, url() u inline stilu i percent-enkodovane reference
// razdvajaju kako treba.

import { readdir, readFile, access } from 'node:fs/promises';
import { join, extname } from 'node:path';

const KORIJEN = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PRESKOCI = new Set(['.git', 'node_modules', 'tools', 'docs', 'api']);

// Hostovi koji NE smiju ostati — sve što je vezano za Webflow ili tuđi CDN.
const ZABRANJENI = [
  'website-files.com',
  'webflow.com/js',
  'd3e54v103j8qbb.cloudfront.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'min30327.github.io',
  'cdn.jsdelivr.net',
];

async function sviHtml(dir = '') {
  const nadjeno = [];
  for (const e of await readdir(join(KORIJEN, dir), { withFileTypes: true })) {
    if (PRESKOCI.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) nadjeno.push(...(await sviHtml(rel)));
    else if (extname(e.name) === '.html') nadjeno.push(rel);
  }
  return nadjeno;
}

/** Sve lokalne putanje na koje jedan HTML pokazuje. */
function lokalneReference(html) {
  const putanje = new Set();

  const dodaj = (v) => {
    let p = (v || '').trim();
    if (!p.startsWith('/')) return;
    p = p.split('#')[0].split('?')[0];
    if (!/^\/(assets|css|js|fonts)\//.test(p)) return;
    putanje.add(decodeURIComponent(p));
  };

  // src / href / poster i sve što je jedna putanja u atributu
  for (const m of html.matchAll(/(?:src|href|poster|data-poster-url)="([^"]+)"/g)) dodaj(m[1]);

  // srcset: "putanja 500w, putanja 800w"
  for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const dio of m[1].split(',')) dodaj(dio.trim().replace(/\s+\d+[wx]$/, ''));
  }

  // liste u jednom atributu: data-video-urls="a.mp4,b.webm"
  for (const m of html.matchAll(/data-video-urls="([^"]+)"/g)) {
    for (const dio of m[1].split(',')) dodaj(dio);
  }

  // url(...) u inline stilu, i sa &quot; i bez
  for (const m of html.matchAll(/url\(\s*(?:&quot;|['"])?([^'")]+?)(?:&quot;|['"])?\s*\)/g)) dodaj(m[1]);

  // Percent-enkodovane reference iz Webflow CMS repeater markupa. Lokalne
  // putanje su sanitizovane na [A-Za-z0-9._-], pa u njima nema ni jednog
  // procenta — svaki `%` je granica (%22 je citat, %20 razmak, %2C zapeta).
  for (const m of html.matchAll(/%2F(?:assets|css|js|fonts)%2F[^%"'\s<>,]+/gi)) {
    try {
      dodaj(decodeURIComponent(m[0]));
    } catch {}
  }

  return putanje;
}

const postoji = async (p) => {
  try {
    await access(join(KORIJEN, p));
    return true;
  } catch {
    return false;
  }
};

async function main() {
  const fajlovi = await sviHtml();
  const sve = new Map(); // putanja -> [gdje se referencira]
  const zaostali = [];

  for (const rel of fajlovi) {
    const html = await readFile(join(KORIJEN, rel), 'utf8');
    for (const p of lokalneReference(html)) {
      if (!sve.has(p)) sve.set(p, []);
      sve.get(p).push(rel);
    }
    for (const z of ZABRANJENI) {
      if (html.includes(z)) zaostali.push(`${rel} -> ${z}`);
    }
  }

  const fale = [];
  for (const p of sve.keys()) if (!(await postoji(p))) fale.push(p);

  console.log(`HTML stranica:        ${fajlovi.length}`);
  console.log(`Lokalnih referenci:   ${sve.size}`);
  console.log(`Fale na disku:        ${fale.length}`);
  console.log(`Zaostalih na Webflow: ${zaostali.length}`);

  for (const p of fale) console.log(`  FALI ${p}  (${sve.get(p).slice(0, 3).join(', ')})`);
  for (const z of zaostali.slice(0, 20)) console.log(`  ZAOSTALO ${z}`);

  if (fale.length || zaostali.length) process.exit(1);
  console.log('\nSve reference su lokalne i sve postoje.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
