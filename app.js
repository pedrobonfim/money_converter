'use strict';

const LOCALE = 'pt-BR';
const STORAGE_KEY = 'money-converter:v1';
const MAX_AGE_MS = 60 * 60 * 1000; // busca novas cotações se as salvas tiverem mais de 1h
const DEFAULT_FAVORITES = ['BRL', 'USD', 'EUR', 'JPY'];

// Fontes gratuitas, sem chave de API. Ambas retornam cotações com base em USD.
const SOURCES = [
  {
    url: 'https://open.er-api.com/v6/latest/USD',
    parse(data) {
      if (data.result !== 'success') throw new Error('resposta inválida');
      return { rates: data.rates, date: data.time_last_update_unix * 1000 };
    },
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    parse(data) {
      const rates = {};
      for (const [code, value] of Object.entries(data.usd)) rates[code.toUpperCase()] = value;
      return { rates, date: Date.parse(data.date) };
    },
  },
];

const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};

const $ = (sel) => document.querySelector(sel);
const els = {
  list: $('#list'),
  status: $('#status'),
  empty: $('#empty'),
  clear: $('#btn-clear'),
  refresh: $('#btn-refresh'),
  manage: $('#manage'),
  search: $('#search'),
  all: $('#all'),
};

// ---------- Estado ----------

const state = {
  favorites: DEFAULT_FAVORITES.slice(),
  rates: null, // { CODE: unidades da moeda por 1 USD }
  ratesDate: 0, // data da cotação informada pela fonte
  fetchedAt: 0, // quando o app buscou
  active: null, // moeda em que o usuário digitou
  text: '', // texto digitado
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) Object.assign(state, saved);
  } catch { /* sem armazenamento: segue com os padrões */ }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignora */ }
}

// ---------- Moedas ----------

const displayNames = (() => {
  try { return new Intl.DisplayNames([LOCALE], { type: 'currency' }); } catch { return null; }
})();

const knownCurrencies = (() => {
  try { return new Set(Intl.supportedValuesOf('currency')); } catch { return null; }
})();

function currencyName(code) {
  const name = displayNames?.of(code);
  if (!name || name === code) return code;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Moedas cujo código não começa pelo país "certo".
const FLAG_OVERRIDES = { EUR: 'EU', ANG: 'CW', XCD: 'AG', XAF: 'CM', XOF: 'SN', XPF: 'PF' };

function flag(code) {
  const country = FLAG_OVERRIDES[code] || (code.startsWith('X') ? null : code.slice(0, 2));
  if (!country) return '💱';
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const symbolCache = {};
function symbol(code) {
  if (!(code in symbolCache)) {
    try {
      const parts = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0);
      const sym = parts.find((p) => p.type === 'currency')?.value || '';
      symbolCache[code] = sym === code ? '' : sym;
    } catch {
      symbolCache[code] = '';
    }
  }
  return symbolCache[code];
}

const digitsCache = {};
function currencyDigits(code) {
  if (!(code in digitsCache)) {
    try {
      digitsCache[code] = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
    } catch {
      digitsCache[code] = 2;
    }
  }
  return digitsCache[code];
}

function availableCodes() {
  if (!state.rates) return state.favorites.slice();
  return Object.keys(state.rates).filter((c) => /^[A-Z]{3}$/.test(c) && (!knownCurrencies || knownCurrencies.has(c)));
}

// ---------- Números ----------

// Aceita "1.234,56", "1234,56" e "1234.56".
function parseAmount(text) {
  let s = text.replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thousands = dec === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : parts.join('.');
  } else if (lastDot >= 0 && s.split('.').length > 2) {
    s = s.split('.').join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// `digits`: casas decimais para valores >= 1 (padrão: as da própria moeda, ex. JPY = 0).
function formatAmount(value, code, digits = currencyDigits(code)) {
  const abs = Math.abs(value);
  const opts = abs > 0 && abs < 1
    ? { maximumSignificantDigits: 4 }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits };
  return new Intl.NumberFormat(LOCALE, opts).format(value);
}

function convert(amount, from, to) {
  return (amount / state.rates[from]) * state.rates[to];
}

// ---------- Tela principal ----------

function renderList() {
  els.list.innerHTML = '';
  const favorites = state.favorites.filter((c) => !state.rates || c in state.rates);
  els.empty.hidden = favorites.length > 0;

  for (const code of favorites) {
    const li = document.createElement('li');
    li.className = 'row';
    li.dataset.code = code;
    li.innerHTML = `
      <span class="flag" aria-hidden="true">${flag(code)}</span>
      <div class="info">
        <div><span class="code">${code}</span><span class="name">${currencyName(code)}</span></div>
        <div class="rate"></div>
      </div>
      <label class="amount">
        <span class="symbol">${symbol(code)}</span>
        <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
               placeholder="0" aria-label="Valor em ${currencyName(code)}">
      </label>`;
    const input = li.querySelector('input');
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      state.active = code;
      state.text = input.value;
      updateValues();
      save();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    li.addEventListener('click', (e) => { if (e.target === li || !e.target.closest('input')) input.focus(); });
    els.list.appendChild(li);
  }
  updateValues();
}

function updateValues() {
  const rows = [...els.list.children];
  const amount = state.active ? parseAmount(state.text) : null;
  const hasActive = state.active && rows.some((r) => r.dataset.code === state.active);
  const ref = hasActive ? state.active : rows[0]?.dataset.code;

  for (const row of rows) {
    const code = row.dataset.code;
    const input = row.querySelector('input');
    const isActive = hasActive && code === state.active;
    row.classList.toggle('active', isActive);

    if (isActive) {
      if (input.value !== state.text) input.value = state.text;
    } else if (amount !== null && state.rates && hasActive) {
      input.value = formatAmount(convert(amount, state.active, code), code);
    } else {
      input.value = '';
    }

    const rateEl = row.querySelector('.rate');
    if (state.rates && ref && code !== ref) {
      rateEl.textContent = `1 ${ref} = ${formatAmount(convert(1, ref, code), code, 2)} ${code}`;
    } else {
      rateEl.textContent = '';
    }
  }
  els.clear.hidden = !(hasActive && state.text);
}

// ---------- Cotações ----------

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle('error', isError);
}

