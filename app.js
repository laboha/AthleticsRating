'use strict';

// Сайт только показывает data/data.json, который публикует приложение.
// Форм и записи нет: изменить данные можно только из приложения.

const AGE_GROUPS = [
  { id: 'U14', label: 'до 14', min: 0, max: 13 },
  { id: 'U16', label: 'до 16', min: 14, max: 15 },
  { id: 'U18', label: 'до 18', min: 16, max: 17 },
  { id: 'U20', label: 'до 20', min: 18, max: 19 },
  { id: 'U23', label: 'до 23', min: 20, max: 22 },
  { id: 'SENIOR', label: 'Взрослые', min: 23, max: 200 }
];
const DAY = 86400000;
const FRESH_DAYS = 45; // рост очков показывается в рейтинге, если рекорд свежий

const state = { data: null, events: new Map(), athletes: new Map(), byAthlete: new Map(), lastTab: 'rating', chartEvent: {} };
const $ = (id) => document.getElementById(id);
const thisYear = new Date().getFullYear();

// ---------- форматирование ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(s) { return String(s).toLowerCase().replace(/ё/g, 'е').trim(); }
function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join(''); }
function ageGroupOf(age) { return AGE_GROUPS.find((g) => age >= g.min && age <= g.max) || AGE_GROUPS[AGE_GROUPS.length - 1]; }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const MINUS = '−';
function signed(n) { return n > 0 ? '+' + n : n < 0 ? MINUS + Math.abs(n) : '0'; }

// Даты результатов — полночь по UTC
const fmtDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
const fmtStamp = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const dayMonth = (t) => fmtDayMonth.format(new Date(t)).replace('.', '');

/** Результат с единицей помельче: «5,62 м» → «5,62<small>м</small>». */
function displayHtml(display) {
  const m = /^(.*?)[\s ]м$/.exec(display);
  return m ? `${esc(m[1])}<small>м</small>` : esc(display);
}

/** Значение для оси графика: 11,2 · 2:21 · 5,6. */
function fmtValue(ev, v, digits = 2) {
  if (ev.track && v >= 60) {
    const m = Math.floor(v / 60), s = v - m * 60;
    return `${m}:${s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0').replace('.', ',')}`;
  }
  return v.toFixed(digits).replace('.', ',');
}

function rankClass(rank) {
  if (rank === 'МСМК' || rank === 'МС') return 'master';
  if (rank === 'КМС') return 'kms';
  if (rank === 'I' || rank === 'II' || rank === 'III') return 'adult';
  if (/юн/.test(rank)) return 'youth';
  return 'none';
}
/** Разряд в круге; «III юн.» — в две строки: «III» и «юн». */
function rankBadge(rank, extra = '') {
  const youth = /юн/.test(rank);
  const main = youth ? rank.split(' ')[0] : rank;
  const size = rank === 'б/р' ? 's3' : main.length >= 4 ? 's4' : main.length === 3 ? 's3' : 's2';
  const inner = youth ? `<b>${esc(main)}</b><i>юн</i>` : `<b>${esc(main)}</b>`;
  return `<span class="rank ${rankClass(rank)} ${size} ${extra}" title="Разряд ${esc(rank)}" aria-label="Разряд ${esc(rank)}">${inner}</span>`;
}

function avatar(a) {
  const ini = esc(initials(a.name));
  if (a.photo) {
    return `<span class="avatar"><img src="${esc(a.photo)}" alt="" loading="lazy" onerror="this.parentNode.textContent='${ini}'"></span>`;
  }
  return `<span class="avatar" aria-hidden="true">${ini}</span>`;
}

// ---------- данные ----------

/** Лучший по очкам результат; при равенстве — более ранний. */
function best(results, eventId) {
  let top = null;
  for (const r of results) {
    if (eventId && r.eventId !== eventId) continue;
    if (!top || r.points > top.points || (r.points === top.points && r.date < top.date)) top = r;
  }
  return top;
}
const isBetter = (ev, a, b) => (ev.track ? a < b : a > b);

/** Прирост очков лучшего результата относительно прежнего рекорда в той же дисциплине. */
function freshDelta(results, r) {
  if (state.data.updatedAt - r.date > FRESH_DAYS * DAY) return null;
  const prev = best(results.filter((x) => x.eventId === r.eventId && x.date < r.date));
  return prev && r.points > prev.points ? r.points - prev.points : null;
}

