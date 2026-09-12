// api/contact.js — prima kontakt formu i šalje mail preko Resend-a.
//
// Zamjena za Webflow form handling, koji je otišao sa Webflow hostingom.
// Polja dolaze onako kako ih forma zove ("Contact-6-First-Name"), pa se ovdje
// prevode u čitljiv mail. Checkboxovi su u FormData prisutni samo kad su
// označeni, pa se odsustvo tumači kao "nije traženo".

const PRIMA = process.env.KONTAKT_EMAIL_ZA || 'info@nordika-agency.com';
const SALJE = process.env.KONTAKT_EMAIL_OD || 'Nordika Agency <kontakt@nordika-agency.com>';

// Checkbox -> naziv usluge u mailu.
const USLUGE = {
  'Checkbox-Branding': 'Branding',
  'Checkbox-Web-Design': 'Web Design',
  'Checkbox-Data-Visualization': 'Data Visualization',
  'Checkbox-Webflow': 'Webflow',
  'Checkbox-Consultancy': 'Consultancy',
  'Checkbox-Join-the-team': 'Join the team',
};

const MAX = { ime: 256, email: 256, telefon: 64, poruka: 5000 };

// Slabo ali korisno: serverless instanca živi dovoljno dugo da uhvati
// rafal iz istog izvora. Nije zamjena za captchu, samo gasi najgrublji spam.
const skoro = new Map();
const PROZOR_MS = 60_000;
const MAX_U_PROZORU = 5;

function prebrzo(ip) {
  const sad = Date.now();
  const prosli = (skoro.get(ip) || []).filter((t) => sad - t < PROZOR_MS);
  prosli.push(sad);
  skoro.set(ip, prosli);
  if (skoro.size > 500) for (const k of skoro.keys()) if (k !== ip) skoro.delete(k);
  return prosli.length > MAX_U_PROZORU;
}

const tekst = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ greska: 'Samo POST.' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'nepoznat';

  let telo = req.body;
  if (typeof telo === 'string') {
    try {
      telo = JSON.parse(telo);
    } catch {
      return res.status(400).json({ greska: 'Neispravan JSON.' });
    }
  }
  if (!telo || typeof telo !== 'object') {
    return res.status(400).json({ greska: 'Prazan zahtjev.' });
  }

  // Honeypot: polje je skriveno u formi, čovjek ga ne može ispuniti.
  if (tekst(telo.website, 200)) {
    console.log(`[kontakt] honeypot uhvatio ${ip}`);
    return res.status(200).json({ ok: true });
  }

  const ime = tekst(telo['Contact-6-First-Name'], MAX.ime);
  const prezime = tekst(telo['Contact-6-Last-Name'], MAX.ime);
  const email = tekst(telo['Contact-6-Email'], MAX.email);
  const telefon = tekst(telo['Contact-6-Phone'], MAX.telefon);
  const poruka = tekst(telo['Contact-6-Message'], MAX.poruka);

  if (!ime || !email || !poruka) {
    return res.status(400).json({ greska: 'Ime, email i poruka su obavezni.' });
  }
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ greska: 'Email nije ispravan.' });
  }

  if (prebrzo(ip)) {
    console.log(`[kontakt] rate limit za ${ip}`);
    return res.status(429).json({ greska: 'Previše pokušaja. Probaj za minutu.' });
  }

  const trazene = Object.entries(USLUGE)
    .filter(([polje]) => {
      const v = telo[polje];
      return v === 'on' || v === 'true' || v === true;
    })
    .map(([, naziv]) => naziv);

  const kljuc = process.env.RESEND_API_KEY;
  if (!kljuc) {
    // Bez ključa nema gdje poslati. Bolje glasna greška nego tiho gubljenje leada.
    console.error('[kontakt] RESEND_API_KEY nije postavljen — prijava NIJE poslata:', {
      ime, prezime, email, telefon, trazene, poruka,
    });
    return res.status(503).json({ greska: 'Email nije podešen na serveru.' });
  }

  const punoIme = [ime, prezime].filter(Boolean).join(' ');
  const telo_maila = [
    'NOVA PRIJAVA SA KONTAKT FORME',
    '',
    `Ime:      ${punoIme}`,
    `Email:    ${email}`,
    `Telefon:  ${telefon || '—'}`,
    `Usluge:   ${trazene.length ? trazene.join(', ') : '—'}`,
    '',
    'PORUKA',
    poruka,
    '',
    '—',
    `Poslato sa https://www.nordika-agency.com/contact`,
    `IP: ${ip}`,
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${kljuc}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: SALJE,
        to: PRIMA.split(',').map((a) => a.trim()).filter(Boolean),
        reply_to: email,
        subject: `Kontakt forma — ${punoIme}${trazene.length ? ` (${trazene.join(', ')})` : ''}`,
        text: telo_maila,
      }),
    });

    if (!r.ok) {
      const detalj = await r.text();
      console.error(`[kontakt] Resend ${r.status}: ${detalj}`, { email, punoIme });
      return res.status(502).json({ greska: 'Slanje maila nije uspjelo.' });
    }
  } catch (e) {
    console.error('[kontakt] Resend nedostupan:', e.message, { email, punoIme });
    return res.status(502).json({ greska: 'Slanje maila nije uspjelo.' });
  }

  return res.status(200).json({ ok: true });
};