function describeDate() {
  if (!state.ratesDate) return '';
  const d = new Date(state.ratesDate);
  return d.toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchRates() {
  let lastError;
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return source.parse(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function refreshRates(force = false) {
  if (!force && state.rates && Date.now() - state.fetchedAt < MAX_AGE_MS) {
    setStatus(`Cotações de ${describeDate()}`);
    return;
  }
  els.refresh.classList.add('spinning');
  if (!state.rates) setStatus('Carregando cotações…');
  try {
    const { rates, date } = await fetchRates();
    state.rates = rates;
    state.ratesDate = date || Date.now();
    state.fetchedAt = Date.now();
    save();
    renderList();
    setStatus(`Cotações de ${describeDate()}`);
  } catch {
    if (state.rates) {
      setStatus(`Sem conexão — usando cotações de ${describeDate()}`, true);
    } else {
      setStatus('Não foi possível carregar as cotações. Verifique sua conexão.', true);
    }
  } finally {
    els.refresh.classList.remove('spinning');
  }
}

// ---------- Escolher moedas ----------

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function renderManage() {
  const query = normalize(els.search.value.trim());
  const matches = (code) => !query || normalize(code).includes(query) || normalize(currencyName(code)).includes(query);
  const favorites = state.favorites.filter(matches);
  const others = availableCodes()
    .filter((c) => !state.favorites.includes(c) && matches(c))
    .sort((a, b) => currencyName(a).localeCompare(currencyName(b), LOCALE));

  els.all.innerHTML = '';
  const section = (title) => {
    const li = document.createElement('li');
    li.className = 'section';
    li.textContent = title;
    els.all.appendChild(li);
  };
  const item = (code, isFav) => {
    const li = document.createElement('li');
    li.className = 'item';
    const idx = state.favorites.indexOf(code);
    li.innerHTML = `
      <span class="flag" aria-hidden="true">${flag(code)}</span>
      <span class="label"><span class="code">${code}</span><span class="name">${currencyName(code)}</span></span>
      ${isFav && !query ? `
        <button type="button" data-act="up" aria-label="Mover para cima" ${idx === 0 ? 'disabled' : ''}>${ICONS.up}</button>
        <button type="button" data-act="down" aria-label="Mover para baixo" ${idx === state.favorites.length - 1 ? 'disabled' : ''}>${ICONS.down}</button>` : ''}
      <button type="button" data-act="star" class="star ${isFav ? 'on' : ''}"
              aria-label="${isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-pressed="${isFav}">${ICONS.star}</button>`;
    li.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (act) onManageAction(code, act);
    });
    els.all.appendChild(li);
  };

  if (favorites.length) {
    section('Favoritas');
    favorites.forEach((c) => item(c, true));
  }
  if (others.length) {
    section('Todas as moedas');
    others.forEach((c) => item(c, false));
  }
}

function onManageAction(code, act) {
  const favs = state.favorites;
  const i = favs.indexOf(code);
  if (act === 'star') {
    if (i >= 0) favs.splice(i, 1);
    else favs.push(code);
  } else if (act === 'up' && i > 0) {
    [favs[i - 1], favs[i]] = [favs[i], favs[i - 1]];
  } else if (act === 'down' && i >= 0 && i < favs.length - 1) {
    [favs[i + 1], favs[i]] = [favs[i], favs[i + 1]];
  }
  save();
  renderManage();
  renderList();
}

function openManage() {
  els.search.value = '';
  renderManage();
  els.manage.showModal();
  els.all.scrollTop = 0;
}

// ---------- Início ----------

load();
renderList();
refreshRates();

els.refresh.addEventListener('click', () => refreshRates(true));
$('#btn-manage').addEventListener('click', openManage);
$('#btn-empty-manage').addEventListener('click', openManage);
$('#btn-close').addEventListener('click', () => els.manage.close());
els.manage.addEventListener('click', (e) => { if (e.target === els.manage) els.manage.close(); });
els.search.addEventListener('input', renderManage);
els.clear.addEventListener('click', () => {
  state.text = '';
  state.active = null;
  save();
  updateValues();
});

// Atualiza ao voltar para o app (ex.: reabrindo pela tela inicial).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRates();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