async function load() {
  try {
    const res = await fetch('data/data.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.data = data;
    data.events.forEach((e) => state.events.set(e.id, e));
    data.athletes.forEach((a) => { state.athletes.set(a.id, a); state.byAthlete.set(a.id, []); });
    data.results.forEach((r) => { if (state.byAthlete.has(r.athleteId)) state.byAthlete.get(r.athleteId).push(r); });
    for (const list of state.byAthlete.values()) list.sort((x, y) => x.date - y.date);

    document.title = data.title;
    $('title').textContent = data.title;
    $('updated').textContent = 'Обновлено ' + fmtStamp.format(new Date(data.updatedAt));
    $('status').hidden = true;
    setupFilters();
    route();
  } catch (e) {
    $('status').hidden = true;
    const err = $('status-error');
    err.hidden = false;
    err.textContent = 'Рейтинг ещё не опубликован или не загрузился. Обновите страницу через минуту.';
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

// ---------- плавная кривая ----------

/** Путь SVG через точки [{x, y}] по монотонной кубической интерполяции (Fritsch–Carlson). */
function smoothPath(P, start = 'M') {
  const n = P.length;
  if (!n) return '';
  const f = (v) => v.toFixed(1);
  let d = `${start}${f(P[0].x)},${f(P[0].y)}`;
  if (n === 2) return d + `L${f(P[1].x)},${f(P[1].y)}`;
  if (n < 2) return d;
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = P[i + 1].x - P[i].x;
    m.push(dx === 0 ? 0 : (P[i + 1].y - P[i].y) / dx);
  }
  const t = new Array(n);
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s2 = a * a + b * b;
    if (s2 > 9) { const tau = 3 / Math.sqrt(s2); t[i] = tau * a * m[i]; t[i + 1] = tau * b * m[i]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const dx = P[i + 1].x - P[i].x;
    if (dx === 0) { d += `L${f(P[i + 1].x)},${f(P[i + 1].y)}`; continue; }
    d += `C${f(P[i].x + dx / 3)},${f(P[i].y + t[i] * dx / 3)} ${f(P[i + 1].x - dx / 3)},${f(P[i + 1].y - t[i + 1] * dx / 3)} ${f(P[i + 1].x)},${f(P[i + 1].y)}`;
  }
  return d;
}

// ---------- мини-график в строке ----------

/** Очки по датам в одной дисциплине: вверх — лучше в любом виде. Последняя точка — акцент, если это рекорд. */
function sparkline(results, eventId) {
  const pts = results.filter((r) => r.eventId === eventId);
  const W = 72, H = 24, P = 3;
  if (!pts.length) return '';
  if (pts.length === 1) {
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      <line x1="${P}" x2="${W - P}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-width="1"/>
      <circle cx="${W - P}" cy="${H / 2}" r="3" fill="var(--accent)"/></svg>`;
  }
  const t0 = pts[0].date, t1 = pts[pts.length - 1].date;
  const lo = Math.min(...pts.map((r) => r.points)), hi = Math.max(...pts.map((r) => r.points));
  const x = (t) => (t1 === t0 ? W - P : P + (t - t0) / (t1 - t0) * (W - 2 * P));
  const y = (v) => (hi === lo ? H / 2 : H - P - (v - lo) / (hi - lo) * (H - 2 * P));
  const d = smoothPath(pts.map((r) => ({ x: x(r.date), y: y(r.points) })));
  const last = pts[pts.length - 1];
  const isTop = last.points === hi;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="var(--spark)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last.date).toFixed(1)}" cy="${y(last.points).toFixed(1)}" r="3" fill="${isTop ? 'var(--accent)' : 'var(--spark)'}"/></svg>`;
}

// ---------- сдвиг мест ----------

const SESSION_GAP = 6 * 3600 * 1000;
const createdOf = (r) => r.createdAt || r.date;

/** Начало последнего обновления: результаты, внесённые подряд с перерывами меньше 6 часов. */
function lastUpdateStart(results) {
  const times = results.map(createdOf).sort((a, b) => b - a);
  if (!times.length) return null;
  let start = times[0];
  for (const t of times.slice(1)) { if (start - t < SESSION_GAP) start = t; else break; }
  return start;
}

/** Сдвиг каждого спортсмена относительно рейтинга до последнего обновления (с теми же фильтрами). */
function moves(filters, current) {
  const start = lastUpdateStart(state.data.results);
  if (start === null) return new Map();
  const before = new Map();
  let any = false;
  for (const [id, list] of state.byAthlete) {
    const old = list.filter((r) => createdOf(r) < start);
    if (old.length) any = true;
    before.set(id, old);
  }
  if (!any) return new Map();
  const prev = new Map(buildRating(filters, before).map((row) => [row.a.id, row.place]));
  return new Map(current.map((row) => [row.a.id, prev.has(row.a.id) ? prev.get(row.a.id) - row.place : 'new']));
}

function moveHtml(m) {
  if (m === undefined || m === 0) return '';
  if (m === 'new') return '<span class="move new">нов.</span>';
  return `<span class="move ${m > 0 ? 'up' : 'down'}">${signed(m)}</span>`;
}

// ---------- статистика спортсмена ----------

const RUSSIA = new Set(['RUSSIA_YOUTH', 'RUSSIA_CHAMPIONSHIP']);
const NATIONAL = new Set(['ALL_RUSSIAN', 'RUSSIA_YOUTH', 'RUSSIA_CHAMPIONSHIP']);

function placeStats(results) {
  const placed = results.map((r) => r.place).filter(Boolean);
  const n = placed.length;
  const c = (f) => placed.filter(f).length;
  const s = { starts: n, gold: c((p) => p === 1), silver: c((p) => p === 2), bronze: c((p) => p === 3), top5: c((p) => p <= 5), top10: c((p) => p <= 10) };
  s.pct = (k) => (n ? Math.round(s[k] * 100 / n) : 0);
  return s;
}

/** Лучшая серия 1-х мест подряд и текущая. Старт без места серию не прерывает. */
function winStreak(results) {
  let best = 0, run = 0;
  results.filter((r) => r.place).sort((a, b) => a.date - b.date || createdOf(a) - createdOf(b))
    .forEach((r) => { run = r.place === 1 ? run + 1 : 0; best = Math.max(best, run); });
  return { best, current: run };
}

/** Личные рекорды: лучший сам результат (не очки) в каждой дисциплине. */
function personalRecords(results) {
  return state.data.events.map((e) => {
    const list = results.filter((r) => r.eventId === e.id);
    if (!list.length) return null;
    return list.reduce((a, b) => (isBetter(e, b.value, a.value) ? b : a));
  }).filter(Boolean);
}

// ---------- номинации сезона (только текущий год; 1 января всё обнуляется) ----------

const NOMINATIONS = [
  { id: 'SPRINTER', title: 'Лучший спринтер', events: ['60m', '100m', '200m', '400m'], icon: 'sprinter' },
  { id: 'HURDLER', title: 'Лучший барьерист', events: ['60mH', '100mH', '110mH', '400mH'], icon: 'hurdler' },
  { id: 'JUMPER', title: 'Лучший прыгун', events: ['HJ', 'PV', 'LJ', 'TJ'], icon: 'jumper' },
  { id: 'THROWER', title: 'Лучший метатель', events: ['SP', 'DT', 'HT', 'JT'], icon: 'thrower' },
  { id: 'TITLED', title: 'Самый титулованный', icon: 'titled' },
  { id: 'STABLE', title: 'Самый стабильный', icon: 'stable' },
  { id: 'NATIONAL', title: 'Лучший на Всероссийском уровне', icon: 'national' },
  { id: 'PROGRESS', title: 'Самый прогрессирующий', icon: 'progress' }
];
const TITLE_WEIGHT = { RUSSIA_CHAMPIONSHIP: 5, RUSSIA_YOUTH: 4, ALL_RUSSIAN: 3, CITY: 2 };
const yearOf = (t) => new Date(t).getUTCFullYear();

function groupLabel(gender, group) {
  const m = gender === 'M';
  if (group.id === 'SENIOR') return m ? 'Мужчины' : 'Женщины';
  if (group.id === 'U23' || group.id === 'U20') return (m ? 'Юниоры ' : 'Юниорки ') + group.label;
  return (m ? 'Юноши ' : 'Девушки ') + group.label;
}

function winners(scores) {
  let top = 0;
  for (const v of scores.values()) top = Math.max(top, v);
  if (top <= 0) return [];
  return [...scores].filter(([, v]) => Math.abs(v - top) < 1e-9).map(([id]) => id);
}

function computeNominations(year) {
  const season = new Map();
  for (const [id, list] of state.byAthlete) {
    const s = list.filter((r) => yearOf(r.date) === year);
    if (s.length) season.set(id, s);
  }
  const athletes = state.data.athletes.filter((a) => season.has(a.id));
  const out = new Map();
  const award = (ids, n) => ids.forEach((id) => { if (!out.has(id)) out.set(id, []); out.get(id).push(n); });

  for (const nom of NOMINATIONS.filter((n) => n.events)) {
    for (const gender of ['M', 'F']) {
      for (const group of AGE_GROUPS) {
        const scores = new Map();
        athletes.filter((a) => a.gender === gender && ageGroupOf(year - a.birthYear).id === group.id).forEach((a) => {
          scores.set(a.id, Math.max(0, ...season.get(a.id).filter((r) => nom.events.includes(r.eventId)).map((r) => r.points)));
        });
        award(winners(scores), { nom, year, gender, group: groupLabel(gender, group) });
      }
    }
  }
  const byNom = (id) => NOMINATIONS.find((n) => n.id === id);
  const titled = new Map(athletes.map((a) => {
    const s = season.get(a.id);
    const score = s.reduce((sum, r) => sum + (r.place >= 1 && r.place <= 3 ? (4 - r.place) * (TITLE_WEIGHT[r.status] || 1) : 0), 0);
    return [a.id, score ? score + s.filter((r) => r.place === 1).length / 1000 : 0];
  }));
  award(winners(titled), { nom: byNom('TITLED'), year });

  const stable = new Map(athletes.map((a) => {
    const pts = season.get(a.id).map((r) => r.points);
    if (pts.length < 3) return [a.id, 0];
    const mean = pts.reduce((x, y) => x + y, 0) / pts.length;
    if (mean <= 0) return [a.id, 0];
    const sd = Math.sqrt(pts.reduce((x, p) => x + (p - mean) ** 2, 0) / pts.length);
    return [a.id, Math.max(0, 1 - sd / mean) + pts.length / 1e6];
  }));
  award(winners(stable), { nom: byNom('STABLE'), year });

  const national = new Map(athletes.map((a) => [a.id, Math.max(0, ...season.get(a.id).filter((r) => NATIONAL.has(r.status)).map((r) => r.points))]));
  award(winners(national), { nom: byNom('NATIONAL'), year });

  const progress = new Map(athletes.map((a) => {
    const mine = state.byAthlete.get(a.id);
    let bestGain = 0;
    for (const ev of new Set(mine.map((r) => r.eventId))) {
      const inEv = mine.filter((r) => r.eventId === ev);
      const s = inEv.filter((r) => yearOf(r.date) === year).sort((x, y) => x.date - y.date);
      if (!s.length) continue;
      const before = inEv.filter((r) => yearOf(r.date) < year).map((r) => r.basePoints);
      const ref = before.length ? Math.max(...before) : s.length >= 2 ? s[0].basePoints : null;
      if (ref === null) continue;
      bestGain = Math.max(bestGain, Math.max(...s.map((r) => r.basePoints)) - ref);
    }
    return [a.id, bestGain];
  }));
  award(winners(progress), { nom: byNom('PROGRESS'), year });
  return out;
}

// ---------- рейтинг ----------

function buildRating(filters, byAthlete = state.byAthlete) {
  const { gender = '', age = '', eventId = '' } = filters;
  const rows = [];
  for (const a of state.data.athletes) {
    if (gender && a.gender !== gender) continue;
    if (age && ageGroupOf(thisYear - a.birthYear).id !== age) continue;
    const r = best(byAthlete.get(a.id) || [], eventId);
    if (!r || !state.events.has(r.eventId)) continue;
    rows.push({ a, r });
  }
  rows.sort((x, y) => y.r.points - x.r.points || x.r.date - y.r.date);
  let place = 0, prev = null;
  rows.forEach((row, i) => {
    if (row.r.points !== prev) { place = i + 1; prev = row.r.points; }
    row.place = place;
  });
  return rows;
}

function renderRating() {
  const words = norm($('f-search').value).split(/\s+/).filter(Boolean);
  const filters = { gender: $('f-gender').value, age: $('f-age').value, eventId: $('f-event').value };
  const all = buildRating(filters);
  const shift = moves(filters, all);
  // Поиск не меняет места, только скрывает строки
  const rows = words.length ? all.filter(({ a }) => words.every((w) => norm(a.name).includes(w))) : all;
  const lastPodium = rows.filter((r) => r.place <= 3).length - 1;

  $('rating-list').innerHTML = rows.map(({ a, r, place }, i) => {
    const results = state.byAthlete.get(a.id);
    const ev = state.events.get(r.eventId);
    const delta = freshDelta(results, r);
    return `
    <li${i === lastPodium ? ' class="podium-end"' : ''}>
      <a class="row${place <= 3 ? ' top3' : ''}" href="#athlete/${encodeURIComponent(a.id)}">
        <span class="place-cell"><span class="place">${place}</span>${moveHtml(shift.get(a.id))}</span>
        <span class="who">${avatar(a)}
          <span class="who-text">
            <span class="name">${esc(a.name)}</span>
            <span class="meta">${rankBadge(r.rank, 'rank-in')}<span class="meta-t">${esc(ev.name)}</span><b class="meta-r">${esc(r.display)}</b></span>
          </span>
        </span>
        <span class="c-spark">${sparkline(results, r.eventId)}</span>
        <span class="c-rank">${rankBadge(r.rank)}</span>
        <span class="pts"><b>${r.points}</b>${delta ? `<span class="delta up" title="Рост за последний рекорд">+${delta}</span>` : ''}</span>
      </a>
    </li>`;
  }).join('');

  $('rating-board').hidden = rows.length === 0;
  const empty = $('rating-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = state.data.results.length === 0
    ? 'Рейтинг пока пуст: результатов ещё нет.'
    : words.length ? 'Совпадений не найдено.' : 'Нет спортсменов под выбранные фильтры. Измените пол, возраст или дисциплину.';
}

// ---------- спортсмены ----------

function renderAthletes() {
  const words = norm($('a-search').value).split(/\s+/).filter(Boolean);
  const list = [...state.data.athletes]
    .sort((x, y) => x.name.localeCompare(y.name, 'ru'))
    .filter((a) => words.every((w) => norm(a.name + ' ' + a.birthYear).includes(w)));

  $('athletes-list').innerHTML = list.map((a) => {
    const r = best(state.byAthlete.get(a.id));
    const ev = r && state.events.get(r.eventId);
    const age = thisYear - a.birthYear;
    const meta = `${a.birthYear} г.р., ${esc(ageGroupOf(age).label.toLowerCase())}` + (ev ? `, ${esc(ev.name)} <b>${esc(r.display)}</b>` : '');
    return `
    <li><a class="row" href="#athlete/${encodeURIComponent(a.id)}">
      <span class="who">${avatar(a)}
        <span class="who-text">
          <span class="name">${esc(a.name)}</span>
          <span class="meta">${r ? rankBadge(r.rank, 'rank-in') : ''}<span class="meta-t">${meta}</span></span>
        </span>
      </span>
      <span class="c-rank">${r ? rankBadge(r.rank) : ''}</span>
      <span class="pts"><b>${r ? r.points : '—'}</b></span>
    </a></li>`;
  }).join('');

  const empty = $('athletes-empty');
  empty.hidden = list.length > 0;
  empty.textContent = state.data.athletes.length ? 'Совпадений не найдено.' : 'Спортсменов пока нет.';
}

// ---------- профиль ----------

function renderAthlete(id) {
  const view = $('view-athlete');
  const a = state.athletes.get(id);
  const back = `<a class="back" href="#${state.lastTab}">Назад</a>`;
  if (!a) { view.innerHTML = back + '<p class="empty">Спортсмен не найден.</p>'; return; }

  const results = state.byAthlete.get(a.id);           // по возрастанию даты
  const top = best(results);
  const age = thisYear - a.birthYear;
  const place = top ? (buildRating({}).find((row) => row.a.id === a.id) || {}).place : null;
  const topEv = top && state.events.get(top.eventId);
  const eventsDone = state.data.events.filter((e) => results.some((r) => r.eventId === e.id));

  const hero = `
    <div class="hero">
      <div class="id">${avatar(a)}
        <div><h2>${esc(a.name)}</h2>
          <p>${a.birthYear} г.р., ${age} ${plural(age, 'год', 'года', 'лет')}, ${a.gender === 'M' ? 'мужской' : 'женский'}, группа «${esc(ageGroupOf(age).label).replace(' ', '&nbsp;')}»</p>
        </div>
      </div>
      ${top ? `
      <div>
        <div class="pb-label">Лучший результат в рейтинге</div>
        <div class="pb">${displayHtml(top.display)}</div>
        <div class="pb-sub">${esc(topEv.name)}, ${esc(fmtDate.format(new Date(top.date)))} ${rankBadge(top.rank)}</div>
      </div>
      <div class="stats">
        <div class="stat"><span>Очки</span><b>${top.points}</b></div>
        <div class="stat"><span>Место</span><b>${place || '—'}</b></div>
        <div class="stat"><span>Разряд</span><b>${esc(top.rank)}</b></div>
        <div class="stat"><span>Стартов</span><b>${results.length}</b></div>
      </div>` : '<p class="empty">Результатов пока нет.</p>'}
    </div>`;

  // Номинации сезона
  const year = thisYear;
  const noms = (state.nominations || (state.nominations = computeNominations(year))).get(a.id) || [];
  const nominations = `
    <div class="section-h"><h3>Номинации</h3><span>${year}</span></div>
    ${noms.length ? `<div class="noms">${noms.map((n) => `
      <div class="nom">
        <img src="img/nom_${n.nom.icon}${n.nom.events ? (n.gender === 'F' ? '_f' : '_m') : ''}.png" alt="" width="96" height="96" loading="lazy">
        <b>${esc(n.nom.title)}</b>
        <span>${n.group ? esc(n.group) + ', ' : ''}${n.year}</span>
      </div>`).join('')}</div>` : '<p class="empty-box">Номинаций пока нет</p>'}`;

  // Места: серия побед, 1–3, топ-5, топ-10 и доля от стартов с местом
  const ps = placeStats(results);
  const streak = winStreak(results);
  const line = (label, key, dot) => `
      <div class="pl-row">
        <span class="pl-label">${dot ? `<i class="dot ${dot}"></i>` : '<i class="dot"></i>'}${label}</span>
        <b class="pl-count">${ps[key]}</b>
        <span class="pl-bar"><span style="width:${ps.pct(key)}%"></span></span>
        <span class="pl-pct">${ps.pct(key)}%</span>
      </div>`;
  const places = `
    <div class="section-h"><h3>Места</h3><span>${ps.starts ? `из ${ps.starts} ${plural(ps.starts, 'старта', 'стартов', 'стартов')} с местом` : 'места пока не указаны'}</span></div>
    <div class="board places">
      <div class="streak${streak.best ? '' : ' off'}">
        <svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path fill="var(--flame-outer)" d="M12,2C12,2 13.2,5.3 11,8.1C9.6,9.9 7.5,11.4 7.5,14.6C7.5,18.6 10.4,21.5 12,22C16,21.6 18.5,18.6 18.5,15C18.5,11.4 16.2,9.5 15.6,7.2C15.4,8.9 14.6,10 13.6,10.4C14.3,7.1 13.5,4.2 12,2Z"/><path fill="var(--flame-inner)" d="M12.4,12.2C12.6,13.8 11.4,14.6 10.8,15.8C10.3,16.8 10.5,18.9 12.2,20C14.1,19.8 15.6,18.4 15.6,16.4C15.6,14.6 14.2,13.7 13.8,12.4C13.6,13.3 13.2,13.8 12.8,14C12.9,13.3 12.8,12.7 12.4,12.2Z"/></svg>
        <b class="streak-n">${streak.best}</b>
        <span><b>Серия побед</b><span>лучшая серия 1-х мест подряд</span></span>
      </div>
      ${line('1 место', 'gold', 'gold')}${line('2 место', 'silver', 'silver')}${line('3 место', 'bronze', 'bronze')}${line('Топ-5', 'top5')}${line('Топ-10', 'top10')}
    </div>`;

  const ach = results
    .filter((r) => RUSSIA.has(r.status) && r.place)
    .sort((x, y) => x.place - y.place || y.date - x.date);
  const achievements = ach.length ? `
    <div class="section-h"><h3>Достижения</h3></div>
    <div class="board ach"><ul class="rows">${ach.map((r) => `
      <li><div class="row">
        <span class="ach-place${r.place <= 3 ? ' prize' : ''}"><b>${r.place}</b><span>место</span></span>
        <span class="who-text"><span class="name">${esc(r.statusLabel || '')}</span>
          <span class="meta">${esc(state.events.get(r.eventId).name)}, <b>${esc(r.display)}</b>, ${esc(fmtDate.format(new Date(r.date)))}</span></span>
      </div></li>`).join('')}</ul></div>` : '';

  const progress = top ? `
    <div class="section-h"><h3>Прогресс</h3><span>выше — лучше</span></div>
    <div class="chart-card">
      <div class="chart" id="chart"></div>
      <div class="seg" role="group" aria-label="Дисциплина графика">
        ${eventsDone.map((e) => `<button type="button" data-ev="${esc(e.id)}">${esc(e.name)}<i>${results.filter((r) => r.eventId === e.id).length}</i></button>`).join('')}
      </div>
    </div>` : '';

  const pbs = personalRecords(results);
  const pbList = pbs.length ? `
    <div class="section-h"><h3>Личные рекорды</h3><span>${pbs.length} ${plural(pbs.length, 'дисциплина', 'дисциплины', 'дисциплин')}</span></div>
    <div class="board pbs"><ul class="rows">${pbs.map((r) => `
      <li><div class="row">
        <span class="who-text"><span class="name">${esc(state.events.get(r.eventId).name)}</span><span class="date">${esc(fmtDate.format(new Date(r.date)))}</span></span>
        <span class="res">${esc(r.display)}</span>
        <span class="c-rank">${rankBadge(r.rank)}</span>
        <span class="pts"><b>${r.points}</b></span>
      </div></li>`).join('')}</ul></div>` : '';

  view.innerHTML = back + hero + nominations + places + achievements + progress + pbList + (results.length ? `
    <div class="section-h"><h3>История результатов</h3><span>${results.length} ${plural(results.length, 'старт', 'старта', 'стартов')}</span></div>
    ${timeline(results, top)}` : '');

  if (top) {
    // По умолчанию — дисциплина лучшего результата; если там один старт, то дисциплина с наибольшим числом стартов
    const count = (id) => results.filter((r) => r.eventId === id).length;
    const busiest = eventsDone.reduce((x, y) => (count(y.id) > count(x.id) ? y : x)).id;
    const fallback = count(top.eventId) > 1 ? top.eventId : busiest;
    const chosen = state.chartEvent[a.id] && eventsDone.some((e) => e.id === state.chartEvent[a.id]) ? state.chartEvent[a.id] : fallback;
    const seg = view.querySelector('.seg');
    const select = (evId) => {
      state.chartEvent[a.id] = evId;
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ev === evId)));
      drawChart($('chart'), results.filter((r) => r.eventId === evId), state.events.get(evId));
    };
    seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) select(b.dataset.ev); });
    select(chosen);
    seg.querySelector('[aria-pressed="true"]').scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}

