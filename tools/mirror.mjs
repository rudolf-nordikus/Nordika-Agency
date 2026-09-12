// tools/mirror.mjs — snapshot objavljenog Webflow sajta u statički repo.
//
// Ponovljivo: pokreni ponovo poslije svake izmjene na Webflowu (dok Webflow
// još postoji) i snapshot se prepiše. Radi u tri prolaza:
//
//   1. skine HTML svih stranica iz sitemapa
//   2. nađe svaki asset na Webflow/vendor hostovima i skine ga rekurzivno
//      (CSS zna referencirati fontove i slike, pa se i CSS parsira)
//   3. prepiše sve apsolutne URL-ove u lokalne putanje
//
// Treći prolaz je globalna zamjena stringova, ne regex po atributima —
// tako se pokriju i srcset, inline style, JSON-LD i URL-ovi zapečeni u JS.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';

const ORIGIN = 'https://www.nordika-agency.com';
const OUT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Hostovi čiji sadržaj ide u repo. Sve ostalo (GTM, GA4, CookieYes, Clarity)
// ostaje udaljeno jer bez živog poziva ne funkcioniše.
const LOKALIZUJ = [
  'cdn.prod.website-files.com',
  'assets-global.website-files.com',
  'assets.website-files.com',
  'uploads-ssl.webflow.com',
  'd3e54v103j8qbb.cloudfront.net', // jQuery koji Webflow servira
  'cdnjs.cloudflare.com',          // GSAP + ScrollTrigger
  'unpkg.com',                     // split-type
  'min30327.github.io',            // luxy.js — tuđi GitHub Pages, najveći rizik
  'cdn.jsdelivr.net',              // timothydesign/scripts
  'fonts.gstatic.com',
];

const FONTOVI = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot']);

const mapa = new Map();   // originalni URL -> lokalna putanja (/css/x.css)
const enkParovi = [];     // {literal, dekodiran} za percent-enkodovane URL-ove
const obradjeno = new Set();
const greske = [];

const log = (...a) => console.log(...a);

/** Sitemap -> lista putanja stranica. */
async function putanjeStranica() {
  const xml = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
  const urlovi = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  return urlovi.map((u) => new URL(u).pathname);
}

/** /about -> about/index.html ; / -> index.html */
const htmlPutanja = (p) => (p === '/' ? 'index.html' : `${p.replace(/^\/|\/$/g, '')}/index.html`);

/**
 * Ime fajla iz URL-a, dekodirano i očišćeno. Webflow imena nose hash prefiks
 * pa su jedinstvena; percent-enkodovanje ("Asset%2025%40300x") se razrješava
 * da putanje u repou budu čitljive.
 */
// Ekstenzija po MIME tipu, za URL-ove koje je nemaju (npr. unpkg.com/split-type).
const PO_TIPU = {
  'application/javascript': '.js',
  'text/javascript': '.js',
  'application/x-javascript': '.js',
  'text/css': '.css',
  'image/svg+xml': '.svg',
  'font/woff2': '.woff2',
  'font/woff': '.woff',
};

function lokalnaPutanja(url, contentType = '') {
  const u = new URL(url);
  let ime = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'fajl');
  if (u.search) ime = `${ime.replace(/(\.[^.]+)$/, '')}-${hash(u.search)}$1`.replace('$1', extname(ime));
  ime = ime.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // Bez ekstenzije Vercel servira application/octet-stream, a uz nosniff header
  // browser odbija da izvrši takvu skriptu. Tip iz odgovora je jedini izvor.
  if (!extname(ime)) {
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (PO_TIPU[mime]) ime += PO_TIPU[mime];
  }

  const ext = extname(ime).toLowerCase();
  const dir = ext === '.css' ? 'css' : ext === '.js' ? 'js' : FONTOVI.has(ext) ? 'fonts' : 'assets';
  return `/${dir}/${ime}`;
}

const hash = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h).toString(36).slice(0, 6);
};

