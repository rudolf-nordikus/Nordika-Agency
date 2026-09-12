// tools/check-live.mjs — provjerava deployment: svaka stranica iz sitemapa i
// svaki asset iz repoa moraju se servirati sa 200 i ispravnim Content-Type-om.
//
// Upotreba:  node tools/check-live.mjs https://nordika-agency.vercel.app
//
// tools/verify.mjs provjerava da reference postoje NA DISKU; ovo provjerava da
// ih server zaista servira. Dvije različite greške, dvije skripte.

import { readdir, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const KORIJEN = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BAZA = (process.argv[2] || '').replace(/\/$/, '');
if (!BAZA) {
  console.error('Upotreba: node tools/check-live.mjs <base-url>');
  process.exit(1);
}

const ISPRAVAN_TIP = {
  '.js': /javascript|ecmascript/i,
  '.css': /text\/css/i,
  '.avif': /image\/avif/i,
  '.png': /image\/png/i,
  '.svg': /image\/svg/i,
  '.woff2': /font\/woff2|application\/font-woff2/i,
  '.mp4': /video\/mp4/i,
  '.webm': /video\/webm/i,
};

async function assetiNaDisku() {
  const nadjeno = [];
  for (const dir of ['assets', 'css', 'js', 'fonts']) {
    let unosi;
    try {
      unosi = await readdir(join(KORIJEN, dir));
    } catch {
      continue;
    }
    for (const ime of unosi) nadjeno.push(`/${dir}/${ime}`);
  }
  return nadjeno;
}

async function stranice() {
  const xml = await readFile(join(KORIJEN, 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

/** Provjerava jedan URL; vraća opis problema ili null. */
async function provjeri(putanja, ocekivaniTip) {
  const url = BAZA + encodeURI(putanja);
  let r;
  try {
    r = await fetch(url, { redirect: 'manual' });
  } catch (e) {
    return `${putanja} — zahtjev pao: ${e.message}`;
  }
  if (r.status !== 200) return `${putanja} — HTTP ${r.status}`;
  if (ocekivaniTip) {
    const tip = r.headers.get('content-type') || '';
    if (!ocekivaniTip.test(tip)) return `${putanja} — Content-Type "${tip}"`;
  }
  return null;
}

/** Pušta provjere u grupama, da se ne otvori 260 konekcija odjednom. */
async function uGrupama(poslovi, koliko = 12) {
  const problemi = [];
  for (let i = 0; i < poslovi.length; i += koliko) {
    const rez = await Promise.all(poslovi.slice(i, i + koliko).map((f) => f()));
    problemi.push(...rez.filter(Boolean));
  }
  return problemi;
}

async function main() {
  const putanjeStranica = await stranice();
  const putanjeAsseta = await assetiNaDisku();

  console.log(`Baza: ${BAZA}`);
  console.log(`Provjeravam ${putanjeStranica.length} stranica i ${putanjeAsseta.length} asseta…\n`);

  const problemiStranica = await uGrupama(
    putanjeStranica.map((p) => () => provjeri(p === '' ? '/' : p, /text\/html/i))
  );
  const problemiAsseta = await uGrupama(
    putanjeAsseta.map((p) => () => provjeri(p, ISPRAVAN_TIP[extname(p).toLowerCase()]))
  );

  // 404 mora biti 404, ne 200 sa praznom stranicom.
  const r404 = await fetch(`${BAZA}/ovo-ne-postoji-${Date.now()}`, { redirect: 'manual' });

  console.log(`Stranice:  ${putanjeStranica.length - problemiStranica.length}/${putanjeStranica.length} OK`);
  console.log(`Asseti:    ${putanjeAsseta.length - problemiAsseta.length}/${putanjeAsseta.length} OK`);
  console.log(`404 ruta:  ${r404.status}${r404.status === 404 ? ' OK' : ' — TREBA 404'}`);

  const svi = [...problemiStranica, ...problemiAsseta];
  if (svi.length) {
    console.log(`\nProblemi (${svi.length}):`);
    for (const p of svi.slice(0, 40)) console.log(`  ${p}`);
  }

  if (svi.length || r404.status !== 404) process.exit(1);
  console.log('\nSve prolazi.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
