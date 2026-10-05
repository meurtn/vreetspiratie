import { firebaseConfig } from './firebase-config.js';

/* ================= Instellingen ================= */
const DEMO = !firebaseConfig || !firebaseConfig.apiKey || /^VUL/i.test(firebaseConfig.apiKey);
const FB_VERSIE = '10.14.1';
const STANDAARD_GROEPEN = [
  { id: 'ingredient', naam: 'Ingrediënt', tags: ['Vlees', 'Kip', 'Vis', 'Vega', 'Pasta', 'Rijst', 'Aardappel', 'Noedels'] },
  { id: 'keuken', naam: 'Land en keuken', tags: ['Hollands', 'Italiaans', 'Frans', 'Aziatisch', 'Indiaas', 'Mexicaans', 'Midden-Oosten'] },
  { id: 'soort', naam: 'Soort gerecht', tags: ['Soep', 'Ovenschotel', 'Stoofpot', 'Salade', 'Wok', 'Pizza', 'Burger'] },
  { id: 'gelegenheid', naam: 'Gelegenheid', tags: ['Snel', 'Doordeweeks', 'Weekend', 'Gasten', 'Comfortfood', 'Zomers', 'Winters'] }
];
const APP_VERSIE = '1.3';
const HH_ID = 'thuis'; // er is precies een gedeelde lijst; toegang loopt via de Firestore-regels

