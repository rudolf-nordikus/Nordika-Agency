# Nordika Agency

Statička kopija `www.nordika-agency.com`, migrirana sa Webflow hostinga na Vercel.
Sadržaj je zapečen u HTML u trenutku snapshota — Webflow CMS (blog postovi,
projekti, kategorije) više nije živ izvor. Izmjene idu kroz kod.

## Šta je gdje

```
index.html                  početna
about/ contact/ blog/ …     statičke stranice, folder-po-stranici
projects/<slug>/            5 projekata (bili Webflow CMS)
post/<slug>/                4 blog posta (bili Webflow CMS)
branding/<slug>/            kategorije bloga
work-categories/<slug>/     kategorije projekata
404.html                    Vercel je servira automatski

api/contact.js              kontakt forma -> Resend
assets/ css/ js/ fonts/     231 asseta, sve lokalno
tools/                      skripte za snapshot i obradu
docs/                       arhiva Webflow prijava + spec
```

Folder-po-stranici je odabran namjerno: uz `cleanUrls` u `vercel.json`,
`/about` se sam razrješava na `/about/index.html` i ne treba ni jedno rewrite
pravilo. Isto rješava i koliziju gdje je `/branding` istovremeno statička
stranica i baza CMS kategorija (`/branding/all` i ostale).

## Ponovni snapshot

Dok Webflow projekat još postoji, snapshot se može ponoviti:

```bash
node tools/mirror.mjs     # skine sve stranice i assete, prepiše URL-ove
node tools/patch.mjs      # očisti Webflow tragove, presloži formu
node tools/sitemap.mjs    # regeneriše sitemap.xml iz stabla foldera
```

Redoslijed je obavezan — `patch.mjs` radi nad izlazom `mirror.mjs`, a
`mirror.mjs` prepisuje HTML pa bi pregazio patch.

Poslije ukidanja Webflow pretplate `mirror.mjs` više nema odakle da skida.
Tada je repo jedini izvor.

## Kontakt forma

Webflow form handling je otišao sa hostingom. Zamjena:

- `js/kontakt.js` (izvor: `tools/kontakt.js`) presreće submit u **capture**
  fazi i zove `stopImmediatePropagation`. Webflow bundle je ostao u repou jer
  drži IX2 animacije i navigaciju, a u njemu je i kod koji bi formu poslao na
  `formdata.webflow.com` — capture slušalac ide prije njegovog jQuery handlera.
- `api/contact.js` validira, hvata honeypot (`name="website"`), primjenjuje
  grubi rate limit i šalje mail preko Resend REST API-ja.
- Uspjeh redirektuje na `/thank-you`, isto kao prije.

Webflow-ov Turnstile je izbačen — sitekey je bio Webflowov, ne naš. Ako spam
postane problem, dodati pravi Turnstile (2 od 3 arhivirane prijave su spam).

### Env varijable

Postavljaju se u Vercel → Settings → Environment Variables:

| Varijabla | Vrijednost |
|---|---|
| `RESEND_API_KEY` | ključ iz Resend dashboarda |
| `KONTAKT_EMAIL_ZA` | `info@nordika-agency.com` |
| `KONTAKT_EMAIL_OD` | `Nordika Agency <kontakt@nordika-agency.com>` |

Domen u `KONTAKT_EMAIL_OD` **mora biti verifikovan u Resendu**, inače Resend
odbija slanje. Bez `RESEND_API_KEY` funkcija vraća 503 i loguje prijavu u
Vercel logove — namjerno glasno, da se lead ne izgubi tiho.

## Deploy

Push na `main` je produkcija. Svaka druga grana dobija preview URL.

Vercel projekat: `nordika-agency` (team `team_2JmhoyCWhqEw3psBJpqDITOM`, Hobby).
Produkcijski alias: `https://nordika-agency.vercel.app`.

### Provjera deploymenta

```bash
node tools/verify.mjs                                    # reference postoje na disku
node tools/check-live.mjs https://nordika-agency.vercel.app   # server ih zaista servira
```

## DNS — cutover je urađen 12.09.2026.

Sajt je živ na Vercelu. Zapisi na GoDaddyju (nameserveri
`ns31/ns32.domaincontrol.com` ostali gdje su):

| Zapis | Bilo (Webflow) | Sada (Vercel) |
|---|---|---|
| `nordika-agency.com` A | `198.202.211.1` | `216.198.79.1` |
| `www` CNAME | `cdn.webflow.com` | `cname.vercel-dns.com` |

Apex je u Vercelu postavljen kao **308 redirect na www** — isto ponašanje kao
na Webflowu, gdje je vraćao 301.

Zoho ostaje netaknut: MX i dalje `mx.zoho.eu`, korijenski SPF `include:zoho.eu`.

> Vercel CLI (`vercel domains inspect`) preporučuje stari `76.76.21.21`;
> dashboard traži `216.198.79.1`. Oba rade, ali dashboard je tačniji — CLI
> zaostaje za proširenim IP opsegom.

## Šta je ostalo eksterno

Namjerno, jer bez živog poziva ne rade: Google Tag Manager (`GTM-KTVCXRL8`),
GA4 (`G-DNR5M8GTTG`), CookieYes, Microsoft Clarity.

Sve ostalo je povučeno lokalno, uključujući GSAP, split-type, jQuery i
**luxy.js — koji se prije vukao sa `min30327.github.io`**, tuđeg GitHub Pages
računa. To je bila jedina zavisnost sajta od repoa nepoznate osobe.

## Poznate stvari

- `og:image` je `.avif`. Facebook i LinkedIn to slabo podržavaju, ali je bilo isto i
  na Webflowu — nije regresija. Ako se ikad dira social preview, konvertovati
  u `.jpg`.
- Showcase galerije na project stranicama drže slike **percent-enkodovane
  unutar `<script>` bloka** (Webflow CMS repeater markup). `mirror.mjs` ih
  hvata posebnom rutinom; ako se ikad piše nova skripta za obradu, to je mjesto
  gdje se najlakše promaši.
- Imena Webflow assetâ sadrže literalne razmake i zagrade
  (`Shangai Nordika 2 (1).avif`). Naivni `[^\s"']+` regex ih reže na pola —
  zato `mirror.mjs` skenira granicu URL-a znak po znak.
- Apex `nordika-agency.com` mora ostati 301/308 na `www` — tako je bilo na
  Webflowu i canonical se na to oslanja.
- `luxy.js` baca `TypeError: Cannot read properties of null (reading
  'clientHeight')` na stranicama bez `#luxy` wrappera (contact, project
  stranice). **To nije regresija** — identična greška postoji i na živom
  Webflow sajtu, provjereno u konzoli. Smooth scroll radi tamo gdje wrapper
  postoji. Ako se ikad čisti, uslovno pozvati `luxy.init()`.
