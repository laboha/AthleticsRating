'use strict';

// Сайт только показывает данные из data/data.json. Никаких форм и записи — изменить что-либо
// можно только в приложении, которое публикует этот файл в репозиторий.

const AGE_GROUPS = [
  { id: 'U14', label: 'до 14', min: 0, max: 13 },
  { id: 'U16', label: 'до 16', min: 14, max: 15 },
  { id: 'U18', label: 'до 18', min: 16, max: 17 },
  { id: 'U20', label: 'до 20', min: 18, max: 19 },
  { id: 'U23', label: 'до 23', min: 20, max: 22 },
  { id: 'SENIOR', label: 'Взрослые', min: 23, max: 200 }
];

const state = { lastTab: 'rating', data: null, events: new Map(), athletes: new Map(), byAthlete: new Map() };
const $ = (id) => document.getElementById(id);
const thisYear = new Date().getFullYear();

// ---------- утилиты ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е').trim(); }
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
function ageGroupOf(age) { return AGE_GROUPS.find((g) => age >= g.min && age <= g.max) || AGE_GROUPS[AGE_GROUPS.length - 1]; }
function yearsWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
// Даты результатов хранятся как полночь по UTC
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const stampFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function avatar(a, big) {
  const cls = big ? 'avatar big' : 'avatar';
  if (a.photo) {
    return `<div class="${cls}"><img src="${esc(a.photo)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${esc(initials(a.name))}'"></div>`;
  }
  return `<div class="${cls}" aria-hidden="true">${esc(initials(a.name))}</div>`;
}

/** Лучший по очкам результат; при равенстве — более ранний. */
function best(results, eventId) {
  let top = null;
  for (const r of results) {
    if (eventId && r.eventId !== eventId) continue;
    if (!top || r.points > top.points || (r.points === top.points && r.date < top.date)) top = r;
  }
  return top;
}

// ---------- данные ----------