/* ================= Lokale opslag (alleen voorkeuren van dit apparaat) ================= */
const L = {
  get(k, d) { try { const v = localStorage.getItem('vreet.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('vreet.' + k, JSON.stringify(v)); } catch { /* vol of geblokkeerd */ } },
  del(k) { try { localStorage.removeItem('vreet.' + k); } catch { /* niets */ } }
};

const S = {
  ik: null, // 0 of 1: welke persoon bij de ingelogde gebruiker hoort
  gebruiker: null,
  namen: ['Persoon 1', 'Persoon 2'],
  groepen: null,
  filterOpen: L.get('filterOpen', false),
  gerechten: [],
  geladen: false,
  tab: 'gemaakt',
  zoek: '',
  tags: new Set(),
  sort: L.get('sort', 'score'),
  weergave: L.get('weergave', 'tegels'),
  store: null
};

/* ================= Hulpjes ================= */
const app = document.getElementById('app');
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null ? '' : n.toFixed(1).replace('.', ','));
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ander = p => (p === 0 ? 1 : 0);

function parseCijfer(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!isFinite(n)) return null;
  return Math.round(Math.min(10, Math.max(1, n)) * 10) / 10;
}

function gem(g) {
  const v = [g.scores?.p0, g.scores?.p1].filter(x => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function kleur(n) {
  if (n == null) return 'var(--lijn)';
  const t = Math.min(1, Math.max(0, (n - 5) / 5));
  return `hsl(${Math.round(4 + t * 128)} 60% ${Math.round(42 - t * 6)}%)`;
}

function wieNaam(p) { return S.namen[p] || ('Persoon ' + (p + 1)); }

function mist(g) {
  const m = [];
  if (!g.tags || !g.tags.length) m.push('tags');
  if (g.status !== 'wens') {
    for (const p of [S.ik, ander(S.ik)]) {
      if (typeof g.scores?.['p' + p] !== 'number') m.push(p === S.ik ? 'jouw cijfer' : 'cijfer ' + wieNaam(p));
    }
  }
  return m;
}

function letter(g) { return esc((g.naam || '?').trim().charAt(0).toUpperCase() || '?'); }
function fotoHtml(g) { return g.thumb ? `<img src="${g.thumb}" alt="">` : `<span class="letter">${letter(g)}</span>`; }
function cijferHtml(g, extraKlasse = '') {
  if (g.status === 'wens') return '';
  const n = gem(g);
  return n == null
    ? `<span class="cijfer leeg ${extraKlasse}">?</span>`
    : `<span class="cijfer ${extraKlasse}" style="background:${kleur(n)}">${fmt(n)}</span>`;
}

let meldTimer;
function melding(tekst) {
  let m = $('.melding');
  if (!m) { m = document.createElement('div'); m.className = 'melding'; m.setAttribute('role', 'status'); document.body.appendChild(m); }
  m.textContent = tekst;
  clearTimeout(meldTimer);
  meldTimer = setTimeout(() => m.remove(), 2600);
}

// Schrijfacties niet afwachten: Firestore toont ze direct en synct zodra er verbinding is.
function schrijf(p) {
  Promise.resolve(p).catch(e => {
    console.error(e);
    melding(e?.code === 'permission-denied' ? 'Geen toegang. Dit Google-account staat niet in de Firestore-regels.' : 'Opslaan mislukt: ' + (e?.message || e));
  });
}

/* ================= Foto's verkleinen ================= */
async function laadBeeld(file) {
  try { return await createImageBitmap(file); } catch { /* val terug op img */ }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Deze foto kan niet worden geopend.'));
    img.src = URL.createObjectURL(file);
  });
}
function naarJpeg(beeld, max, kwaliteit) {
  const w = beeld.width, h = beeld.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(beeld, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', kwaliteit);
}
async function verwerkFoto(file) {
  const b = await laadBeeld(file);
  const thumb = naarJpeg(b, 360, 0.72);
  let q = 0.8, groot = naarJpeg(b, 1200, q);
  while (groot.length > 850000 && q > 0.4) { q -= 0.1; groot = naarJpeg(b, 1200, q); }
  return { thumb, groot };
}

/* ================= Opslag: Firebase ================= */
let _fb = null;
async function fbInit() {
  if (_fb) return _fb;
  const basis = `https://www.gstatic.com/firebasejs/${FB_VERSIE}/`;
  const [fa, au, fs] = await Promise.all([
    import(basis + 'firebase-app.js'), import(basis + 'firebase-auth.js'), import(basis + 'firebase-firestore.js')
  ]);
  const fbApp = fa.initializeApp(firebaseConfig);
  const auth = au.getAuth(fbApp);
  let db;
  try {
    db = fs.initializeFirestore(fbApp, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(fbApp);
  }
  _fb = { fs, db, au, auth };
  return _fb;
}

// Wacht tot bekend is of er al iemand is ingelogd op dit apparaat (werkt ook offline).
function wachtOpGebruiker({ au, auth }) {
  return new Promise(res => { const stop = au.onAuthStateChanged(auth, u => { stop(); res(u); }); });
}

// Moet direct vanuit een tik worden aangeroepen, anders blokkeert de browser het inlogvenster.
function logIn() {
  const { au, auth } = _fb;
  const prov = new au.GoogleAuthProvider();
  prov.setCustomParameters({ prompt: 'select_account' });
  return au.signInWithPopup(auth, prov).then(r => r.user).catch(e => {
    const c = e?.code || '';
    if (c === 'auth/popup-blocked' || c === 'auth/operation-not-supported-in-this-environment') {
      return au.signInWithRedirect(auth, prov).then(() => null);
    }
    throw e;
  });
}

async function logUit() {
  try { const { au, auth } = await fbInit(); await au.signOut(auth); } catch (e) { console.error(e); }
  location.reload();
}

function firebaseStore({ fs, db }, code) {
  const hh = fs.doc(db, 'huishoudens', code);
  const col = fs.collection(db, 'huishoudens', code, 'gerechten');
  const foto = id => fs.doc(db, 'huishoudens', code, 'fotos', id);
  return {
    async haalHuishouden() { const s = await fs.getDoc(hh); return s.exists() ? s.data() : null; },
    maakHuishouden(data) { return fs.setDoc(hh, data); },
    zetHuishouden(patch) { return fs.setDoc(hh, patch, { merge: true }); },
    luisterHuishouden(cb) { return fs.onSnapshot(hh, s => cb(s.exists() ? s.data() : null), e => console.error(e)); },
    luisterGerechten(cb) {
      return fs.onSnapshot(col, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
        e => { console.error(e); e?.code === 'permission-denied' ? toonGeenToegang() : melding('Lijst laden mislukt: ' + e.message); });
    },
    nieuwId() { return fs.doc(col).id; },
    bewaar(id, patch) { return fs.setDoc(fs.doc(col, id), patch, { merge: true }); },
    async verwijder(id) { await Promise.all([fs.deleteDoc(fs.doc(col, id)), fs.deleteDoc(foto(id))]); },
    zetFoto(id, data) { return fs.setDoc(foto(id), { data }); },
    verwijderFoto(id) { return fs.deleteDoc(foto(id)); },
    async haalFoto(id) { const s = await fs.getDoc(foto(id)); return s.exists() ? s.data().data : null; }
  };
}

/* ================= Opslag: demo op dit apparaat ================= */
function demoStore(code) {
  const sleutel = 'demo.' + code;
  const data = L.get(sleutel, { hh: null, gerechten: {}, fotos: {} });
  const lh = new Set(), lg = new Set();
  const lijst = () => Object.entries(data.gerechten).map(([id, v]) => ({ id, ...v }));
  const opslaan = () => {
    L.set(sleutel, data);
    lh.forEach(f => f(data.hh));
    const l = lijst(); lg.forEach(f => f(l));
  };
  return {
    async haalHuishouden() { return data.hh; },
    async maakHuishouden(d) { data.hh = d; opslaan(); },
    async zetHuishouden(p) { data.hh = { ...data.hh, ...p }; opslaan(); },
    luisterHuishouden(cb) { lh.add(cb); queueMicrotask(() => cb(data.hh)); return () => lh.delete(cb); },
    luisterGerechten(cb) { lg.add(cb); queueMicrotask(() => cb(lijst())); return () => lg.delete(cb); },
    nieuwId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); },
    async bewaar(id, p) {
      const oud = data.gerechten[id] || {};
      data.gerechten[id] = { ...oud, ...p, scores: { ...(oud.scores || {}), ...(p.scores || {}) } };
      opslaan();
    },
    async verwijder(id) { delete data.gerechten[id]; delete data.fotos[id]; opslaan(); },
    async zetFoto(id, d) { data.fotos[id] = d; L.set(sleutel, data); },
    async verwijderFoto(id) { delete data.fotos[id]; L.set(sleutel, data); },
    async haalFoto(id) { return data.fotos[id] || null; }
  };
}

async function maakStore() { return DEMO ? demoStore(HH_ID) : firebaseStore(await fbInit(), HH_ID); }

/* ================= Vellen (pop-ups) ================= */
function openVel(html) {
  sluitVel();
  const a = document.createElement('div');
  a.className = 'vel-achter';
  a.innerHTML = `<div class="vel" role="dialog" aria-modal="true">${html}</div>`;
  a.addEventListener('click', e => { if (e.target === a) sluitVel(); });
  document.body.appendChild(a);
  document.body.style.overflow = 'hidden';
  return a.firstElementChild;
}
function sluitVel() {
  document.querySelectorAll('.vel-achter').forEach(v => v.remove());
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') sluitVel(); });
const sluitKnop = `<button class="icoonknop" data-sluit aria-label="Sluiten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
function koppelSluit(v) { v.querySelectorAll('[data-sluit]').forEach(b => b.addEventListener('click', sluitVel)); }

/* ================= Welkom en inloggen ================= */
function welkomHtml(inhoud) {
  return `
    <div class="welkom">
      <img src="icons/icon-192.png" alt="">
      <h1>Vreetspiratie</h1>
      <p>Alle gerechten die jullie ooit maakten, in één overzicht. Voor als de vraag komt: waar heb je zin in?</p>
      ${inhoud}
    </div>`;
}
const kader = tekst => `<div class="demo" style="margin:0 0 18px">${tekst}</div>`;

function toonLogin() {
  app.innerHTML = welkomHtml('<button class="knop hoofd" id="wLogin">Inloggen met Google</button>');
  $('#wLogin').onclick = e => {
    e.target.disabled = true;
    logIn().then(u => { if (u) start(); }).catch(err => {
      console.error(err);
      e.target.disabled = false;
      if (!/popup-closed|cancelled-popup/.test(err?.code || '')) melding(foutTekst(err));
    });
  };
}

function toonGeenToegang() {
  sluitVel();
  app.innerHTML = welkomHtml(kader(`${esc(S.gebruiker?.email || 'Dit account')} heeft geen toegang tot deze lijst.`) +
    '<button class="knop licht" id="wUit">Ander account kiezen</button>');
  $('#wUit').onclick = logUit;
}

function toonFout(err) {
  app.innerHTML = welkomHtml(kader(esc(foutTekst(err))) + '<button class="knop licht" id="wOpnieuw">Opnieuw proberen</button>');
  $('#wOpnieuw').onclick = () => location.reload();
}

// Koppelt de ingelogde gebruiker aan persoon 0 of 1 van de lijst. De eerste die inlogt maakt de lijst aan,
// de tweede krijgt de vrije plek. De naam komt uit het Google-account en is later aan te passen.
async function koppelPersoon() {
  const u = S.gebruiker;
  const voornaam = netjes(String(u.displayName || '').split(' ')[0]);
  const hh = await S.store.haalHuishouden();
  if (!hh) {
    await S.store.maakHuishouden({ namen: [voornaam || 'Persoon 1', 'Persoon 2'], leden: [u.uid, null], tagGroepen: STANDAARD_GROEPEN, aangemaakt: Date.now() });
    return 0;
  }
  const leden = [hh.leden?.[0] ?? null, hh.leden?.[1] ?? null];
  let p = leden.indexOf(u.uid);
  if (p < 0) {
    const oud = L.get('ik', null); // keuze uit de versie waarin je zelf een persoon koos
    p = (oud === 0 || oud === 1) && !leden[oud] ? oud : leden.indexOf(null);
    if (p < 0) throw new Error('Deze lijst is al aan twee andere accounts gekoppeld.');
    leden[p] = u.uid;
    const namen = [hh.namen?.[0] || 'Persoon 1', hh.namen?.[1] || 'Persoon 2'];
    if (voornaam && /^Persoon [12]$/.test(namen[p])) namen[p] = voornaam;
    await S.store.zetHuishouden({ leden, namen });
    L.del('ik');
  }
  return p;
}

function foutTekst(err) {
  const c = err?.code || '';
  if (c.includes('operation-not-allowed')) return 'Inloggen met Google staat uit in Firebase. Zet het aan bij Authentication.';
  if (c.includes('unauthorized-domain')) return 'Dit webadres staat nog niet bij de geautoriseerde domeinen in Firebase Authentication.';
  if (c.includes('network') || c === 'unavailable') return 'Geen verbinding. Voor de eerste keer inloggen is internet nodig.';
  if (c.includes('permission-denied')) return 'Geen toegang. Dit Google-account staat niet in de Firestore-regels.';
  return 'Er ging iets mis: ' + (err?.message || err);
}

/* ================= Hoofdscherm ================= */
const ICOON_INST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>`;
const ICOON_TEGELS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>`;
const ICOON_FILTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/></svg>`;
const ICOON_LIJST = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>`;

function bouwHoofd() {
  app.innerHTML = `
    <header class="kop">
      <div class="kop-rij">
        <h1 class="titel">Vreetspiratie</h1>
        <button class="icoonknop" id="inst" aria-label="Instellingen">${ICOON_INST}</button>
      </div>
      ${DEMO ? '<div class="demo">Demomodus: de lijst staat alleen op dit apparaat</div>' : ''}
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="gemaakt">Gerechten</button>
        <button class="tab" role="tab" data-tab="wens">Nog proberen</button>
        <button class="tab" role="tab" data-tab="open">Aanvullen<span class="teller verborgen" id="openTeller"></span></button>
      </div>
      <div id="filterdeel">
        <div class="zoekrij">
          <input class="zoek" id="zoek" type="search" placeholder="Zoeken" autocomplete="off" value="${esc(S.zoek)}">
          <select class="sorteer" id="sort" aria-label="Sorteren">
            <option value="score">Score</option>
            <option value="nieuw">Nieuwste</option>
            <option value="az">A tot Z</option>
          </select>
          <button class="icoonknop" id="filterknop" aria-label="Filteren op tags">${ICOON_FILTER}<span class="bolletje verborgen" id="filterTeller"></span></button>
          <button class="icoonknop" id="weergave" aria-label="Weergave wisselen"></button>
        </div>
        <div id="filters"></div>
      </div>
    </header>
    <main id="lijst" aria-live="polite"></main>
    <div class="onder">
      <button class="verras" id="verras">Verras ons</button>
      <button class="plus" id="plus" aria-label="Gerecht toevoegen">+</button>
    </div>`;

  $('#inst').onclick = toonInstellingen;
  app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; window.scrollTo(0, 0); updateLijst(); });
  $('#zoek').oninput = e => { S.zoek = e.target.value; updateLijst(); };
  $('#sort').value = S.sort;
  $('#sort').onchange = e => { S.sort = e.target.value; L.set('sort', S.sort); updateLijst(); };
  $('#weergave').onclick = () => { S.weergave = S.weergave === 'tegels' ? 'lijst' : 'tegels'; L.set('weergave', S.weergave); updateLijst(); };
  $('#verras').onclick = verras;
  $('#plus').onclick = () => toonBewerk(null, { status: S.tab === 'wens' ? 'wens' : 'gemaakt' });
  $('#filterknop').onclick = () => { S.filterOpen = !S.filterOpen; L.set('filterOpen', S.filterOpen); updateLijst(); };
  $('#filters').onclick = e => {
    if (e.target.closest('#naarBeheer')) return toonTagBeheer();
    const c = e.target.closest('[data-tag]');
    if (!c) return;
    const t = c.dataset.tag;
    if (t === '') S.tags.clear();
    else S.tags.has(t) ? S.tags.delete(t) : S.tags.add(t);
    updateLijst();
  };
  $('#lijst').onclick = e => {
    const el = e.target.closest('[data-id]');
    if (!el) return;
    const g = S.gerechten.find(x => x.id === el.dataset.id);
    if (!g) return;
    S.tab === 'open' ? toonBewerk(g) : toonDetail(g);
  };
  updateLijst();
}

function inTab(tab) {
  if (tab === 'open') return S.gerechten.filter(g => mist(g).length);
  return S.gerechten.filter(g => (g.status === 'wens') === (tab === 'wens'));
}

function gefilterd() {
  const z = norm(S.zoek.trim());
  let l = inTab(S.tab);
  if (S.tab === 'open') return l.sort((a, b) => (b.aangemaakt || 0) - (a.aangemaakt || 0));
  if (z) l = l.filter(g => norm(g.naam).includes(z) || (g.tags || []).some(t => norm(t).includes(z)));
  if (S.tags.size) l = l.filter(g => [...S.tags].every(t => (g.tags || []).includes(t)));
  const az = (a, b) => (a.naam || '').localeCompare(b.naam || '', 'nl');
  if (S.sort === 'az') l.sort(az);
  else if (S.sort === 'nieuw') l.sort((a, b) => (b.aangemaakt || 0) - (a.aangemaakt || 0));
  else l.sort((a, b) => ((gem(b) ?? -1) - (gem(a) ?? -1)) || az(a, b));
  return l;
}

function updateLijst() {
  const lijst = $('#lijst');
  if (!lijst) return;

  app.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const aantalOpen = inTab('open').length;
  const t = $('#openTeller');
  t.textContent = aantalOpen; t.classList.toggle('verborgen', !aantalOpen);

  const metFilters = S.tab !== 'open';
  $('#filterdeel').classList.toggle('verborgen', !metFilters);
  $('#verras').classList.toggle('verborgen', !metFilters);
  $('#weergave').innerHTML = S.weergave === 'tegels' ? ICOON_LIJST : ICOON_TEGELS;

  // Tags per categorie: alleen tags die in deze tab voorkomen (of geselecteerd zijn)
  if (metFilters) {
    const tel = telTags(inTab(S.tab));
    const chip = t => `<button class="chip" data-tag="${esc(t)}" aria-pressed="${S.tags.has(t)}">${esc(t)}<small>${tel.get(t) || 0}</small></button>`;
    let html = '';
    if (S.filterOpen) {
      html = tagGroepen(S.tags).map(gr => {
        const tags = gr.tags.filter(t => tel.get(t) || S.tags.has(t));
        return tags.length ? `<div class="filterrij"><span class="rijlabel">${esc(gr.naam)}</span><div class="chips">${tags.map(chip).join('')}</div></div>` : '';
      }).join('') || '<p class="uitleg filteruitleg">Nog geen gerechten met tags in deze lijst.</p>';
      html += `<div class="filtervoet">${S.tags.size ? '<button class="linkknop" data-tag="">Filters wissen</button>' : '<span></span>'}<button class="linkknop" id="naarBeheer">Tags beheren</button></div>`;
    } else if (S.tags.size) {
      html = `<div class="chips"><button class="chip" data-tag="">Wissen</button>${[...S.tags].map(chip).join('')}</div>`;
    }
    $('#filters').innerHTML = html;
    const ft = $('#filterTeller');
    ft.textContent = S.tags.size; ft.classList.toggle('verborgen', !S.tags.size);
    $('#filterknop').setAttribute('aria-expanded', String(S.filterOpen));
    $('#filterknop').classList.toggle('actief', S.filterOpen);
  }

  if (!S.geladen) { lijst.innerHTML = '<div class="leegte">Lijst laden...</div>'; return; }

  const l = gefilterd();
  if (!l.length) { lijst.innerHTML = leegHtml(); return; }

  if (S.tab === 'open') {
    lijst.innerHTML = `<p class="uitleg">Snel toegevoegd en nog niet compleet. Tik op een gerecht om aan te vullen.</p><div class="lijst">` +
      l.map(g => `<button class="regel" data-id="${g.id}">
        <span class="mini">${fotoHtml(g)}</span>
        <span class="wat"><span class="naam">${esc(g.naam)}</span>
        <span class="mist">${mist(g).map(m => `<span>${esc(m)}</span>`).join('')}</span></span>
      </button>`).join('') + '</div>';
    return;
  }

  if (S.weergave === 'lijst') {
    lijst.innerHTML = '<div class="lijst">' + l.map(g => `<button class="regel" data-id="${g.id}">
        <span class="mini">${fotoHtml(g)}</span>
        <span class="wat"><span class="naam">${esc(g.naam)}</span><span class="sub">${esc((g.tags || []).join(', '))}</span></span>
        ${cijferHtml(g)}
      </button>`).join('') + '</div>';
  } else {
    lijst.innerHTML = '<div class="raster">' + l.map(g => `<button class="tegel" data-id="${g.id}">
        <span class="foto">${fotoHtml(g)}</span>
        ${cijferHtml(g)}
        <span class="naam">${esc(g.naam)}</span>
      </button>`).join('') + '</div>';
  }
}

function leegHtml() {
  const alles = inTab(S.tab).length;
  if (S.tab === 'open') return '<div class="leegte"><b>Alles is ingevuld</b>Gerechten die je snel toevoegt met alleen foto en naam komen hier te staan.</div>';
  if (alles) return '<div class="leegte"><b>Niets gevonden</b>Pas de zoekterm of de tags aan.</div>';
  if (S.tab === 'wens') return '<div class="leegte"><b>Nog geen wensen</b>Zet hier gerechten die jullie nog willen proberen. Tik op +.</div>';
  return '<div class="leegte"><b>Nog geen gerechten</b>Tik op + en begin met wat jullie het laatst aten. Een foto en een naam is genoeg.</div>';
}

/* ================= Verras ons ================= */
function verras() {
  const pool = gefilterd();
  if (!pool.length) return melding('Geen gerechten om uit te kiezen');
  const v = openVel(`
    <div class="vel-kop"><h2>Wat dacht je van...</h2>${sluitKnop}</div>
    <div class="verras-kaart">
      <div class="detailfoto" id="vf"></div>
      <div class="verras-naam" id="vn"></div>
      <div id="vc"></div>
      <div class="knoppen"><button class="knop licht" id="vnog">Nog eens</button><button class="knop hoofd" id="vbek">Bekijk</button></div>
    </div>`);
  koppelSluit(v);
  const vf = $('#vf', v), vn = $('#vn', v), vc = $('#vc', v), nog = $('#vnog', v), bek = $('#vbek', v);
  let gekozen = null;
  const toon = g => {
    vf.innerHTML = fotoHtml(g);
    vn.textContent = g.naam;
    vn.classList.remove('schud'); void vn.offsetWidth; vn.classList.add('schud');
    vc.innerHTML = g.status === 'wens' ? '<span class="uitleg">Nog nooit gemaakt</span>' : cijferHtml(g, 'los');
  };
  const trek = () => {
    let kand = pool.filter(g => g !== gekozen);
    if (!kand.length) kand = pool;
    const doel = kand[Math.floor(Math.random() * kand.length)];
    const rustig = matchMedia('(prefers-reduced-motion: reduce)').matches || pool.length < 2;
    const stappen = rustig ? 0 : 9;
    let i = 0;
    nog.disabled = bek.disabled = true;
    const tik = () => {
      if (!document.body.contains(v)) return;
      if (i < stappen) { toon(pool[Math.floor(Math.random() * pool.length)]); i++; setTimeout(tik, 55 + i * 14); }
      else { gekozen = doel; toon(doel); nog.disabled = bek.disabled = false; }
    };
    tik();
  };
  nog.onclick = trek;
  bek.onclick = () => toonDetail(gekozen);
  trek();
}

/* ================= Detail ================= */
function toonDetail(g) {
  const n = gem(g);
  const wens = g.status === 'wens';
  const v = openVel(`
    <div class="vel-kop"><h2>${esc(g.naam)}</h2>${sluitKnop}</div>
    <div class="detailfoto" id="df">${fotoHtml(g)}</div>
    ${(g.tags || []).length ? `<div class="tagkeuze">${g.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
    ${wens ? '<p class="uitleg" style="margin-top:14px">Staat op de lijst om nog te proberen.</p>' : `
    <div class="scores-rij">
      ${[S.ik, ander(S.ik)].map(p => { const s = g.scores?.['p' + p]; return `<div class="scorevak"><b>${typeof s === 'number' ? fmt(s) : '?'}</b><span>${esc(wieNaam(p))}</span></div>`; }).join('')}
      <div class="scorevak gem" style="background:${kleur(n)}${n == null ? ';color:var(--zacht)' : ''}"><b>${n == null ? '?' : fmt(n)}</b><span>Gemiddeld</span></div>
    </div>`}
    <div class="knoppen">
      ${wens ? '<button class="knop mos" id="gemaakt">Gemaakt, nu beoordelen</button>' : ''}
      <button class="knop ${wens ? 'licht' : 'hoofd'}" id="bewerk">Bewerken</button>
    </div>`);
  koppelSluit(v);
  $('#bewerk', v).onclick = () => toonBewerk(g);
  if (wens) $('#gemaakt', v).onclick = () => toonBewerk(g, { status: 'gemaakt' });
  if (g.heeftFoto) {
    S.store.haalFoto(g.id).then(d => { if (d && document.body.contains(v)) $('#df', v).innerHTML = `<img src="${d}" alt="">`; }).catch(() => { /* thumbnail blijft staan */ });
  }
}

/* ================= Toevoegen en bewerken ================= */
const kloon = x => JSON.parse(JSON.stringify(x));
const nl = (a, b) => a.localeCompare(b, 'nl');
const netjes = t => { t = String(t || '').trim().replace(/\s+/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

function groepen() { return S.groepen || STANDAARD_GROEPEN; }

function telTags(lijst = S.gerechten) {
  const m = new Map();
  lijst.forEach(g => (g.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return m;
}

// Categorieën met hun tags, plus "Overig" voor tags die bij gerechten staan maar in geen categorie zitten
function tagGroepen(extra) {
  const gs = groepen();
  const ingedeeld = new Set(gs.flatMap(g => g.tags));
  const los = new Set();
  S.gerechten.forEach(g => (g.tags || []).forEach(t => { if (!ingedeeld.has(t)) los.add(t); }));
  if (extra) extra.forEach(t => { if (!ingedeeld.has(t)) los.add(t); });
  const r = gs.map(g => ({ ...g, echt: true }));
  if (los.size) r.push({ id: '_overig', naam: 'Overig', tags: [...los].sort(nl), echt: false });
  return r;
}
function alleTags() { return tagGroepen().flatMap(g => g.tags); }
function vindTag(naam) { const n = naam.toLowerCase(); return alleTags().find(x => x.toLowerCase() === n); }
function groepVan(tag) { return groepen().find(g => g.tags.includes(tag))?.id || '_overig'; }

function bewaarGroepen(gs) {
  S.groepen = gs;
  schrijf(S.store.zetHuishouden({ tagGroepen: gs }));
  updateLijst();
}

// Nieuwe tag in een categorie. Bestaat hij al zonder categorie, dan wordt hij daar ingedeeld.
function voegTagToe(naam, groepId) {
  naam = netjes(naam);
  if (!naam) return null;
  const bestaand = vindTag(naam);
  if (bestaand && groepVan(bestaand) !== '_overig') return bestaand;
  const gs = kloon(groepen());
  const doel = gs.find(g => g.id === groepId) || gs[0];
  if (!doel) { melding('Maak eerst een categorie aan'); return null; }
  doel.tags.push(bestaand || naam);
  bewaarGroepen(gs);
  return bestaand || naam;
}

// Tag hernoemen, verplaatsen (doelId) of verwijderen (nieuw = null). Geldt ook voor alle gerechten.
function pasTagAan(oud, nieuw, doelId) {
  const gs = kloon(groepen());
  const samenvoegen = nieuw && nieuw !== oud && gs.some(g => g.tags.includes(nieuw));
  let plek = null;
  for (const g of gs) {
    const i = g.tags.indexOf(oud);
    if (i < 0) continue;
    if (doelId === undefined || doelId === g.id) plek = { g, i };
    g.tags.splice(i, 1);
  }
  if (nieuw && !samenvoegen) {
    for (const g of gs) {
      const j = g.tags.indexOf(nieuw);
      if (j < 0) continue;
      g.tags.splice(j, 1);
      if (plek && plek.g === g && j < plek.i) plek.i--;
    }
    if (plek) plek.g.tags.splice(plek.i, 0, nieuw);
    else { const doel = gs.find(g => g.id === doelId); if (doel) doel.tags.push(nieuw); }
  }
  bewaarGroepen(gs);
  if (oud !== nieuw) {
    S.gerechten.filter(g => (g.tags || []).includes(oud)).forEach(g => {
      const tags = [...new Set(g.tags.map(t => (t === oud ? nieuw : t)).filter(Boolean))].sort(nl);
      schrijf(S.store.bewaar(g.id, { tags }));
    });
    if (S.tags.delete(oud) && nieuw) S.tags.add(nieuw);
  }
}

function nieuweGroep(naam) {
  naam = netjes(naam);
  if (!naam) return false;
  if (groepen().some(g => g.naam.toLowerCase() === naam.toLowerCase())) { melding('Die categorie bestaat al'); return false; }
  bewaarGroepen([...kloon(groepen()), { id: 'g' + Date.now().toString(36), naam, tags: [] }]);
  return true;
}
function verplaatsGroep(id, richting) {
  const gs = kloon(groepen());
  const i = gs.findIndex(g => g.id === id), j = i + richting;
  if (i < 0 || j < 0 || j >= gs.length) return;
  [gs[i], gs[j]] = [gs[j], gs[i]];
  bewaarGroepen(gs);
}

function toonBewerk(g, opties = {}) {
  const nieuw = !g;
  const f = {
    naam: g?.naam || '',
    tags: new Set(g?.tags || []),
    status: opties.status || g?.status || 'gemaakt',
    scores: { p0: g?.scores?.p0 ?? null, p1: g?.scores?.p1 ?? null },
    thumb: g?.thumb || null,
    groot: null,
    fotoGewijzigd: false
  };

  const v = openVel(`
    <div class="vel-kop"><h2>${nieuw ? 'Gerecht toevoegen' : 'Bewerken'}</h2>${sluitKnop}</div>
    <div class="veld">
      <button class="fotokeuze" id="fk" type="button"></button>
      <input type="file" accept="image/*" id="fi" class="verborgen">
      <div class="fotoacties" id="fa"></div>
    </div>
    <div class="veld"><label for="nm">Naam van het gerecht</label><input class="invoer" id="nm" value="${esc(f.naam)}" autocomplete="off" enterkeyhint="done"></div>
    <div class="veld"><div class="segment" id="st">
      <button type="button" data-s="gemaakt">Al gemaakt</button><button type="button" data-s="wens">Nog proberen</button>
    </div></div>
    <div class="veld"><span class="veldlabel">Tags</span><div class="tagkeuze" id="tk"></div>
      <div class="nieuwetag"><input id="nt" placeholder="Nieuwe tag" autocomplete="off" enterkeyhint="done"><select id="ntg" aria-label="Categorie"></select><button class="chip" id="ntk" type="button">Toevoegen</button></div>
    </div>
    <div class="veld" id="scorevak"><span class="veldlabel">Cijfers</span><div id="sc"></div></div>
    ${nieuw ? '<p class="uitleg">Alleen een foto en naam is ook goed. De rest vul je later aan via Aanvullen.</p>' : ''}
    <div class="knoppen">
      ${nieuw ? '' : '<button class="knop gevaar" id="weg">Verwijderen</button>'}
      <button class="knop licht" data-sluit>Annuleren</button>
      <button class="knop hoofd" id="ok">${nieuw ? 'Toevoegen' : 'Opslaan'}</button>
    </div>`);
  koppelSluit(v);

  const fk = $('#fk', v), fi = $('#fi', v), fa = $('#fa', v), nm = $('#nm', v), ok = $('#ok', v);

  const renderFoto = () => {
    fk.innerHTML = f.thumb ? `<img src="${f.groot || f.thumb}" alt="Foto van het gerecht">` : 'Foto kiezen of maken';
    fa.innerHTML = f.thumb ? '<button class="linkknop" type="button" id="fv">Andere foto</button><button class="linkknop" type="button" id="fw" style="margin-left:auto">Foto verwijderen</button>' : '';
    if (f.thumb) {
      $('#fv', v).onclick = () => fi.click();
      $('#fw', v).onclick = () => { f.thumb = null; f.groot = null; f.fotoGewijzigd = true; renderFoto(); };
    }
  };
  fk.onclick = () => fi.click();
  fi.onchange = async () => {
    const file = fi.files?.[0];
    fi.value = '';
    if (!file) return;
    fk.textContent = 'Foto verwerken...';
    try {
      const r = await verwerkFoto(file);
      f.thumb = r.thumb; f.groot = r.groot; f.fotoGewijzigd = true;
    } catch (e) { melding(e.message); }
    renderFoto();
  };
  if (!nieuw && g.heeftFoto) S.store.haalFoto(g.id).then(d => { if (d && !f.fotoGewijzigd) { f.groot = d; renderFoto(); } }).catch(() => {});

  const renderStatus = () => {
    v.querySelectorAll('[data-s]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === f.status)));
    $('#scorevak', v).classList.toggle('verborgen', f.status === 'wens');
  };
  v.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { f.status = b.dataset.s; renderStatus(); });

  const renderTags = () => {
    $('#tk', v).innerHTML = tagGroepen(f.tags).map(gr => `<div class="taggroep"><span class="groeplabel">${esc(gr.naam)}</span>
      <div class="tagkeuze">${gr.tags.map(t => `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="${f.tags.has(t)}">${esc(t)}</button>`).join('') || '<span class="uitleg" style="margin:0">Nog geen tags</span>'}</div></div>`).join('');
    const sel = $('#ntg', v), keuze = sel.value;
    sel.innerHTML = groepen().map(g => `<option value="${esc(g.id)}">${esc(g.naam)}</option>`).join('');
    if (keuze) sel.value = keuze;
  };
  $('#tk', v).onclick = e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    f.tags.has(t) ? f.tags.delete(t) : f.tags.add(t);
    b.setAttribute('aria-pressed', String(f.tags.has(t)));
  };
  const nieuweTag = () => {
    const inp = $('#nt', v);
    const t = voegTagToe(inp.value, $('#ntg', v).value);
    if (!t) return;
    f.tags.add(t); inp.value = ''; renderTags();
  };
  $('#ntk', v).onclick = nieuweTag;
  $('#nt', v).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nieuweTag(); } };

  const renderScores = () => {
    $('#sc', v).innerHTML = [S.ik, ander(S.ik)].map(p => {
      const k = 'p' + p, s = f.scores[k];
      const wie = `<span class="wie">${esc(wieNaam(p))}${p === S.ik ? ' <small>(jij)</small>' : ''}</span>`;
      if (s == null) return `<div class="score"><div class="score-kop">${wie}<button type="button" class="chip" data-geef="${k}">Cijfer geven</button></div></div>`;
      return `<div class="score" data-k="${k}">
        <div class="score-kop">${wie}
          <button type="button" class="stap" data-stap="-0.1" aria-label="Lager">&minus;</button>
          <input class="scorewaarde" inputmode="decimal" value="${fmt(s)}" aria-label="Cijfer ${esc(wieNaam(p))}">
          <button type="button" class="stap" data-stap="0.1" aria-label="Hoger">+</button>
        </div>
        <input type="range" class="schuif" min="10" max="100" step="1" value="${Math.round(s * 10)}" aria-label="Cijfer schuif">
        <button type="button" class="linkknop" data-wis="${k}">Cijfer wissen</button>
      </div>`;
    }).join('');
  };
  const sc = $('#sc', v);
  sc.onclick = e => {
    const geef = e.target.closest('[data-geef]');
    if (geef) { f.scores[geef.dataset.geef] = 7; return renderScores(); }
    const wis = e.target.closest('[data-wis]');
    if (wis) { f.scores[wis.dataset.wis] = null; return renderScores(); }
    const stap = e.target.closest('[data-stap]');
    if (stap) {
      const vak = stap.closest('[data-k]'), k = vak.dataset.k;
      f.scores[k] = parseCijfer(f.scores[k] + Number(stap.dataset.stap));
      $('.scorewaarde', vak).value = fmt(f.scores[k]);
      $('.schuif', vak).value = Math.round(f.scores[k] * 10);
    }
  };
  sc.oninput = e => {
    if (!e.target.classList.contains('schuif')) return;
    const vak = e.target.closest('[data-k]');
    f.scores[vak.dataset.k] = Number(e.target.value) / 10;
    $('.scorewaarde', vak).value = fmt(f.scores[vak.dataset.k]);
  };
  sc.onchange = e => {
    if (!e.target.classList.contains('scorewaarde')) return;
    const vak = e.target.closest('[data-k]'), k = vak.dataset.k;
    const n = parseCijfer(e.target.value);
    if (n != null) f.scores[k] = n;
    e.target.value = fmt(f.scores[k]);
    $('.schuif', vak).value = Math.round(f.scores[k] * 10);
  };
  sc.onfocusin = e => { if (e.target.classList.contains('scorewaarde')) e.target.select(); };

  const checkOk = () => { ok.disabled = !nm.value.trim(); };
  nm.oninput = checkOk;
  nm.onkeydown = e => { if (e.key === 'Enter') nm.blur(); };

  renderFoto(); renderStatus(); renderTags(); renderScores(); checkOk();

  ok.onclick = () => {
    // Een cijfer dat nog in het tekstvak staat meenemen
    sc.querySelectorAll('.scorewaarde').forEach(inp => {
      const n = parseCijfer(inp.value);
      if (n != null) f.scores[inp.closest('[data-k]').dataset.k] = n;
    });
    const naam = nm.value.trim();
    if (!naam) return;
    const id = nieuw ? S.store.nieuwId() : g.id;
    const nu = Date.now();
    const patch = { naam, tags: [...f.tags].sort((a, b) => a.localeCompare(b, 'nl')), status: f.status, gewijzigd: nu };
    if (nieuw) {
      patch.aangemaakt = nu;
      patch.scores = { p0: f.scores.p0, p1: f.scores.p1 };
      patch.thumb = f.thumb || null;
      patch.heeftFoto = !!f.groot;
    } else {
      // Alleen gewijzigde cijfers schrijven, zodat een gelijktijdige wijziging van de ander niet wordt overschreven
      const sc2 = {};
      for (const k of ['p0', 'p1']) if (f.scores[k] !== (g.scores?.[k] ?? null)) sc2[k] = f.scores[k];
      if (Object.keys(sc2).length) patch.scores = sc2;
      if (f.fotoGewijzigd) { patch.thumb = f.thumb || null; patch.heeftFoto = !!f.groot; }
    }
    schrijf(S.store.bewaar(id, patch));
    if (f.fotoGewijzigd || nieuw) {
      if (f.groot) schrijf(S.store.zetFoto(id, f.groot));
      else if (!nieuw) schrijf(S.store.verwijderFoto(id));
    }
    sluitVel();
    melding(nieuw ? 'Toegevoegd' : 'Opgeslagen');
  };

  if (!nieuw) {
    $('#weg', v).onclick = () => {
      if (!confirm(`"${g.naam}" verwijderen? Dit geldt ook voor ${wieNaam(ander(S.ik))}.`)) return;
      schrijf(S.store.verwijder(g.id));
      sluitVel();
      melding('Verwijderd');
    };
  }
}

/* ================= Instellingen ================= */
function toonInstellingen() {
  const v = openVel(`
    <div class="vel-kop"><h2>Instellingen</h2>${sluitKnop}</div>

    <div class="blok"><h3>Namen</h3>
      <div class="veld"><input class="invoer" id="in0" value="${esc(S.namen[0])}" aria-label="Naam 1"></div>
      <div class="veld"><input class="invoer" id="in1" value="${esc(S.namen[1])}" aria-label="Naam 2"></div>
      <button class="knop licht" id="namenOk" style="width:100%">Namen opslaan</button>
    </div>

    <div class="blok"><h3>Tags</h3>
      <p class="uitleg">${alleTags().length} tags in ${groepen().length} categorieën.</p>
      <button class="knop licht" id="tagbeheer" style="width:100%">Tags beheren</button>
    </div>

    <div class="blok"><h3>Back-up</h3>
      <p class="uitleg">Een bestand met alle gerechten, cijfers en foto's.</p>
      <div class="knoppen" style="margin-top:0">
        <button class="knop licht" id="exp">Back-up downloaden</button>
        <button class="knop licht" id="imp">Terugzetten</button>
      </div>
      <input type="file" id="impf" accept="application/json,.json" class="verborgen">
    </div>

    <div class="blok"><h3>Account</h3>
      <p class="uitleg">${DEMO ? 'Demomodus: de lijst staat alleen op dit apparaat.' : `Ingelogd als ${esc(S.gebruiker?.email || '')}. Alleen de Google-accounts in de Firestore-regels hebben toegang.`}</p>
      ${DEMO ? '' : '<button class="knop licht" id="uit" style="width:100%">Uitloggen</button>'}
      <p class="uitleg" style="margin:12px 0 0">Versie ${APP_VERSIE}${DEMO ? ', demomodus' : ''}</p>
    </div>`);
  koppelSluit(v);

  $('#namenOk', v).onclick = () => {
    const n = [$('#in0', v).value.trim(), $('#in1', v).value.trim()];
    if (!n[0] || !n[1]) return melding('Vul beide namen in');
    schrijf(S.store.zetHuishouden({ namen: n }));
    melding('Namen opgeslagen');
  };

  $('#tagbeheer', v).onclick = toonTagBeheer;

  $('#exp', v).onclick = e => exporteer(e.target);
  $('#imp', v).onclick = () => $('#impf', v).click();
  $('#impf', v).onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importeer(f); };

  const uit = $('#uit', v);
  if (uit) uit.onclick = () => { if (confirm('Uitloggen op dit apparaat?')) logUit(); };
}

/* ================= Tags beheren ================= */
function toonTagBeheer() {
  const v = openVel(`
    <div class="vel-kop"><h2>Tags beheren</h2>${sluitKnop}</div>
    <p class="uitleg">Tik op een tag om de naam of categorie te wijzigen. Wijzigingen gelden voor alle gerechten.</p>
    <div id="tb"></div>
    <div class="blok"><h3>Nieuwe categorie</h3>
      <div class="nieuwetag" style="margin:0"><input id="ncat" placeholder="Bijvoorbeeld Seizoen" autocomplete="off"><button class="chip" id="ncatOk" type="button">Toevoegen</button></div>
    </div>`);
  koppelSluit(v);
  const tb = $('#tb', v);
  const render = () => {
    const tel = telTags();
    const gs = tagGroepen();
    tb.innerHTML = gs.map((gr, i) => `<div class="blok" data-g="${esc(gr.id)}">
      <div class="groepkop"><h3>${esc(gr.naam)}</h3>${gr.echt ? `
        <button class="mini-knop" data-omhoog aria-label="Categorie omhoog" ${i === 0 ? 'disabled' : ''}>&#8593;</button>
        <button class="mini-knop" data-omlaag aria-label="Categorie omlaag" ${i === groepen().length - 1 ? 'disabled' : ''}>&#8595;</button>
        <button class="mini-knop" data-gwijzig>Wijzig</button>` : ''}</div>
      <div class="tagkeuze">${gr.tags.map(t => `<button class="chip" data-tb="${esc(t)}">${esc(t)}<small>${tel.get(t) || 0}</small></button>`).join('') || '<span class="uitleg" style="margin:0">Nog geen tags</span>'}</div>
      ${gr.echt
        ? `<div class="nieuwetag"><input data-nin placeholder="Nieuwe tag" autocomplete="off" enterkeyhint="done"><button class="chip" data-nok type="button">Toevoegen</button></div>`
        : '<p class="uitleg" style="margin:8px 0 0">Tags zonder categorie. Tik erop om ze in te delen.</p>'}
    </div>`).join('');
  };
  render();

  const toevoegen = blok => {
    const inp = $('[data-nin]', blok);
    const naam = netjes(inp.value);
    if (!naam) return;
    const bestaand = vindTag(naam);
    if (bestaand && groepVan(bestaand) !== '_overig') return melding(`"${bestaand}" bestaat al`);
    voegTagToe(naam, blok.dataset.g);
    render();
    $(`[data-g="${CSS.escape(blok.dataset.g)}"] [data-nin]`, tb)?.focus();
  };
  tb.onclick = e => {
    const blok = e.target.closest('[data-g]');
    if (!blok) return;
    const id = blok.dataset.g;
    if (e.target.closest('[data-tb]')) return toonTagBewerk(e.target.closest('[data-tb]').dataset.tb);
    if (e.target.closest('[data-omhoog]')) { verplaatsGroep(id, -1); return render(); }
    if (e.target.closest('[data-omlaag]')) { verplaatsGroep(id, 1); return render(); }
    if (e.target.closest('[data-gwijzig]')) return toonGroepBewerk(id);
    if (e.target.closest('[data-nok]')) toevoegen(blok);
  };
  tb.onkeydown = e => { if (e.key === 'Enter' && e.target.matches('[data-nin]')) { e.preventDefault(); toevoegen(e.target.closest('[data-g]')); } };
  const nieuweCat = () => { if (nieuweGroep($('#ncat', v).value)) { $('#ncat', v).value = ''; render(); } };
  $('#ncatOk', v).onclick = nieuweCat;
  $('#ncat', v).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); nieuweCat(); } };
}

