/* «6 минут. Дневник успеха» — личное веб-приложение. Без сборки, без зависимостей.
   Данные хранятся в IndexedDB на устройстве; каждая прежняя версия записи сохраняется в истории. */
'use strict';

/* ---------- даты ---------- */
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
const monthKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const today = () => fmt(new Date());
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const wdIndex = s => (parse(s).getDay() + 6) % 7;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
// конец этапа: start + n месяцев − 1 день (5 ноября → 4 февраля)
const addMonthsStr = (s, n) => { const d = parse(s); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1))); return fmt(addDays(d, -1)); };
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const longDate = s => { const d = parse(s); return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; };
const shortDate = s => { const d = parse(s); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`; };
function weekRange(mon) {
  const sun = addDays(mon, 6);
  if (mon.getMonth() === sun.getMonth()) return `${mon.getDate()}–${sun.getDate()} ${MONTHS_GEN[mon.getMonth()]}`;
  return `${mon.getDate()} ${MONTHS_GEN[mon.getMonth()]} – ${sun.getDate()} ${MONTHS_GEN[sun.getMonth()]}`;
}

/* ---------- хранилище (IndexedDB) ---------- */
const Store = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('dnevnik6', 2);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries');
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { autoIncrement: true }).createIndex('key', 'key');
        if (!db.objectStoreNames.contains('sync')) db.createObjectStore('sync');
      };
      r.onsuccess = e => res(e.target.result);
      r.onerror = e => rej(e.target.error);
    });
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const strip = v => JSON.stringify(v, (k, x) => k === 'updatedAt' ? undefined : x);
  async function get(key) { const db = await open(); return req(db.transaction('entries').objectStore('entries').get(key)); }
  // Возвращает true, если запись действительно изменилась и была записана.
  function put(key, value) {
    return open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(['entries', 'history'], 'readwrite');
      const entries = tx.objectStore('entries');
      let written = false;
      const g = entries.get(key);
      g.onsuccess = () => {
        const prev = g.result;
        if (prev !== undefined && strip(prev) === strip(value)) return;
        if (prev !== undefined) tx.objectStore('history').add({ key, at: new Date().toISOString(), data: prev });
        entries.put(value, key);
        written = true;
      };
      tx.oncomplete = () => res(written);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    }));
  }
  async function cursorList(store, prefix) {
    const db = await open();
    const out = [];
    await new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
      r.onsuccess = () => { const c = r.result; if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else res(); };
      r.onerror = () => rej(r.error);
    });
    return out;
  }
  async function history() { const db = await open(); return req(db.transaction('history').objectStore('history').getAll()); }
  // служебное хранилище синхронизации: sha файлов, очередь на отправку, время последней синхронизации
  async function sget(k) { const db = await open(); return req(db.transaction('sync').objectStore('sync').get(k)); }
  async function sput(k, v) { const db = await open(); const tx = db.transaction('sync', 'readwrite'); tx.objectStore('sync').put(v, k); return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  async function sdel(k) { const db = await open(); const tx = db.transaction('sync', 'readwrite'); tx.objectStore('sync').delete(k); return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
  return { get, put, list: prefix => cursorList('entries', prefix), all: () => cursorList('entries', ''), history, sget, sput, sdel, slist: prefix => cursorList('sync', prefix) };
})();

/* ---------- модели записей ---------- */
const task = () => ({ t: '', done: false });
const kr = () => ({ t: '', progress: 0 });
const okr = () => ({ objective: '', krs: [kr(), kr(), kr()] });
const tasks = n => Array.from({ length: n }, task);
const DEF = {
  day: () => ({ gratitude: ['', '', ''], anticipate: ['', '', ''], focus: '', cream: tasks(2), cherries: tasks(5), deadlines: '', fun: tasks(3), evening: '' }),
  week: () => ({
    events: ['', '', '', '', '', ''], notes: '',
    habits: Array.from({ length: 5 }, () => ({ name: '', days: [false, false, false, false, false, false, false] })),
    goals: [{ title: '', steps: tasks(3) }, { title: '', steps: tasks(3) }],
    meaning: '', progress: ''
  }),
  month: () => ({ notes: {}, pride: ['', '', ''], ratings: {}, progress: '' }),
  triad: (start, end) => ({ start, end: end || addMonthsStr(start, 3), value: '', goals: ['', '', ''], habits: ['', '', ''], okrs: [okr(), okr()] }),
  review: start => ({ triad: start, date: today(), value: '', answers: [null, null, null, null, null], notes: '' }),
  settings: () => ({ startDate: today(), created: new Date().toISOString() })
};
async function load(key, def) { const v = await Store.get(key); return v ? Object.assign(def, v) : def; }
async function getSettings() {
  let s = await Store.get('meta:settings');
  if (!s) { s = DEF.settings(); await Store.put('meta:settings', s); }
  return s;
}
const hasText = v => typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.some(hasText) : v && typeof v === 'object' ? Object.values(v).some(hasText) : false;
const dayHasContent = d => !!d && hasText(d);

/* ---------- автосохранение ---------- */
const pending = new Map();
function save(key, obj) {
  const p = pending.get(key);
  if (p) clearTimeout(p.t);
  pending.set(key, { obj, t: setTimeout(() => flush(key), 400) });
}
async function flush(key) {
  const p = pending.get(key); if (!p) return;
  pending.delete(key);
  try {
    p.obj.updatedAt = new Date().toISOString();
    const written = await Store.put(key, p.obj);
    setStatus('Сохранено');
    if (written) GH.markDirty(key);
  } catch (e) { console.error(e); setStatus('Не сохранилось', true); }
}
function flushAll() { for (const k of [...pending.keys()]) flush(k); }
window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });

let statusTimer = null;
function setStatus(text, err) {
  const el = document.getElementById('status');
  el.textContent = text; el.classList.toggle('err', !!err); el.classList.add('show');
  clearTimeout(statusTimer); statusTimer = setTimeout(() => el.classList.remove('show'), err ? 3000 : 1000);
}

/* ---------- DOM ---------- */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function area(value, onInput, opts = {}) {
  const ta = h('textarea', { class: 'area', rows: 1, placeholder: opts.placeholder || '' });
  if (opts.minRows) ta.style.minHeight = (opts.minRows * 28) + 'px';
  ta.value = value || '';
  ta.addEventListener('input', () => { autosize(ta); onInput(ta.value); });
  requestAnimationFrame(() => { if (ta.isConnected) autosize(ta); });
  return ta;
}
function line(value, onInput, opts = {}) {
  const inp = h('input', { class: 'line' + (opts.plain ? ' plain' : ''), type: 'text', placeholder: opts.placeholder || '', autocomplete: 'off', autocapitalize: 'sentences' });
  inp.value = value || '';
  inp.addEventListener('input', () => onInput(inp.value));
  return inp;
}
function check(checked, onChange, cls = 'chk') {
  const c = h('input', { type: 'checkbox', class: cls });
  c.checked = !!checked;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}
function taskRow(t, onChange) {
  const row = h('div', { class: 'task' + (t.done ? ' done' : '') });
  row.append(check(t.done, v => { t.done = v; row.classList.toggle('done', v); onChange(); }), line(t.t, v => { t.t = v; onChange(); }));
  return row;
}
function dateInput(value, onChange) {
  const i = h('input', { type: 'date' });
  i.value = value || '';
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function topbar(prevHref, title, nextHref) {
  return h('div', { class: 'topbar' },
    prevHref ? h('a', { class: 'arrow', href: prevHref, 'aria-label': 'Назад' }, '‹') : h('span', { class: 'arrow' }, '‹'),
    h('div', { class: 'ttl' }, title),
    nextHref ? h('a', { class: 'arrow', href: nextHref, 'aria-label': 'Вперёд' }, '›') : h('span', { class: 'arrow' }, '›'));
}
const sunIcon = () => h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' });
const sunsetIcon = () => h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 4v4M5.5 9.5l1.5 1.5M18.5 9.5 17 11M2 13h2M20 13h2"/></svg>' });

// Enter в однострочном поле переводит к следующему полю
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || !e.target.classList.contains('line')) return;
  e.preventDefault();
  const all = [...document.querySelectorAll('input.line, textarea.area')];
  const i = all.indexOf(e.target);
  if (i >= 0 && all[i + 1]) all[i + 1].focus(); else e.target.blur();
});

/* ---------- цитата дня ---------- */
function quoteFor(date) {
  const q = window.QUOTES || [];
  if (!q.length) return null;
  const d = parse(date);
  const doy = Math.round((d - new Date(d.getFullYear(), 0, 1)) / 864e5);
  return q[doy % q.length];
}

/* ---------- страница дня ---------- */
async function viewDay(date) {
  if (!isDate(date)) date = today();
  const key = `day:${date}`;
  const day = await load(key, DEF.day());
  const mon = mondayOf(parse(date));
  const wkey = `week:${fmt(mon)}`;
  const week = await load(wkey, DEF.week());
  const wi = wdIndex(date);
  const touch = () => save(key, day);
  const touchW = () => save(wkey, week);
  const quote = quoteFor(date);

  return h('div', {},
    topbar(`#/day/${fmt(addDays(parse(date), -1))}`, 'День', `#/day/${fmt(addDays(parse(date), 1))}`),
    h('div', { class: 'daystrip' },
      h('div', { class: 'wk' }, WD.map((w, i) => h('a', { href: `#/day/${fmt(addDays(mon, i))}`, class: i === wi ? 'cur' : '' }, w + '.'))),
      h('a', { class: 'date', href: `#/month/${monthKeyOf(parse(date))}` }, longDate(date))),
    date !== today() ? h('a', { class: 'todaylink', href: `#/day/${today()}` }, 'к сегодняшнему дню') : null,

    h('div', { class: 'two' },
      h('div', {}, h('div', { class: 'lbl' }, sunIcon(), 'Я благодарю:'), day.gratitude.map((v, i) => line(v, x => { day.gratitude[i] = x; touch(); }))),
      h('div', {}, h('div', { class: 'lbl' }, 'Я предвкушаю:'), day.anticipate.map((v, i) => line(v, x => { day.anticipate[i] = x; touch(); })))),

    h('div', { class: 'box' },
      h('div', { class: 'h-sec tight' }, 'Фокус дня'),
      h('div', { class: 'sub' }, 'Пирожное — чему я порадуюсь и что прибавит мне сил:'),
      area(day.focus, v => { day.focus = v; touch(); }, { minRows: 2 }),
      habitsToday(week, wi, touchW, fmt(mon))),

    h('div', { class: 'h-sec' }, 'Список дел'),
    h('div', { class: 'sub left' }, 'Сливки:'), day.cream.map(t => taskRow(t, touch)),
    h('div', { class: 'sub left mt' }, 'Вишенки:'), day.cherries.map(t => taskRow(t, touch)),
    h('div', { class: 'sub left mt' }, 'Сроки и комментарии:'), area(day.deadlines, v => { day.deadlines = v; touch(); }, { minRows: 2 }),

    h('div', { class: 'h-sec' }, 'Список развлечений'), day.fun.map(t => taskRow(t, touch)),

    quote ? h('div', { class: 'quote' }, quote.text, quote.author ? h('span', { class: 'who' }, quote.author) : null) : null,

    h('div', { class: 'h-sec' }, sunsetIcon(), 'Мысли, идеи и достижения'),
    area(day.evening, v => { day.evening = v; touch(); }, { minRows: 4 }));
}
function habitsToday(week, wi, touchW, monday) {
  const named = week.habits.filter(hb => hb.name.trim());
  const wrap = h('div', { class: 'habits-today' }, h('div', { class: 'sub left' }, 'Сделана отметка в трекере привычек?'));
  if (!named.length) {
    wrap.append(h('a', { class: 'hint', href: `#/week/${monday}` }, 'Привычки на эту неделю ещё не заданы. Задать на странице недели ›'));
    return wrap;
  }
  for (const hb of named) wrap.append(h('label', { class: 'habit-row' }, check(hb.days[wi], v => { hb.days[wi] = v; touchW(); }), h('span', {}, hb.name)));
  return wrap;
}

