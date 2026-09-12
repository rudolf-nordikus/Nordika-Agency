// tools/patch.mjs — post-obrada snapshota. Pokreće se POSLIJE mirror.mjs.
//
// mirror.mjs pravi vjernu kopiju; ovdje se sređuje ono što kopija ne može
// znati: da Webflow više nije u igri i da forma ima novi backend. Skripta je
// idempotentna, pa se par mirror+patch može ponavljati bez posljedica.

import { readFile, writeFile, copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';

const KORIJEN = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DOMEN = 'https://www.nordika-agency.com';

const izmjene = [];

async function sviHtml(dir = '') {
  const nadjeno = [];
  for (const e of await readdir(join(KORIJEN, dir), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tools', 'assets', 'fonts', 'docs', 'api'].includes(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) nadjeno.push(...(await sviHtml(rel)));
    else if (extname(e.name) === '.html') nadjeno.push(rel);
  }
  return nadjeno;
}

/** Tragovi Webflowa koji na statičkom sajtu ništa ne rade. */
function ocistiWebflowTragove(html) {
  return html
    .replace(/<link[^>]*href="https:\/\/cdn\.prod\.website-files\.com"[^>]*>/g, '')
    .replace(/<!--\s*This site was created in Webflow[^>]*?-->/g, '')
    .replace(/<!--\s*Last Published:[\s\S]*?-->/g, '')
    .replace(/<meta[^>]*name="generator"[^>]*>/g, '');
}

/**
 * og:image i twitter:image moraju biti apsolutni — crawleri ne razrješavaju
 * relativne putanje. mirror.mjs ih je lokalizovao u /assets/..., pa im se
 * ovdje vraća shema i domen.
 */
function apsolutniOg(html) {
  return html.replace(
    /(<meta[^>]*(?:property="og:image"|name="twitter:image")[^>]*content=")(\/[^"]*)"/g,
    (_, prefiks, putanja) => `${prefiks}${DOMEN}${putanja}"`
  ).replace(
    /(<meta[^>]*content=")(\/(?:assets|css|js|fonts)\/[^"]*)("[^>]*(?:property="og:image"|name="twitter:image")[^>]*>)/g,
    (_, a, putanja, b) => `${a}${DOMEN}${putanja}${b}`
  );
}

/** Forma prestaje biti Webflow-ova: novi endpoint, honeypot, bez Turnstile-a. */
function prevediFormu(html) {
  const m = html.match(/<form[^>]*id="wf-form-Contact-6-Form"[^>]*>/);
  if (!m) return html;

  let tag = m[0]
    .replace(/\s*data-turnstile-sitekey="[^"]*"/, '')
    .replace(/\s*redirect="[^"]*"/, '')
    .replace(/\s*data-redirect="[^"]*"/, '')
    .replace(/\s*method="[^"]*"/, '')
    .replace(/<form/, '<form method="post" action="/api/contact"');

  // Honeypot: bot puni svako polje koje nađe, čovjek ovo ne vidi.
  const honeypot =
    '<input type="text" name="website" tabindex="-1" autocomplete="off" ' +
    'aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0"/>';

  const zamjena = html.includes('name="website"') ? tag : tag + honeypot;
  return html.replace(m[0], zamjena);
}

/** Skripta koja preuzima submit od Webflow bundle-a. */
function ubaciSkriptu(html) {
  if (html.includes('/js/kontakt.js')) return html;
  return html.replace('</body>', '<script src="/js/kontakt.js" defer></script></body>');
}

async function main() {
  const fajlovi = await sviHtml();
  for (const rel of fajlovi) {
    const put = join(KORIJEN, rel);
    const prije = await readFile(put, 'utf8');
    let html = apsolutniOg(ocistiWebflowTragove(prije));
    if (rel === 'contact/index.html') html = ubaciSkriptu(prevediFormu(html));
    if (html !== prije) {
      await writeFile(put, html);
      izmjene.push(rel);
    }
  }

  await mkdir(join(KORIJEN, 'js'), { recursive: true });
  await copyFile(join(KORIJEN, 'tools/kontakt.js'), join(KORIJEN, 'js/kontakt.js'));

  console.log(`Obradjeno ${fajlovi.length} HTML fajlova, izmijenjeno ${izmjene.length}.`);
  console.log('js/kontakt.js kopiran iz tools/.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