function toonTagBewerk(tag) {
  const huidig = groepVan(tag);
  const n = telTags().get(tag) || 0;
  const v = openVel(`
    <div class="vel-kop"><h2>Tag wijzigen</h2>${sluitKnop}</div>
    <div class="veld"><label for="tn">Naam</label><input class="invoer" id="tn" value="${esc(tag)}" autocomplete="off"></div>
    <div class="veld"><label for="tg">Categorie</label>
      <select class="invoer" id="tg">${groepen().map(g => `<option value="${esc(g.id)}">${esc(g.naam)}</option>`).join('')}
        ${huidig === '_overig' ? '<option value="_overig">Geen categorie</option>' : ''}</select></div>
    <p class="uitleg">Staat bij ${n} ${n === 1 ? 'gerecht' : 'gerechten'}.</p>
    <div class="knoppen">
      <button class="knop gevaar" id="tw">Verwijderen</button>
      <button class="knop licht" id="ta">Annuleren</button>
      <button class="knop hoofd" id="to">Opslaan</button>
    </div>`);
  koppelSluit(v);
  $('#tg', v).value = huidig;
  $('#ta', v).onclick = toonTagBeheer;
  $('#to', v).onclick = () => {
    const nieuw = netjes($('#tn', v).value);
    const doel = $('#tg', v).value;
    if (!nieuw) return melding('Geef de tag een naam');
    const bestaand = vindTag(nieuw);
    if (bestaand && bestaand !== tag) {
      if (!confirm(`"${bestaand}" bestaat al. Samenvoegen? Alle gerechten met "${tag}" krijgen dan "${bestaand}".`)) return;
      pasTagAan(tag, bestaand, groepVan(bestaand));
    } else if (nieuw !== tag || doel !== huidig) {
      pasTagAan(tag, nieuw, doel);
    }
    toonTagBeheer();
  };
  $('#tw', v).onclick = () => {
    if (!confirm(n ? `"${tag}" verwijderen? De tag verdwijnt ook bij ${n} ${n === 1 ? 'gerecht' : 'gerechten'}.` : `"${tag}" verwijderen?`)) return;
    pasTagAan(tag, null);
    toonTagBeheer();
  };
}