// Znakovi i entiteti na kojima URL uvijek završava. Zatvorena zagrada NIJE tu:
// imena assetâ je sadrže ("Shangai Nordika 2 (1).avif"), pa se broji dubina.
const GRANICA = /^(?:["'<>\\]|&quot;|&#0?39;|&apos;|[\r\n\t])/;

/**
 * Izvuče URL-ove skenirajući granicu znak po znak, jer se na ovom sajtu
 * literalni razmak pojavljuje UNUTAR imena assetâ ("Shangai Nordika 2 .avif").
 * Naivni `[^\s"']+` regex takav URL prereže na pola.
 *
 * Razmak prekida URL samo kad iza njega slijedi srcset deskriptor (`500w`),
 * novi URL, ili kraj vrijednosti. Inače je dio imena fajla.
 */
function izvuciUrlove(tekst) {
  const izvuceno = [];
  const re = /https?:\/\//g;
  let m;
  while ((m = re.exec(tekst))) {
    let i = m.index + m[0].length;
    let dubina = 0; // otvorene zagrade unutar imena fajla
    while (i < tekst.length) {
      const ostatak = tekst.slice(i);
      if (GRANICA.test(ostatak)) break;
      // Zagrada zatvara url(...) samo ako je nije otvorila sama putanja.
      if (tekst[i] === ')') {
        if (dubina === 0) break;
        dubina--;
      } else if (tekst[i] === '(') {
        dubina++;
      }
      // Lista u jednom atributu: data-video-urls="a.mp4,b.webm"
      else if (tekst[i] === ',' && /^,\s*https?:\/\//.test(ostatak)) break;
      else if (tekst[i] === ' ') {
        if (/^ +(\d+[wx](\s*[,"'<>]|\s*$)|https?:\/\/)/.test(ostatak)) break;
        if (/^ +$/.test(ostatak)) break;
      }
      i++;
    }
    izvuceno.push(tekst.slice(m.index, i).replace(/ +$/, ''));
    re.lastIndex = i;
  }
  return izvuceno;
}

/**
 * Percent-enkodovani URL-ovi. Webflow CMS repeater markup (showcase galerije
 * na project stranicama) živi enkodovan unutar <script> bloka, pa ga obični
 * skener ne vidi — te slike bi ostale visjeti na Webflow CDN-u.
 *
 * Vraća literalni enkodovani string, da zamjena u trećem prolazu ima po čemu
 * da traži; dekodirana verzija ide u red za skidanje.
 */
function nadjiEnkodovane(tekst) {
  const rez = [];
  const re = /https%3A%2F%2F/gi;
  let m;
  while ((m = re.exec(tekst))) {
    let i = m.index + m[0].length;
    while (i < tekst.length) {
      const o = tekst.slice(i);
      if (/^(?:%22|%27|%3C|%3E|%2C|["'<>\s])/i.test(o)) break;
      // %20 je razmak: prekida URL samo pred srcset deskriptorom ili novim URL-om.
      if (/^%20/i.test(o) && /^%20(?:\d+[wx](?:%2C|%22|$)|https%3A)/i.test(o)) break;
      i += /^%[0-9A-Fa-f]{2}/.test(o) ? 3 : 1;
    }
    const literal = tekst.slice(m.index, i);
    let dekodiran;
    try {
      dekodiran = decodeURIComponent(literal);
    } catch {
      re.lastIndex = i;
      continue;
    }
    if (/^https?:\/\//.test(dekodiran)) rez.push({ literal, dekodiran });
    re.lastIndex = i;
  }
  return rez;
}

/** Svi apsolutni URL-ovi na lokalizuj-hostovima koji se pojavljuju u tekstu. */
function nadjiUrlove(tekst) {
  const nadjeno = new Set();
  for (const sirovo of izvuciUrlove(tekst)) {
    const url = sirovo.replace(/&amp;/g, '&').replace(/[,;]+$/, '');
    let u;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    // Bare host bez putanje (preconnect link) nije asset.
    if (!LOKALIZUJ.includes(u.host) || u.pathname === '/' || u.pathname === '') continue;
    nadjeno.add(url);
  }
  return nadjeno;
}

/**
 * Zapamti enkodovane parove iz teksta i vrati dekodirane URL-ove za skidanje
 * (samo one na hostovima koje lokalizujemo).
 */
function prikupiEnkodovane(tekst) {
  const zaSkidanje = [];
  for (const par of nadjiEnkodovane(tekst)) {
    let u;
    try {
      u = new URL(par.dekodiran);
    } catch {
      continue;
    }
    if (!LOKALIZUJ.includes(u.host) || u.pathname === '/' || u.pathname === '') continue;
    enkParovi.push(par);
    zaSkidanje.push(par.dekodiran);
  }
  return zaSkidanje;
}

async function upisi(rel, podaci) {
  const put = join(OUT, rel);
  await mkdir(dirname(put), { recursive: true });
  await writeFile(put, podaci);
}

/** Skine jedan asset; ako je CSS, parsira ga i vraća nove URL-ove za obradu. */
async function skiniAsset(url) {
  if (obradjeno.has(url)) return [];
  obradjeno.add(url);

  const enkodovan = new URL(url).href;

  let odgovor;
  try {
    odgovor = await fetch(enkodovan, { redirect: 'follow' });
  } catch (e) {
    greske.push(`${url} — ${e.message}`);
    return [];
  }
  if (!odgovor.ok) {
    greske.push(`${url} — HTTP ${odgovor.status}`);
    return [];
  }

  // Putanja se računa poslije odgovora, jer ekstenzija može doći iz Content-Type.
  const rel = lokalnaPutanja(url, odgovor.headers.get('content-type') || '');
  const bafer = Buffer.from(await odgovor.arrayBuffer());
  await upisi(rel.slice(1), bafer);

  // Mapira se tek nakon uspješnog skidanja — neuspjeh ne smije prepisati
  // referencu u putanju fajla koji ne postoji.
  // Ključ je literalni string kakav stoji u HTML-u (razmaci i sve), jer se po
  // njemu radi zamjena. Enkodovana varijanta se upisuje kao dodatni ključ.
  mapa.set(url, rel);
  if (enkodovan !== url) mapa.set(enkodovan, rel);

  // CSS i JS mogu vući dalje assete (fontovi, slike u url(), chunk-ovi).
  const ext = extname(rel).toLowerCase();
  if (ext === '.css' || ext === '.js') {
    const tekst = bafer.toString('utf8');
    const dalje = [...nadjiUrlove(tekst)];
    dalje.push(...prikupiEnkodovane(tekst));
    // Relativni url() u CSS-u se razrješava prema originalnom URL-u.
    if (ext === '.css') {
      for (const m of tekst.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        const ref = m[1].trim();
        if (ref.startsWith('data:') || /^https?:/.test(ref)) continue;
        try {
          const abs = new URL(ref, url).href;
          if (LOKALIZUJ.includes(new URL(abs).host)) dalje.push(abs);
        } catch {}
      }
    }
    return dalje;
  }
  return [];
}

/** Globalna zamjena URL-ova lokalnim putanjama, u svakom tekstualnom fajlu. */
async function prepisi() {
  const tekstualni = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg']);
  const fajlovi = [];
  const hodaj = async (dir) => {
    for (const e of await readdir(join(OUT, dir), { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules' || e.name === 'tools') continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) await hodaj(rel);
      else if (tekstualni.has(extname(e.name).toLowerCase())) fajlovi.push(rel);
    }
  };
  await hodaj('');

  // Enkodovane reference dobijaju enkodovanu lokalnu putanju, jer se dekodiraju
  // tek u browseru kad Webflow JS ubaci markup u DOM.
  let enkMapirano = 0;
  for (const { literal, dekodiran } of enkParovi) {
    const lokal = mapa.get(dekodiran);
    if (!lokal || mapa.has(literal)) continue;
    mapa.set(literal, encodeURIComponent(lokal));
    enkMapirano++;
  }
  if (enkMapirano) log(`Enkodovanih referenci mapirano: ${enkMapirano}.`);

  // Duži URL-ovi prvi: kraći bi mogli biti prefiks dužeg i pokvariti zamjenu.
  const parovi = [...mapa.entries()].sort((a, b) => b[0].length - a[0].length);
  let ukupno = 0;

  for (const rel of fajlovi) {
    const put = join(OUT, rel);
    let tekst = await readFile(put, 'utf8');
    const prije = tekst;
    for (const [url, lokal] of parovi) {
      if (!tekst.includes(url) && !tekst.includes(url.replace(/&/g, '&amp;'))) continue;
      tekst = tekst.split(url).join(lokal);
      tekst = tekst.split(url.replace(/&/g, '&amp;')).join(lokal);
      // Percent-enkodovana varijanta istog URL-a (Webflow je koristi u src).
      const enk = encodeURI(url);
      if (enk !== url) tekst = tekst.split(enk).join(lokal);
    }
    if (tekst !== prije) {
      await writeFile(put, tekst);
      ukupno++;
    }
  }
  log(`Prepisano ${ukupno} fajlova.`);
}

async function main() {
  const putanje = await putanjeStranica();
  log(`Sitemap: ${putanje.length} stranica.`);

  // 1. HTML stranice
  const tekstovi = [];
  for (const p of putanje) {
    const url = `${ORIGIN}${p === '/' ? '' : p}`;
    const r = await fetch(url);
    if (!r.ok) {
      greske.push(`stranica ${p} — HTTP ${r.status}`);
      continue;
    }
    const html = await r.text();
    const rel = htmlPutanja(p);
    await upisi(rel, html);
    tekstovi.push(html);
    log(`  ${rel}`);
  }

  // 404 stranica: Webflow je servira sa statusom 404, sadržaj nam treba.
  const r404 = await fetch(`${ORIGIN}/404`);
  const html404 = await r404.text();
  await upisi('404.html', html404);
  tekstovi.push(html404);
  log('  404.html');

  // 2. Asseti, rekurzivno
  let red = [...new Set(tekstovi.flatMap((t) => [...nadjiUrlove(t)]))];
  for (const t of tekstovi) red.push(...prikupiEnkodovane(t));
  red = [...new Set(red)];
  if (enkParovi.length) log(`Enkodovanih referenci u CMS markupu: ${enkParovi.length}`);
  log(`\nAsseti za skidanje: ${red.length} (prvi krug)`);
  let krug = 0;
  while (red.length) {
    krug++;
    const sljedeci = [];
    for (const url of red) {
      const novi = await skiniAsset(url);
      sljedeci.push(...novi);
    }
    red = [...new Set(sljedeci)].filter((u) => !obradjeno.has(u));
    if (red.length) log(`  krug ${krug + 1}: još ${red.length}`);
    if (krug > 8) break;
  }
  log(`Skinuto ${obradjeno.size} asseta u ${krug} krugova.`);

  // 3. Prepisivanje
  await prepisi();

  if (greske.length) {
    log(`\nGreške (${greske.length}):`);
    for (const g of greske.slice(0, 40)) log(`  ${g}`);
  } else {
    log('\nBez grešaka.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
