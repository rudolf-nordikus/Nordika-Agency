# Migracija Nordika Agency sa Webflowa na Vercel

**Datum:** 12.09.2026.
**Status:** implementirano do DNS cutovera; cutover čeka Resend ključ.

## Cilj

Ukinuti Webflow pretplatu za `nordika-agency.com` bez gubitka sadržaja, izgleda
ili SEO pozicija. Sajt prelazi u git repo pa na Vercel.

## Odluke

| Odluka | Izabrano | Zašto ne drugo |
|---|---|---|
| Pristup | Statički snapshot objavljenog sajta | Webflow code export **ne uključuje CMS stranice** — izgubila bi se 4 posta, 5 projekata i 10 kategorija. Rebuild u Next.js je nekoliko dana rada i ne bi bio pixel-identičan. |
| Forma | Vercel funkcija + Resend | Formspree free tier je ~50/mj i nosi tuđi branding. Mailto gubi konverziju i checkboxove za usluge. |
| Cutover | Nakon verifikacije na Vercel URL-u | Webflow ostaje objavljen kao fallback dok se ne potvrdi da sve radi. |
| Anti-spam | Honeypot + rate limit | Webflow-ov Turnstile sitekey je Webflowov, ne naš. Pravi Turnstile se dodaje ako spam prođe. |

## Obim

33 HTML stranice (32 iz sitemapa + 404), 231 asset, 22 MB.

Od toga je 19 Webflow stranica, a 4 su CMS template-i čiji su itemi zapečeni:
`projects/<slug>` (5), `post/<slug>` (4), `branding/<slug>` i
`work-categories/<slug>` (po 5 kategorija).

## Arhitektura

Statički fajlovi + jedna serverless funkcija. Bez frameworka i build koraka —
Vercel servira repo kakav je.

**Folder-po-stranici** (`about/index.html`) uz `cleanUrls: true`. Time nijedno
rewrite pravilo nije potrebno, i rješava se kolizija gdje je `/branding`
istovremeno statička service stranica i baza CMS kategorija.

**Tri skripte**, svaka sa jednom svrhom, pokreću se u ovom redu:

1. `tools/mirror.mjs` — skine stranice i assete, prepiše apsolutne URL-ove u
   lokalne putanje. Tri prolaza: HTML, rekurzivno asseti (CSS vuče fontove),
   pa globalna zamjena stringova.
2. `tools/patch.mjs` — ono što kopija ne može znati: Webflow tragovi van,
   `og:image` u apsolutni URL, forma na novi endpoint.
3. `tools/sitemap.mjs` — sitemap iz stabla foldera.

Zamjena URL-ova je **globalna zamjena stringova, ne regex po atributima** —
tako se pokriju i `srcset`, inline `style`, JSON-LD i URL-ovi zapečeni u JS.

## Netrivijalni dijelovi

Tri stvari na koje naivna skripta pada, sve tri riješene u `mirror.mjs`:

- **Imena assetâ sa razmacima i zagradama** (`Shangai Nordika 2 (1).avif`,
  `Nordika bg dobra-transcode.mp4`). `[^\s"']+` ih reže. Rješenje je skener
  granice URL-a: razmak prekida URL samo pred srcset deskriptorom ili novim
  URL-om, a zatvorena zagrada samo ako je nije otvorila sama putanja.
- **Lista URL-ova u jednom atributu** (`data-video-urls="a.mp4,b.webm"` na
  pozadinskom videu početne).
- **Percent-enkodovani URL-ovi u `<script>` blokovima.** Webflow CMS repeater
  markup za showcase galerije na project stranicama živi enkodovan
  (`https%3A%2F%2F…`) i to na drugom asset bucketu
  (`64ea5271587c6d32b63dc2bc`). Te slike obični skener ne vidi — ostale bi
  visjeti na Webflow CDN-u i pukle kad se pretplata ukine. 16 referenci.

Neuspjelo skidanje **ne smije** upisati mapiranje, inače se referenca prepiše
u putanju fajla koji ne postoji. Mapa se puni tek nakon `200`.

## Kontakt forma

Webflow bundle ostaje u repou jer drži IX2 animacije i navigaciju, a u njemu je
i kod koji formu šalje na `formdata.webflow.com`. `js/kontakt.js` se zato vezuje
u **capture** fazi i zove `stopImmediatePropagation` — native capture ide prije
jQuery handlera koji Webflow veže u bubble fazi.

`api/contact.js`: validacija, honeypot (`name="website"`), rate limit, Resend.
Bez `RESEND_API_KEY` vraća 503 i loguje prijavu — glasno, da se lead ne izgubi
tiho.

## Cutover

Redoslijed, tek nakon verifikacije svih 32 URL-a na Vercel domenu:

1. `www` CNAME: `cdn.webflow.com` → Vercel target
2. apex A: `198.202.211.1` → `216.198.79.1`
3. Vercel: apex → www redirect (308)
4. Webflow ostaje objavljen kao fallback

Apex je i na Webflowu vraćao 301 na www; to se mora sačuvati. Kod
`dejanzonjic.com` je taj korak propušten i apex servira duplikat sadržaja.

## Šta se gubi

Webflow Designer. Blog i projekti se dalje uređuju kroz kod. Pri 4 posta u
godinu i po to je prihvatljivo; MDX blog bi bio odvojen projekat.

Webflow form inbox se gubi sa pretplatom — 3 postojeće prijave su arhivirane u
`docs/webflow-form-submissions.json`.