function toonGroepBewerk(id) {
  const gr = groepen().find(g => g.id === id);
  if (!gr) return toonTagBeheer();
  const v = openVel(`
    <div class="vel-kop"><h2>Categorie wijzigen</h2>${sluitKnop}</div>
    <div class="veld"><label for="gn">Naam</label><input class="invoer" id="gn" value="${esc(gr.naam)}" autocomplete="off"></div>
    <p class="uitleg">Bij verwijderen blijven de tags bij de gerechten staan, onder Overig. Tags die nergens gebruikt worden verdwijnen.</p>
    <div class="knoppen">
      <button class="knop gevaar" id="gw">Verwijderen</button>
      <button class="knop licht" id="ga">Annuleren</button>
      <button class="knop hoofd" id="go">Opslaan</button>
    </div>`);
  koppelSluit(v);
  $('#ga', v).onclick = toonTagBeheer;
  $('#go', v).onclick = () => {
    const naam = netjes($('#gn', v).value);
    if (!naam) return melding('Geef de categorie een naam');
    if (groepen().some(g => g.id !== id && g.naam.toLowerCase() === naam.toLowerCase())) return melding('Die categorie bestaat al');
    bewaarGroepen(kloon(groepen()).map(g => (g.id === id ? { ...g, naam } : g)));
    toonTagBeheer();
  };
  $('#gw', v).onclick = () => {
    if (!confirm(`Categorie "${gr.naam}" verwijderen?`)) return;
    bewaarGroepen(kloon(groepen()).filter(g => g.id !== id));
    toonTagBeheer();
  };
}

