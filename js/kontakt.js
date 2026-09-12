// js/kontakt.js — preuzima kontakt formu od Webflow-ovog handlera.
//
// Webflow-ov bundle je ostao u repou (potreban je za IX2 animacije, nav i
// tabove), a u njemu je i kod koji formu šalje na formdata.webflow.com. Zato
// se slušalac vezuje u CAPTURE fazi i zove stopImmediatePropagation: native
// capture ide prije jQuery handlera koji Webflow veže u bubble fazi.
//
// Izvor je tools/kontakt.js; tools/patch.mjs ga kopira u js/ poslije snapshota.
(function () {
  'use strict';

  var forma = document.getElementById('wf-form-Contact-6-Form');
  if (!forma) return;

  var blok = forma.closest('.w-form') || forma.parentNode;
  var uspjeh = blok.querySelector('.w-form-done');
  var greska = blok.querySelector('.w-form-fail');
  var dugme = forma.querySelector('input[type="submit"], button[type="submit"]');
  var tekstDugmeta = dugme ? dugme.value || dugme.textContent : '';
  var cekanje = dugme ? dugme.getAttribute('data-wait') || 'Please wait...' : '';
  var uToku = false;

  forma.addEventListener(
    'submit',
    function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!uToku) posalji();
    },
    true
  );

  function prikazi(el) {
    if (el) el.style.display = 'block';
  }

  function sakrij(el) {
    if (el) el.style.display = 'none';
  }

  function zakljucaj(zakljucano) {
    uToku = zakljucano;
    if (!dugme) return;
    dugme.disabled = zakljucano;
    var t = zakljucano ? cekanje : tekstDugmeta;
    if ('value' in dugme) dugme.value = t;
    else dugme.textContent = t;
  }

  function posalji() {
    sakrij(greska);
    sakrij(uspjeh);
    zakljucaj(true);

    var podaci = {};
    new FormData(forma).forEach(function (v, k) {
      podaci[k] = typeof v === 'string' ? v : '';
    });

    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(podaci),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        // Isto ponašanje kao Webflow: redirect na /thank-you.
        window.location.href = '/thank-you';
      })
      .catch(function (err) {
        console.error('[kontakt] slanje nije uspjelo:', err);
        zakljucaj(false);
        prikazi(greska);
      });
  }
})();