/* ---------- страница недели ---------- */
async function viewWeek(monday) {
  if (!isDate(monday)) monday = fmt(mondayOf(new Date()));
  const mon = mondayOf(parse(monday)); monday = fmt(mon);
  const key = `week:${monday}`;
  const week = await load(key, DEF.week());
  const touch = () => save(key, week);
  const sun = addDays(mon, 6);
  const evLabels = ['Пн.', 'Вт.', 'Ср.', 'Чт.', 'Пт.', 'Сб./Вс.'];
  const evDates = [0, 1, 2, 3, 4].map(i => shortDate(fmt(addDays(mon, i)))).concat([`${shortDate(fmt(addDays(mon, 5)))}–${shortDate(fmt(sun))}`]);

  return h('div', {},
    topbar(`#/week/${fmt(addDays(mon, -7))}`, 'Неделя', `#/week/${fmt(addDays(mon, 7))}`),
    h('div', { class: 'daystrip' },
      h('div', { class: 'wk' }, WD.map((w, i) => { const d = fmt(addDays(mon, i)); return h('a', { href: `#/day/${d}`, class: d === today() ? 'cur' : '' }, w + '.'); })),
      h('span', { class: 'date' }, weekRange(mon))),
    h('div', { class: 'h-page' }, 'План на неделю'),

    h('div', { class: 'h-sec' }, 'Даты и события'),
    h('div', { class: 'events' }, evLabels.map((l, i) => h('div', { class: 'ev' },
      h('div', { class: 'evh' }, h('b', {}, l), ' ', evDates[i]),
      area(week.events[i], v => { week.events[i] = v; touch(); }, { minRows: 2 })))),

    h('div', { class: 'h-sec' }, 'Заметки и идеи'),
    area(week.notes, v => { week.notes = v; touch(); }, { minRows: 4 }),

    h('div', { class: 'h-sec' }, 'Трекер привычек'),
    habitTable(week, touch, mon),

    h('div', { class: 'h-sec' }, 'Фокус недели'),
    h('div', { class: 'sub' }, 'Две главные цели недели: они сильнее всего влияют на мои успехи и находятся в фокусе моего внимания каждый день.'),
    h('div', { class: 'goals' }, week.goals.map((g, i) => h('div', { class: 'box goal' },
      h('div', { class: 'lbl' }, `⟶ Цель ${i + 1}`),
      area(g.title, v => { g.title = v; touch(); }, { minRows: 2 }),
      g.steps.map(s => taskRow(s, touch))))),

    h('div', { class: 'h-page' }, 'Размышления о себе'),
    h('div', { class: 'h-sec' }, 'Осмысленность и мотивация'),
    h('div', { class: 'sub' }, 'Насколько хорошо у меня получается жить в соответствии с целями этой недели?'),
    area(week.meaning, v => { week.meaning = v; touch(); }, { minRows: 3 }),
    h('div', { class: 'h-sec' }, 'Успехи и прогресс'),
    h('div', { class: 'sub' }, 'Что у меня хорошо получилось сделать на этой неделе? Что я сделаю по-другому на следующей неделе?'),
    area(week.progress, v => { week.progress = v; touch(); }, { minRows: 3 }));
}
function habitTable(week, touch, mon) {
  const t = h('div', { class: 'hab' }, h('div', { class: 'habh' }),
    WD.map((w, i) => h('div', { class: 'habh' + (fmt(addDays(mon, i)) === today() ? ' cur' : '') }, w)));
  week.habits.forEach((hb, r) => {
    t.append(h('div', { class: 'habname' }, h('span', { class: 'n' }, `${r + 1}.`), line(hb.name, v => { hb.name = v; touch(); })));
    hb.days.forEach((d, i) => t.append(h('div', { class: 'habc' }, check(d, v => { hb.days[i] = v; touch(); }, 'chk sm'))));
  });
  return t;
}