async function load() {
  try {
    const res = await fetch('data/data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.data = data;
    data.events.forEach((e) => state.events.set(e.id, e));
    data.athletes.forEach((a) => { state.athletes.set(a.id, a); state.byAthlete.set(a.id, []); });
    data.results.forEach((r) => { if (state.byAthlete.has(r.athleteId)) state.byAthlete.get(r.athleteId).push(r); });

    document.title = data.title;
    $('title').textContent = data.title;
    $('updated').textContent = 'Обновлено ' + stampFmt.format(new Date(data.updatedAt));
    $('status').hidden = true;
    setupFilters();
    route();
  } catch (e) {
    $('status').textContent = 'Рейтинг ещё не опубликован или не удалось загрузить данные. Обновите страницу через минуту.';
  }
}

function setupFilters() {
  $('f-age').innerHTML = '<option value="">Все</option>' +
    AGE_GROUPS.map((g) => `<option value="${g.id}">${esc(g.label)}</option>`).join('');
  fillEvents();
  $('f-gender').addEventListener('change', () => { fillEvents(); renderRating(); });
  ['f-age', 'f-event'].forEach((id) => $(id).addEventListener('change', renderRating));
  $('f-search').addEventListener('input', renderRating);
  $('a-search').addEventListener('input', renderAthletes);
}

/** Список дисциплин зависит от пола: у мужчин нет 100 м с/б, у женщин — 110 м с/б. */
function fillEvents() {
  const g = $('f-gender').value;
  const sel = $('f-event');
  const prev = sel.value;
  const list = state.data.events.filter((e) => !g || (g === 'M' ? e.men : e.women));
  sel.innerHTML = '<option value="">Все дисциплины</option>' +
    list.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  sel.value = list.some((e) => e.id === prev) ? prev : '';
}

// ---------- рейтинг ----------

function buildRating() {
  const gender = $('f-gender').value;
  const age = $('f-age').value;
  const eventId = $('f-event').value;
  const words = norm($('f-search').value).split(/\s+/).filter(Boolean);

  const rows = [];
  for (const a of state.data.athletes) {
    if (gender && a.gender !== gender) continue;
    if (age && ageGroupOf(thisYear - a.birthYear).id !== age) continue;
    const r = best(state.byAthlete.get(a.id), eventId);
    if (!r || !state.events.has(r.eventId)) continue;
    rows.push({ a, r });
  }
  rows.sort((x, y) => y.r.points - x.r.points || x.r.date - y.r.date);

  // Одинаковые очки — одно место. Поиск не меняет места, только скрывает строки.
  let place = 0, prev = null;
  rows.forEach((row, i) => {
    if (row.r.points !== prev) { place = i + 1; prev = row.r.points; }
    row.place = place;
  });
  return words.length ? rows.filter(({ a }) => words.every((w) => norm(a.name).includes(w))) : rows;
}

function renderRating() {
  const rows = buildRating();
  $('rating-list').innerHTML = rows.map(({ a, r, place }) => `
    <li><a class="row" href="#athlete/${encodeURIComponent(a.id)}">
      <div class="place${place <= 3 ? ' top3' : ''}">${place}</div>
      ${avatar(a)}
      <div class="info">
        <div class="name">${esc(a.name)}</div>
        <div class="sub">${esc(state.events.get(r.eventId).name)}, ${esc(r.display)}</div>
        <span class="badge">${esc(r.rank)}</span>
      </div>
      <div class="pts"><b>${r.points}</b><span>очков</span></div>
    </a></li>`).join('');

  const empty = $('rating-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = state.data.results.length === 0
    ? 'Рейтинг пока пуст: результатов ещё нет.'
    : 'Нет спортсменов под выбранные фильтры.';
  $('rating-count').textContent = rows.length
    ? `${rows.length} ${plural(rows.length, 'спортсмен', 'спортсмена', 'спортсменов')} в рейтинге`
    : '';
}

// ---------- спортсмены ----------

function renderAthletes() {
  const words = norm($('a-search').value).split(/\s+/).filter(Boolean);
  const list = [...state.data.athletes]
    .sort((x, y) => x.name.localeCompare(y.name, 'ru'))
    .filter((a) => words.every((w) => norm(a.name + ' ' + a.birthYear).includes(w)));

  $('athletes-list').innerHTML = list.map((a) => {
    const r = best(state.byAthlete.get(a.id));
    const age = thisYear - a.birthYear;
    const ev = r && state.events.get(r.eventId);
    return `
    <li><a class="row" href="#athlete/${encodeURIComponent(a.id)}">
      ${avatar(a)}
      <div class="info">
        <div class="name">${esc(a.name)}</div>
        <div class="sub">${a.birthYear} г.р., ${a.gender === 'M' ? 'мужской' : 'женский'}, ${esc(ageGroupOf(age).label.toLowerCase())}</div>
        ${ev ? `<div class="sub">${esc(ev.name)}: ${esc(r.display)}</div>` : ''}
      </div>
      <div class="pts"><b>${r ? r.points : '—'}</b>${r ? '<span>очков</span>' : ''}</div>
    </a></li>`;
  }).join('');

  const empty = $('athletes-empty');
  empty.hidden = list.length > 0;
  empty.textContent = state.data.athletes.length ? 'Совпадений не найдено.' : 'Спортсменов пока нет.';
  $('athletes-count').textContent = list.length
    ? `${list.length} ${plural(list.length, 'спортсмен', 'спортсмена', 'спортсменов')}`
    : '';
}

// ---------- карточка спортсмена ----------

function renderAthlete(id) {
  const view = $('view-athlete');
  const a = state.athletes.get(id);
  if (!a) {
    view.innerHTML = `<a class="back" href="#${state.lastTab}">Назад</a><p class="empty">Спортсмен не найден.</p>`;
    return;
  }
  const results = [...state.byAthlete.get(a.id)].sort((x, y) => y.date - x.date);
  const top = best(results);
  const age = thisYear - a.birthYear;

  // Личные рекорды: лучший результат в каждой дисциплине
  const pbs = state.data.events
    .map((e) => best(results, e.id))
    .filter(Boolean)
    .sort((x, y) => y.points - x.points);

  const item = (r, mark) => {
    const ev = state.events.get(r.eventId);
    const coef = r.coef > 1 ? `, возр. коэф. ×${r.coef.toFixed(2)}` : '';
    return `
    <li><div class="row">
      <div class="info">
        <div class="name">${esc(ev ? ev.name : r.eventId)}${mark ? '<span class="best-mark">Лучший</span>' : ''}</div>
        <div class="sub">${esc(dateFmt.format(new Date(r.date)))}${coef}</div>
        <span class="badge">${esc(r.rank)}</span>
      </div>
      <div class="res"><b>${esc(r.display)}</b><span>${r.points} очк.</span></div>
    </div></li>`;
  };

  view.innerHTML = `
    <a class="back" href="#${state.lastTab}">Назад</a>
    <div class="profile">
      ${avatar(a, true)}
      <h2>${esc(a.name)}</h2>
      <p class="muted" style="margin:0">${a.birthYear} г.р., ${age} ${yearsWord(age)}, ${a.gender === 'M' ? 'мужской' : 'женский'}, группа «${esc(ageGroupOf(age).label).replace(' ', '&nbsp;')}»</p>
    </div>
    <div class="stats">
      <div class="stat"><b class="acc">${top ? top.points : '—'}</b><span>лучшие очки</span></div>
      <div class="stat"><b>${top ? esc(top.rank) : '—'}</b><span>разряд</span></div>
      <div class="stat"><b>${results.length}</b><span>${plural(results.length, 'результат', 'результата', 'результатов')}</span></div>
    </div>
    ${top ? `<p class="best-line">В рейтинге: ${esc(state.events.get(top.eventId).name)}, ${esc(top.display)} (${esc(dateFmt.format(new Date(top.date)))})</p>` : ''}
    ${pbs.length > 1 ? `<h3>Лучшее по дисциплинам</h3><ul class="list hist">${pbs.map((r) => item(r, false)).join('')}</ul>` : ''}
    <h3>История результатов</h3>
    ${results.length
      ? `<ul class="list hist">${results.map((r) => item(r, top && r.id === top.id)).join('')}</ul>`
      : '<p class="empty">Результатов пока нет.</p>'}
  `;
}

// ---------- навигация ----------

function route() {
  if (!state.data) return;
  const hash = decodeURIComponent(location.hash.slice(1));
  const [page, id] = hash.split('/');
  const tab = page === 'athletes' || page === 'athlete' ? 'athletes' : 'rating';

  $('view-rating').hidden = page === 'athlete' || tab !== 'rating';
  $('view-athletes').hidden = page === 'athlete' || tab !== 'athletes';
  $('view-athlete').hidden = page !== 'athlete';
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab && page !== 'athlete') a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (page !== 'athlete') state.lastTab = tab;
  if (page === 'athlete') { renderAthlete(id); window.scrollTo(0, 0); }
  else if (tab === 'athletes') renderAthletes();
  else renderRating();
}

window.addEventListener('hashchange', route);
load();