// ---------- хронология ----------

function timeline(results, top) {
  const byYear = new Map();
  const bestSoFar = new Map();   // лучшее значение в дисциплине на момент старта
  const prevOf = new Map();      // предыдущий старт в той же дисциплине
  const info = new Map();
  for (const r of results) {     // по возрастанию даты
    const ev = state.events.get(r.eventId);
    const prevBest = bestSoFar.get(r.eventId);
    const pb = prevBest === undefined || isBetter(ev, r.value, prevBest);
    info.set(r.id, { pb, improved: pb && prevBest !== undefined, prev: prevOf.get(r.eventId) });
    if (pb) bestSoFar.set(r.eventId, r.value);
    prevOf.set(r.eventId, r);
  }
  [...results].reverse().forEach((r) => {
    const y = new Date(r.date).getUTCFullYear();
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  });

  let html = '';
  for (const [year, list] of byYear) {
    html += `<div class="year">${year}</div><ol class="tl">`;
    for (const r of list) {
      const ev = state.events.get(r.eventId);
      const { pb, improved, prev } = info.get(r.id);
      const d = prev ? r.points - prev.points : null;
      const coef = r.coef > 1.0001 ? `, коэф. ×${r.coef.toFixed(2).replace('.', ',')}` : '';
      const comp = [r.place ? `${r.place} место` : '', r.statusLabel || ''].filter(Boolean).join(', ');
      html += `
      <li>
        <span class="d">${esc(dayMonth(r.date))}</span>
        <span class="node${pb ? ' pb' : ''}" aria-hidden="true"></span>
        <div>
          <div class="ev">${esc(ev ? ev.name : r.eventId)}</div>
          ${comp ? `<div class="comp">${esc(comp)}</div>` : ''}
          <div class="ev-meta">${rankBadge(r.rank)}${improved ? '<span class="tag">ЛР</span>' : ''}${top && r.id === top.id ? '<span class="tag best">В рейтинге</span>' : ''}</div>
        </div>
        <div class="r"><b>${esc(r.display)}</b><span>${r.points}${coef}</span>${d !== null && d !== 0 ? `<div class="delta ${d > 0 ? 'up' : 'down'}">${signed(d)}</div>` : ''}</div>
      </li>`;
    }
    html += '</ol>';
  }
  return html;
}