/* ---------- страница месяца ---------- */
const RATINGS = [
  { group: 'Сочетание продуктивности с осознанностью: достигалось ли равновесие?', items: [
    ['focus', 'Фокус и концентрация'], ['meaning', 'Осмысленность и мотивация'], ['creativity', 'Творчество и вдохновение'], ['productivity', 'Продуктивность', true]] },
  { items: [['gratitude', 'Благодарность'], ['health', 'Здоровье'], ['calm', 'Спокойствие и выдержка'], ['mindfulness', 'Осознанность', true]] },
  { group: 'Как у меня дела в остальных сферах жизни?', items: [
    ['value', 'Моя ценность'], ['habits', 'Хорошие привычки'], ['pleasure', 'Удовольствие'], ['finance', 'Финансы'], ['family', 'Семья'], ['relations', 'Отношения'], ['mood', 'Общее настроение', true]] }];
function scale(value, onChange) {
  const row = h('div', { class: 'scale' });
  for (let n = 1; n <= 10; n++) {
    const b = h('button', { type: 'button', class: 'sc' + (value === n ? ' on' : '') }, String(n));
    b.addEventListener('click', () => {
      value = value === n ? null : n;
      onChange(value);
      row.querySelectorAll('.sc').forEach((x, i) => x.classList.toggle('on', i + 1 === value));
    });
    row.append(b);
  }
  return row;
}
async function viewMonth(mk) {
  if (!isMonth(mk)) mk = monthKeyOf(new Date());
  const [y, m] = mk.split('-').map(Number);
  const key = `month:${mk}`;
  const month = await load(key, DEF.month());
  const touch = () => save(key, month);
  const days = await Store.list(`day:${mk}-`);
  const filled = new Set(days.filter(d => dayHasContent(d.value)).map(d => d.key.slice(4)));
  const n = daysInMonth(y, m);
  const prev = new Date(y, m - 2, 1), next = new Date(y, m, 1);
  const picker = h('input', { type: 'month', class: 'monthpick', 'aria-label': 'Выбрать месяц' });
  picker.value = mk;
  picker.addEventListener('change', () => { if (isMonth(picker.value)) location.hash = `#/month/${picker.value}`; });
  const title = h('span', {}, `${MONTHS[m - 1]} ${y}`, picker);
  const triad = await currentTriad();

  const rows = [];
  for (let d = 1; d <= n; d++) {
    const ds = `${mk}-${pad(d)}`;
    const wi = wdIndex(ds);
    rows.push(h('div', { class: 'mrow' + (wi >= 5 ? ' we' : '') + (ds === today() ? ' today' : '') },
      h('a', { class: 'd', href: `#/day/${ds}` }, h('b', {}, String(d)), WD[wi]),
      line(month.notes[d] || '', v => { month.notes[d] = v; touch(); }, { plain: true }),
      h('a', { class: 'dot' + (filled.has(ds) ? '' : ' off'), href: `#/day/${ds}`, 'aria-label': 'Открыть день' })));
  }
  const evalBlock = h('div', { class: 'eval' },
    h('div', { class: 'h-page' }, 'Ежемесячная оценка'),
    h('div', { class: 'sub' }, `${MONTHS[m - 1]} ${y} · заполняется в конце месяца`),
    h('div', { class: 'box' },
      h('div', { class: 'h-sec tight' }, 'Успехи месяца'),
      h('div', { class: 'sub' }, 'В этом месяце я горжусь тем, что:'),
      month.pride.map((v, i) => h('div', { class: 'pride' }, h('span', { class: 'n' }, `${i + 1}.`), line(v, x => { month.pride[i] = x; touch(); })))),
    h('div', { class: 'h-sec' }, 'Ежемесячная проверка'),
    RATINGS.map(g => [
      g.group ? h('div', { class: 'group' }, g.group) : null,
      g.items.map(([id, label, bold]) => h('div', { class: 'rate' + (bold ? ' bold' : '') },
        h('div', { class: 'rl' }, label),
        scale(month.ratings[id] ?? null, v => { month.ratings[id] = v; touch(); })))]),
    h('div', { class: 'h-sec' }, 'Прогресс'),
    h('div', { class: 'sub' }, 'Эти знания я беру с собой в следующий месяц:'),
    area(month.progress, v => { month.progress = v; touch(); }, { minRows: 3 }));

  return h('div', {},
    topbar(`#/month/${monthKeyOf(prev)}`, title, `#/month/${monthKeyOf(next)}`),
    h('div', { class: 'h-page' }, 'План на месяц'),
    h('div', { class: 'monthhead' },
      h('span', { class: 'legend' }, h('span', { class: 'dot' }), 'день заполнен'),
      h('button', { type: 'button', class: 'linkbtn', onclick: () => evalBlock.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'оценка месяца ↓')),
    h('div', { class: 'sub' }, 'Название месяца сверху открывает выбор другого месяца.'),
    triadCard(triad),
    h('div', { class: 'mlist' }, rows),
    evalBlock);
}
const triadLen = tr => diffDays(tr.start, tr.end) + 1;
function progressText(n, total) {
  if (n < 1) return `начало через ${1 - n} дн.`;
  if (n <= total) return `День ${n} из ${total}`;
  return `Этап завершён ${n - total} дн. назад`;
}
function triadCard(tr) {
  if (!tr) return h('a', { class: 'triad-card', href: '#/triad' }, h('b', {}, 'Моя триада'), 'Ценность, цели, привычки и OKR на этап ещё не заданы ›');
  const n = diffDays(tr.start, today()) + 1, total = triadLen(tr);
  return h('a', { class: 'triad-card', href: `#/triad/${tr.start}` }, h('b', {}, 'Моя триада'),
    tr.value.trim() ? h('div', { class: 'tv' }, tr.value) : null,
    h('div', { class: 'progress left' }, progressText(n, total)),
    h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, Math.max(0, n / total * 100))}%` })));
}

/* ---------- триада ---------- */
async function triads() {
  return (await Store.list('triad:')).map(x => {
    const t = x.value;
    if (!t.end) t.end = addMonthsStr(t.start, 3);
    if (!Array.isArray(t.okrs)) t.okrs = [okr(), okr()];
    return t;
  }).sort((a, b) => a.start < b.start ? -1 : 1);
}
async function currentTriad() { const t = (await triads()).filter(x => x.start <= today()); return t[t.length - 1] || null; }
async function createTriad(start, kind) {
  if (!isDate(start)) return;
  const key = `triad:${start}`;
  const end = kind === '66d' ? fmt(addDays(parse(start), 65)) : addMonthsStr(start, 3);
  if (!(await Store.get(key))) await Store.put(key, DEF.triad(start, end));
  if (location.hash === `#/triad/${start}`) render(); else location.hash = `#/triad/${start}`;
}
function triadForm(label) {
  const d = dateInput(today(), () => {});
  const kind = h('select', { class: 'sel' }, h('option', { value: '3m' }, '3 месяца'), h('option', { value: '66d' }, '66 дней, как в книге'));
  return h('div', { class: 'form' },
    h('label', { class: 'formrow' }, h('span', { class: 'sub' }, 'Дата начала:'), d),
    h('label', { class: 'formrow' }, h('span', { class: 'sub' }, 'Длительность:'), kind),
    h('button', { class: 'btn primary', onclick: () => createTriad(d.value, kind.value) }, label));
}
function okrPct(o) {
  const ks = o.krs.filter(k => k.t.trim());
  if (!ks.length) return '';
  return Math.round(ks.reduce((a, k) => a + (+k.progress || 0), 0) / ks.length) + '%';
}
function okrList(tr, touch) {
  const wrap = h('div', { class: 'okrs' });
  const renderOkr = (o, i) => {
    const box = h('div', { class: 'box okr' });
    const pctEl = h('span', { class: 'okrpct' }, okrPct(o));
    box.append(h('div', { class: 'okrhead' }, h('span', { class: 'num gold' }, `O${i + 1}`), h('span', { class: 'okrlbl' }, 'Objective · цель'), pctEl),
      area(o.objective, v => { o.objective = v; touch(); }, { minRows: 1, placeholder: 'Чего хочу достичь за этап' }));
    const list = h('div', { class: 'krs' });
    const renderKr = (k, j) => {
      const pct = h('span', { class: 'krpct' }, (k.progress || 0) + '%');
      const range = h('input', { type: 'range', min: 0, max: 100, step: 5, class: 'krrange', 'aria-label': 'Прогресс' });
      range.value = k.progress || 0;
      range.addEventListener('input', () => { k.progress = +range.value; pct.textContent = k.progress + '%'; pctEl.textContent = okrPct(o); touch(); });
      return h('div', { class: 'kr' },
        h('div', { class: 'krline' }, h('span', { class: 'krn' }, `KR${j + 1}`), line(k.t, v => { k.t = v; pctEl.textContent = okrPct(o); touch(); }, { placeholder: 'Измеримый результат' })),
        h('div', { class: 'krprog' }, range, pct));
    };
    o.krs.forEach((k, j) => list.append(renderKr(k, j)));
    box.append(list, h('button', { type: 'button', class: 'addbtn', onclick: () => { const k = kr(); o.krs.push(k); list.append(renderKr(k, o.krs.length - 1)); touch(); } }, '+ ключевой результат'));
    return box;
  };
  tr.okrs.forEach((o, i) => wrap.append(renderOkr(o, i)));
  const add = h('button', { type: 'button', class: 'addbtn' }, '+ ещё одна цель');
  add.addEventListener('click', () => { const o = okr(); tr.okrs.push(o); add.before(renderOkr(o, tr.okrs.length - 1)); touch(); });
  wrap.append(add);
  return wrap;
}
async function viewTriad(start) {
  const all = await triads();
  let tr = isDate(start) ? all.find(x => x.start === start) : null;
  if (!tr && !isDate(start)) tr = all.filter(x => x.start <= today()).pop() || all[all.length - 1];
  if (!tr) return h('div', {}, topbar(null, 'Триада', null), h('div', { class: 'h-page' }, 'Моя триада'),
    h('p', { class: 'empty' }, 'Триада это ценность, три цели и три привычки на этап: три месяца или 66 дней, как в книге. Здесь же живут цели этапа в формате OKR. Укажи дату начала и длительность.'),
    triadForm('Создать триаду'),
    all.length ? h('a', { class: 'todaylink', href: '#/triad' }, 'к текущей триаде') : null);

  const key = `triad:${tr.start}`;
  const touch = () => save(key, tr);
  const idx = all.indexOf(tr);
  const prev = all[idx - 1], next = all[idx + 1];
  const n = diffDays(tr.start, today()) + 1, total = triadLen(tr);
  const hasReview = !!(await Store.get(`review:${tr.start}`));
  const newForm = triadForm('Начать'); newForm.style.display = 'none';

  return h('div', {},
    topbar(prev ? `#/triad/${prev.start}` : null, 'Триада', next ? `#/triad/${next.start}` : null),
    h('div', { class: 'h-page' }, 'Моя триада'),
    h('div', { class: 'datefield' }, `Этап ${idx + 1} · ${longDate(tr.start)} – ${longDate(tr.end)}`),
    h('div', { class: 'progress' }, progressText(n, total), h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, Math.max(0, n / total * 100))}%` }))),

    h('div', { class: 'h-sec' }, 'Ценность'),
    h('div', { class: 'sub' }, `На этой ценности я хочу сосредоточиться в ближайшие ${total} дней:`),
    h('div', { class: 'cells' }, h('div', { class: 'cell' }, h('span', { class: 'num gold' }, '1'), area(tr.value, v => { tr.value = v; touch(); }, { minRows: 2 }))),

    h('div', { class: 'h-sec' }, 'Цели'),
    h('div', { class: 'sub' }, 'Я хочу достичь следующих целей, связанных с этой ценностью:'),
    h('div', { class: 'cells' }, tr.goals.map((g, i) => h('div', { class: 'cell' }, h('span', { class: 'num' }, String(i + 1)), area(g, v => { tr.goals[i] = v; touch(); }, { minRows: 2 })))),

    h('div', { class: 'h-sec' }, 'Привычки'),
    h('div', { class: 'sub' }, 'Эти привычки помогут мне достичь моих целей и жить в соответствии с выбранной ценностью:'),
    h('div', { class: 'cells' }, tr.habits.map((g, i) => h('div', { class: 'cell' }, h('span', { class: 'num' }, String(i + 1)), area(g, v => { tr.habits[i] = v; touch(); }, { minRows: 2 })))),

    h('div', { class: 'h-page' }, 'Цели на этап · OKR'),
    h('div', { class: 'sub' }, 'Objective — чего хочу достичь. Key Results — измеримые результаты, по которым пойму, что получилось. Ползунок — насколько результат уже достигнут.'),
    okrList(tr, touch),

    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: `#/review/${tr.start}` }, hasReview ? 'Промежуточный обзор' : 'Пройти промежуточный обзор'),
      !next ? h('button', { class: 'btn primary', onclick: () => { newForm.style.display = newForm.style.display === 'none' ? '' : 'none'; } }, 'Начать новую триаду') : null),
    newForm,
    all.length > 1 ? h('div', { class: 'past' }, h('div', { class: 'h-sec' }, 'Все этапы'),
      all.map((t, i) => h('a', { href: `#/triad/${t.start}`, class: t === tr ? 'cur' : '' }, `${i + 1}. ${longDate(t.start)}${t.value.trim() ? ' · ' + t.value.trim() : ''}`))) : null);
}