async function exporteer(knop) {
  knop.disabled = true; knop.textContent = 'Bezig...';
  try {
    const gerechten = [];
    for (const g of S.gerechten) {
      let foto = null;
      if (g.heeftFoto) { try { foto = await S.store.haalFoto(g.id); } catch { /* zonder foto */ } }
      gerechten.push({ ...g, foto });
    }
    const data = { app: 'Vreetspiratie', versie: 1, gemaakt: new Date().toISOString(), namen: S.namen, tagGroepen: groepen(), gerechten };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `vreetspiratie-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { melding('Back-up mislukt: ' + e.message); }
  knop.disabled = false; knop.textContent = 'Back-up downloaden';
}

async function importeer(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return melding('Dit is geen geldig back-upbestand'); }
  if (!Array.isArray(data?.gerechten)) return melding('Dit is geen geldig back-upbestand');
  if (!confirm(`${data.gerechten.length} gerechten terugzetten? Gerechten met hetzelfde id worden overschreven.`)) return;
  for (const x of data.gerechten) {
    const { id, foto, ...rest } = x;
    if (typeof rest.naam !== 'string') continue;
    const nid = id || S.store.nieuwId();
    schrijf(S.store.bewaar(nid, rest));
    if (foto) schrijf(S.store.zetFoto(nid, foto));
  }
  if (Array.isArray(data.tagGroepen)) {
    const gs = kloon(groepen());
    for (const ig of data.tagGroepen) {
      if (!ig || typeof ig.naam !== 'string' || !Array.isArray(ig.tags)) continue;
      let g = gs.find(x => x.naam.toLowerCase() === ig.naam.toLowerCase());
      if (!g) { g = { id: ig.id && !gs.some(x => x.id === ig.id) ? ig.id : 'g' + Math.random().toString(36).slice(2, 9), naam: ig.naam, tags: [] }; gs.push(g); }
      ig.tags.forEach(t => { if (typeof t === 'string' && !gs.some(x => x.tags.includes(t))) g.tags.push(t); });
    }
    bewaarGroepen(gs);
  }
  sluitVel();
  melding('Back-up teruggezet');
}

/* ================= Start ================= */
async function start() {
  try {
    if (DEMO) S.gebruiker = { uid: 'demo', displayName: '', email: '' };
    else {
      const fb = await fbInit();
      S.gebruiker = await wachtOpGebruiker(fb);
      if (!S.gebruiker) return toonLogin();
    }
    if (!S.store) S.store = await maakStore();
    // De koppeling per account onthouden, zodat de app ook zonder verbinding start.
    const sleutel = 'ik.' + S.gebruiker.uid;
    S.ik = L.get(sleutel, null);
    if (S.ik !== 0 && S.ik !== 1) { S.ik = await koppelPersoon(); L.set(sleutel, S.ik); }
  } catch (e) {
    console.error(e);
    return (e?.code || '').includes('permission-denied') ? toonGeenToegang() : toonFout(e);
  }
  bouwHoofd();
  S.store.luisterHuishouden(hh => {
    if (!hh) return;
    if (Array.isArray(hh.namen)) S.namen = hh.namen;
    if (Array.isArray(hh.tagGroepen)) S.groepen = hh.tagGroepen;
    updateLijst();
  });
  S.store.luisterGerechten(lijst => { S.gerechten = lijst; S.geladen = true; updateLijst(); });
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker niet geregistreerd', e));
}
start();