// ---------- график прогресса ----------

function niceStep(range, count) {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function drawChart(el, pts, ev) {
  if (!el) return;
  const W = Math.max(el.clientWidth - 8, 240), H = el.clientHeight - 20;
  const M = { l: 56, r: 20, t: pts.length === 1 ? 52 : 26, b: 26 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  const vals = pts.map((r) => r.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(hi * 0.02, 0.1);
  lo -= span * 0.25; hi += span * 0.25;
  const step = niceStep(hi - lo, 3);
  const digits = [0, 1, 2].find((d) => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-9) ?? 2;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  // Для бега ось перевёрнута: меньшее время — выше
  const y = (v) => M.t + (ev.track ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) * ih;

  const t0 = pts[0].date, t1 = pts[pts.length - 1].date;
  const tp = (t1 - t0) * 0.06 || 20 * DAY;
  const x0 = t0 - tp, x1 = t1 + tp;
  const x = (t) => M.l + (t - x0) / (x1 - x0) * iw;

  let svg = '';
  for (let i = 0, v = lo; v <= hi + step / 2; i++, v = lo + i * step) {
    const yy = Math.round(y(v)) + 0.5;
    svg += `<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="tick" x="${M.l - 10}" y="${yy + 4}" text-anchor="end">${fmtValue(ev, v, digits)}</text>`;
  }
  // Подписи дат: не больше четырёх, без наложений
  const spanDays = (x1 - x0) / DAY;
  const ticks = [];
  const d0 = new Date(x0);
  let cur = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);
  const monthsStep = Math.max(1, Math.ceil(spanDays / 30 / 4));
  while (cur <= x1) {
    ticks.push(cur);
    const d = new Date(cur);
    cur = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsStep, 1);
  }
  const multiYear = new Date(x0).getUTCFullYear() !== new Date(x1).getUTCFullYear();
  ticks.forEach((t, i) => {
    const d = new Date(t);
    const label = fmtMonth.format(d).replace('.', '') + (multiYear && (i === 0 || d.getUTCMonth() === 0) ? ` ${d.getUTCFullYear()}` : '');
    svg += `<text class="tick" x="${x(t)}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>`;
  });

  const P = pts.map((r) => ({ r, cx: x(r.date), cy: y(r.value) }));
  if (P.length > 1) {
    const pts2 = P.map((p) => ({ x: p.cx, y: p.cy }));
    const d = smoothPath(pts2);
    svg += `<path class="area" d="M${P[0].cx.toFixed(1)},${M.t + ih}${smoothPath(pts2, 'L')}L${P[P.length - 1].cx.toFixed(1)},${M.t + ih}Z"/>`;
    svg += `<path class="line" d="${d}"/>`;
  }
  const pbVal = ev.track ? Math.min(...vals) : Math.max(...vals);
  const pbPoint = P.find((p) => p.r.value === pbVal);
  const lastPoint = P[P.length - 1];
  P.forEach((p) => {
    const isPb = p === pbPoint;
    svg += `<circle class="dot${isPb ? ' pb' : ''}" cx="${p.cx.toFixed(1)}" cy="${p.cy.toFixed(1)}" r="${isPb ? 5.5 : 4.5}"/>`;
  });
  // Подписи только у рекорда и последнего старта
  const label = (p, text, cls) => {
    const above = p.cy - 12 > M.t - 8;
    const anchor = p.cx > W - M.r - 40 ? 'end' : p.cx < M.l + 40 ? 'start' : 'middle';
    return `<text class="label ${cls}" x="${p.cx.toFixed(1)}" y="${(above ? p.cy - 12 : p.cy + 22).toFixed(1)}" text-anchor="${anchor}">${esc(text)}</text>`;
  };
  if (pbPoint) svg += label(pbPoint, `ЛР ${pbPoint.r.display}`, '');
  if (lastPoint !== pbPoint && P.length > 1) svg += label(lastPoint, lastPoint.r.display, 'muted');

  svg += `<line class="cross" id="cross" x1="0" x2="0" y1="${M.t}" y2="${M.t + ih}" visibility="hidden"/>`;
  svg += `<rect class="hit" x="${M.l}" y="0" width="${iw}" height="${H}"/>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(ev.name)}: ${pts.length} ${plural(pts.length, 'результат', 'результата', 'результатов')}">${svg}</svg>` +
    (pts.length === 1 ? '<div class="chart-note">Динамика появится после второго старта в этой дисциплине</div>' : '');

  // Подсказка: ближайшая по дате точка
  const svgEl = el.querySelector('svg');
  const cross = el.querySelector('#cross');
  const tip = $('tip');
  const show = (evt) => {
    const box = svgEl.getBoundingClientRect();
    const mx = (evt.clientX - box.left) * (W / box.width);
    const p = P.reduce((a, b) => (Math.abs(b.cx - mx) < Math.abs(a.cx - mx) ? b : a));
    cross.setAttribute('x1', p.cx); cross.setAttribute('x2', p.cx); cross.setAttribute('visibility', 'visible');
    tip.innerHTML = `<b>${esc(p.r.display)}</b><span>${esc(fmtDate.format(new Date(p.r.date)))}</span><br><span>${p.r.points} ${plural(p.r.points, 'очко', 'очка', 'очков')}, разряд ${esc(p.r.rank)}</span>${p.r.place || p.r.statusLabel ? `<br><span>${esc([p.r.place ? p.r.place + ' место' : '', p.r.statusLabel || ''].filter(Boolean).join(', '))}</span>` : ''}`;
    tip.hidden = false;
    const px = box.left + p.cx * (box.width / W), py = box.top + p.cy * (box.height / H);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(Math.max(8, px - tw / 2), window.innerWidth - tw - 8) + 'px';
    tip.style.top = (py - th - 14 < 8 ? py + 16 : py - th - 14) + 'px';
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
  el._redraw = () => drawChart(el, pts, ev);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const c = $('chart'); if (c && c._redraw) c._redraw(); }, 120);
});
window.addEventListener('scroll', () => {
  $('top').classList.toggle('scrolled', window.scrollY > 4);
  $('tip').hidden = true;
}, { passive: true });

// «/» — к поиску
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const input = !$('view-athletes').hidden ? $('a-search') : !$('view-rating').hidden ? $('f-search') : null;
  if (input) { e.preventDefault(); input.focus(); }
});

// ---------- навигация ----------

function route() {
  if (!state.data) return;
  const [page, id] = decodeURIComponent(location.hash.slice(1)).split('/');
  const tab = page === 'athletes' ? 'athletes' : page === 'athlete' ? state.lastTab : 'rating';
  const onProfile = page === 'athlete';

  $('view-rating').hidden = onProfile || tab !== 'rating';
  $('view-athletes').hidden = onProfile || tab !== 'athletes';
  $('view-athlete').hidden = !onProfile;
  $('tip').hidden = true;
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  if (onProfile) { renderAthlete(id); window.scrollTo(0, 0); return; }
  state.lastTab = tab;
  if (tab === 'athletes') renderAthletes(); else renderRating();
}

window.addEventListener('hashchange', route);
load();