/* ---------- 66-дневный промежуточный обзор ---------- */
const STATEMENTS = [
  'Я чувствую, что становлюсь ближе к своей ценности.',
  'Мною достигнуты многие цели.',
  'Мною приобретены привычки, которые помогают ежедневно соответствовать выбранной ценности.',
  'Я хочу продолжать работать над этой же ценностью.',
  'Я предпочту посвятить себя следующей ценности.'];
async function viewReview(start) {
  if (!isDate(start)) { location.replace('#/triad'); return h('div'); }
  const key = `review:${start}`;
  const rv = await load(key, DEF.review(start));
  const touch = () => save(key, rv);
  const tr = (await triads()).find(t => t.start === start);
  const okrs = tr ? tr.okrs.filter(o => o.objective.trim()) : [];
  const radio = (i, val) => {
    const r = h('input', { type: 'radio', class: 'chk', name: `q${i}` });
    r.checked = rv.answers[i] === val;
    r.addEventListener('change', () => { rv.answers[i] = val; touch(); });
    return r;
  };
  return h('div', {},
    topbar(`#/triad/${start}`, 'Обзор', null),
    h('div', { class: 'h-page' }, 'Промежуточный обзор'),
    tr ? h('div', { class: 'datefield' }, `Этап ${longDate(tr.start)} – ${longDate(tr.end)} · ${triadLen(tr)} дн.`) : null,
    h('div', { class: 'sub' }, 'Время прислушаться к себе, зафиксировать статус-кво, отметить результаты и обдумать дальнейшие шаги.'),
    h('label', { class: 'datefield' }, 'Дата:', dateInput(rv.date, v => { rv.date = v; touch(); })),
    h('div', { class: 'h-sec' }, 'Ценность'),
    h('div', { class: 'sub' }, 'Моя ценность в течение этого этапа:'),
    area(rv.value, v => { rv.value = v; touch(); }, { minRows: 2 }),
    h('div', { class: 'box' },
      h('div', { class: 'lbl', style: 'font-weight:700;color:var(--ink);text-transform:uppercase;font-size:12px;letter-spacing:.06em' }, 'Пройдена половина пути'),
      h('div', { class: 'sub left' }, 'Честно ответьте на следующие утверждения:'),
      h('div', { class: 'yn head' }, h('span'), h('span', {}, 'Да, очень'), h('span', {}, 'Нет')),
      STATEMENTS.map((s, i) => h('div', { class: 'yn' }, h('span', { class: 'st' }, '› ' + s), radio(i, 'yes'), radio(i, 'no')))),
    okrs.length ? [h('div', { class: 'h-sec' }, 'Итог по OKR'),
      okrs.map((o, i) => h('a', { class: 'okrsum', href: `#/triad/${start}` }, h('span', { class: 'num gold' }, `O${i + 1}`), h('span', { class: 'okrtitle' }, o.objective), h('b', {}, okrPct(o) || '—')))] : null,
    h('div', { class: 'h-sec' }, 'Мысли'),
    area(rv.notes, v => { rv.notes = v; touch(); }, { minRows: 6 }));
}

/* ---------- ещё: копии, настройки ---------- */
async function exportAll() {
  flushAll();
  const entries = (await Store.all()).filter(e => e.key !== 'meta:github');
  const history = await Store.history();
  const payload = { app: 'dnevnik6', version: 1, exportedAt: new Date().toISOString(), entries: Object.fromEntries(entries.map(e => [e.key, e.value])), history };
  const name = `6min-dnevnik-${today()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
async function importFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'dnevnik6' || !data.entries) throw new Error('это не файл копии дневника');
    const keys = Object.keys(data.entries);
    if (!confirm(`Восстановить ${keys.length} записей из копии от ${(data.exportedAt || '').slice(0, 10) || '?'}? Записи с теми же датами будут заменены, их прежние версии останутся в истории.`)) return;
    for (const k of keys) { if (k === 'meta:github') continue; if (await Store.put(k, data.entries[k])) await GH.markDirty(k, true); }
    GH.schedulePush();
    setStatus(`Восстановлено: ${keys.length}`);
    render();
  } catch (e) { alert('Не удалось восстановить: ' + e.message); }
}
async function viewSettings() {
  await getSettings();
  const entries = await Store.all();
  const days = entries.filter(e => e.key.startsWith('day:') && dayHasContent(e.value)).length;
  const weeks = entries.filter(e => e.key.startsWith('week:')).length;
  let persisted = null;
  try { persisted = await navigator.storage?.persisted?.(); } catch (e) { /* не поддерживается */ }
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  fileInput.addEventListener('change', () => importFile(fileInput.files[0]));
  return h('div', { class: 'settings' },
    topbar(null, 'Ещё', null),
    h('div', { class: 'h-page' }, 'Записи и копии'),
    h('p', {}, `Записи хранятся в памяти этого телефона внутри приложения и никуда не отправляются. Заполненных дней: ${days}, недель: ${weeks}. Каждая правка сохраняет прежнюю версию записи в истории, поэтому старое не пропадает.`),
    h('p', {}, 'Время от времени сохраняй копию: файл можно положить в iCloud Drive через «Файлы». Из копии всё восстанавливается на любом устройстве.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: exportAll }, 'Сохранить копию (JSON)'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Восстановить из копии'), fileInput),
    persisted === false ? h('p', {}, 'Браузер пока не подтвердил постоянное хранение. Добавь приложение на экран «Домой» и открывай его оттуда.') : null,
    await githubSection(),
    h('div', { class: 'h-page' }, 'О приложении'),
    h('p', { class: 'stat' }, `Цитат дня в приложении: ${(window.QUOTES || []).length}, по одной на каждый день года.`),
    h('p', { class: 'stat' }, 'Версия 0.5'));
}

/* ---------- копия в GitHub ---------- */
const GH = (() => {
  const DEFAULT_REPO = 'rinakzhigitov95-crypto/6min-dnevnik-data';
  let cfg = null, pushTimer = null, pushing = false, pulling = false, lastPull = 0, lastError = null;

  async function config() {
    if (!cfg) cfg = Object.assign({ token: '', repo: DEFAULT_REPO, branch: 'main', api: 'https://api.github.com' }, (await Store.get('meta:github')) || {});
    return cfg;
  }
  async function enabled() { const c = await config(); return !!(c.token && c.repo); }
  const syncable = key => /^(day|week|month|triad|review):/.test(key);
  const pathOf = key => { const i = key.indexOf(':'); return `${key.slice(0, i)}/${key.slice(i + 1)}.json`; };
  const keyOf = path => { const m = path.match(/^(day|week|month|triad|review)\/(.+)\.json$/); return m ? `${m[1]}:${m[2]}` : null; };
  const b64e = str => btoa(unescape(encodeURIComponent(str)));
  const b64d = b64 => decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));

  async function api(method, path, body) {
    const c = await config();
    let r;
    try {
      r = await fetch((c.api || 'https://api.github.com') + path, {
        method,
        headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error('нет связи с GitHub'); }
    if (r.status === 401) throw new Error('токен не принят');
    if (r.status === 403) throw new Error('доступ запрещён, проверь права токена');
    return r;
  }

  async function markDirty(key, quiet) {
    if (!syncable(key)) return;
    await Store.sput('dirty:' + key, Date.now());
    if (!quiet) schedulePush();
  }
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => push(), 3000); }

  async function pushOne(key, local, dirtyAt) {
    const c = await config();
    const path = pathOf(key);
    const body = { message: key.replace(':', ' '), content: b64e(JSON.stringify(local, null, 1)), branch: c.branch };
    const sha = await Store.sget('sha:' + key);
    if (sha) body.sha = sha;
    let r = await api('PUT', `/repos/${c.repo}/contents/${path}`, body);
    if (r.status === 409 || r.status === 422) {
      // версии разошлись: смотрим, что лежит в репозитории
      const g = await api('GET', `/repos/${c.repo}/contents/${path}?ref=${c.branch}`);
      if (g.ok) {
        const j = await g.json();
        const remote = JSON.parse(b64d(j.content));
        if ((remote.updatedAt || '') > (local.updatedAt || '')) {
          await Store.put(key, remote); // локальная версия уходит в историю, побеждает более свежая
          await Store.sput('sha:' + key, j.sha);
          await Store.sdel('dirty:' + key);
          return;
        }
        body.sha = j.sha;
      } else if (g.status === 404) delete body.sha;
      r = await api('PUT', `/repos/${c.repo}/contents/${path}`, body);
    }
    if (!r.ok) throw new Error('не удалось записать (' + r.status + ')');
    const j = await r.json();
    await Store.sput('sha:' + key, j.content.sha);
    if ((await Store.sget('dirty:' + key)) === dirtyAt) await Store.sdel('dirty:' + key);
  }
  async function push() {
    if (pushing || !navigator.onLine || !(await enabled())) return;
    pushing = true;
    try {
      const dirty = await Store.slist('dirty:');
      for (const d of dirty) {
        const key = d.key.slice(6);
        const local = await Store.get(key);
        if (!local) { await Store.sdel(d.key); continue; }
        await pushOne(key, local, d.value);
      }
      lastError = null;
      if (dirty.length) { await Store.sput('lastSync', Date.now()); setStatus('Отправлено в GitHub'); }
    } catch (e) { lastError = e.message; console.warn('push', e); setStatus('GitHub: ' + e.message, true); }
    finally { pushing = false; }
  }
  async function pull(force) {
    if (pulling || !navigator.onLine || !(await enabled())) return;
    if (!force && Date.now() - lastPull < 60000) return;
    pulling = true;
    try {
      const c = await config();
      const r = await api('GET', `/repos/${c.repo}/git/trees/${c.branch}?recursive=1`);
      if (r.status === 404 || r.status === 409) { lastPull = Date.now(); return; } // пустой репозиторий
      if (!r.ok) throw new Error('не удалось прочитать (' + r.status + ')');
      const tree = (await r.json()).tree.filter(t => t.type === 'blob');
      let changed = 0;
      for (const t of tree) {
        const key = keyOf(t.path);
        if (!key) continue;
        if ((await Store.sget('sha:' + key)) === t.sha) continue;
        const b = await api('GET', `/repos/${c.repo}/git/blobs/${t.sha}`);
        if (!b.ok) continue;
        const remote = JSON.parse(b64d((await b.json()).content));
        const local = await Store.get(key);
        const dirty = await Store.sget('dirty:' + key);
        if (!local || !dirty || (remote.updatedAt || '') > (local.updatedAt || '')) {
          if (await Store.put(key, remote)) changed++;
          if (dirty) await Store.sdel('dirty:' + key);
        }
        await Store.sput('sha:' + key, t.sha);
      }
      lastPull = Date.now(); lastError = null;
      await Store.sput('lastSync', Date.now());
      if (changed) {
        setStatus(`Получено из GitHub: ${changed}`);
        const a = document.activeElement;
        if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) render();
      }
    } catch (e) { lastError = e.message; console.warn('pull', e); setStatus('GitHub: ' + e.message, true); }
    finally { pulling = false; }
  }
  async function connect(repo, token) {
    if (!repo || !token) throw new Error('нужны и репозиторий, и токен');
    cfg = Object.assign(await config(), { repo, token });
    const r = await api('GET', `/repos/${repo}`);
    if (r.status === 404) throw new Error('репозиторий не найден или токен к нему не допущен');
    if (!r.ok) throw new Error('GitHub ответил ' + r.status);
    await Store.put('meta:github', cfg);
    // после подключения всё, что уже есть на устройстве, отправится в репозиторий
    for (const e of await Store.all()) if (syncable(e.key)) await Store.sput('dirty:' + e.key, Date.now());
  }
  async function disconnect() { cfg = Object.assign(await config(), { token: '' }); await Store.put('meta:github', cfg); }
  async function status() {
    return { enabled: await enabled(), lastSync: await Store.sget('lastSync'), pending: (await Store.slist('dirty:')).length, error: lastError };
  }
  function start() {
    window.addEventListener('online', () => pull(true).then(push));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull().then(push); });
    pull(true).then(push);
  }
  return { config, enabled, markDirty, schedulePush, push, pull, connect, disconnect, status, start };
})();

function syncStatusText(st) {
  if (!st.enabled) return 'Копия в GitHub не подключена.';
  const parts = [st.lastSync
    ? 'Последняя синхронизация: ' + new Date(st.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + '.'
    : 'Ещё не синхронизировалось.'];
  if (st.pending) parts.push(`Ждут отправки: ${st.pending}.`);
  if (st.error) parts.push('Ошибка: ' + st.error + '.');
  if (!navigator.onLine) parts.push('Сейчас нет сети, отправлю, когда появится.');
  return parts.join(' ');
}
async function githubSection() {
  const c = await GH.config();
  const msg = h('p', { class: 'stat' }, syncStatusText(await GH.status()));
  const repo = line(c.repo, () => {}, { placeholder: 'владелец/репозиторий' });
  repo.setAttribute('autocapitalize', 'off'); repo.setAttribute('spellcheck', 'false');
  const token = h('input', { class: 'line', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  token.value = c.token || '';
  const refresh = async () => { msg.textContent = syncStatusText(await GH.status()); };
  const connect = h('button', { class: 'btn primary' }, c.token ? 'Сохранить и проверить' : 'Подключить');
  connect.addEventListener('click', async () => {
    msg.textContent = 'Проверяю доступ…';
    try {
      await GH.connect(repo.value.trim(), token.value.trim());
      msg.textContent = 'Доступ есть. Загружаю записи из репозитория…';
      await GH.pull(true); await GH.push(); await refresh();
      connect.textContent = 'Сохранить и проверить';
    } catch (e) { msg.textContent = 'Не получилось: ' + e.message; }
  });
  const now = h('button', { class: 'btn' }, 'Синхронизировать сейчас');
  now.addEventListener('click', async () => { msg.textContent = 'Синхронизирую…'; await GH.pull(true); await GH.push(); await refresh(); });
  const off = h('button', { class: 'btn ghost' }, 'Отключить');
  off.addEventListener('click', async () => { if (confirm('Отключить копию в GitHub? Записи на телефоне останутся, в репозитории тоже.')) { await GH.disconnect(); render(); } });
  return h('div', {},
    h('div', { class: 'h-page' }, 'Копия в GitHub'),
    h('p', {}, 'Записи отправляются в твой приватный репозиторий на GitHub. Каждое сохранение становится коммитом, поэтому прежние версии не теряются, а на другом устройстве всё восстанавливается по тому же адресу.'),
    h('div', { class: 'lbl' }, 'Репозиторий:'), repo,
    h('div', { class: 'lbl' }, 'Токен доступа:'), token,
    h('div', { class: 'row' }, connect, c.token ? now : null, c.token ? off : null),
    msg);
}

/* ---------- навигация и маршруты ---------- */
const ICONS = {
  month: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  week: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M13 5v14M18 5v14"/></svg>',
  day: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>',
  triad: '<svg viewBox="0 0 24 24"><path d="M12 4l8 14H4z"/><circle cx="12" cy="4" r="1.3" fill="currentColor"/><circle cx="4" cy="18" r="1.3" fill="currentColor"/><circle cx="20" cy="18" r="1.3" fill="currentColor"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/></svg>'
};
function navItems(active) {
  const items = [
    ['month', `#/month/${monthKeyOf(new Date())}`, 'Месяц'],
    ['week', `#/week/${fmt(mondayOf(new Date()))}`, 'Неделя'],
    ['day', `#/day/${today()}`, 'День'],
    ['triad', '#/triad', 'Триада'],
    ['settings', '#/settings', 'Ещё']];
  return items.map(([id, href, label]) => h('a', { href, class: id === active ? 'on' : '' }, h('span', { html: ICONS[id] }), label));
}
const routes = { day: viewDay, week: viewWeek, month: viewMonth, triad: viewTriad, review: viewReview, settings: viewSettings };
let renderSeq = 0;
async function render() {
  flushAll();
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (!name) { location.replace(`#/day/${today()}`); return; }
  const seq = ++renderSeq;
  const view = routes[name] || viewDay;
  let node;
  try { node = await view(arg ? decodeURIComponent(arg) : undefined); }
  catch (e) { console.error(e); node = h('div', { class: 'err' }, 'Что-то пошло не так: ' + e.message); }
  if (seq !== renderSeq) return;
  const app = document.getElementById('app');
  app.replaceChildren(node);
  app.querySelectorAll('textarea.area').forEach(autosize);
  document.getElementById('nav').replaceChildren(...navItems(routes[name] ? (name === 'review' ? 'triad' : name) : 'day'));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);
window.addEventListener('load', async () => {
  try { await navigator.storage?.persist?.(); } catch (e) { /* не поддерживается */ }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  await render();
  GH.start();
});
