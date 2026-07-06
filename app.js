const STORAGE_KEY = 'lifeos-v1';

const DOW_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];
const DOW_LABELS = { mon:'Пн', tue:'Вт', wed:'Ср', thu:'Чт', fri:'Пт', sat:'Сб', sun:'Вс' };
const PLAN_ICON = { strength:'🏋️', cardio:'🏃', rest:'😴' };

function defaultState(){
  return {
    settings: {
      fastStart: '19:00',
      fastEnd: '09:00',
      waterGoal: 8,
      wakeTime: '07:00',
      shutdown: '22:00',
      stepGoal: 8000
    },
    schedule: [
      { id: 's1', time: '07:00', label: 'Подъём и ритуал' },
      { id: 's2', time: '09:00', label: 'Глубокая работа' },
      { id: 's3', time: '13:00', label: 'Обед / отдых' },
      { id: 's4', time: '14:00', label: 'Встречи / рутина' },
      { id: 's5', time: '18:00', label: 'Личное время' },
      { id: 's6', time: '21:00', label: 'Отбой без экранов' }
    ],
    weekPlan: { mon:'strength', tue:'cardio', wed:'strength', thu:'cardio', fri:'strength', sat:'rest', sun:'rest' },
    cheatWeek: { weekKey: '', used: false },
    days: {}
  };
}

let state = loadState();

function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed, {
      settings: Object.assign(defaultState().settings, parsed.settings || {}),
      schedule: parsed.schedule && parsed.schedule.length ? parsed.schedule : defaultState().schedule,
      weekPlan: Object.assign(defaultState().weekPlan, parsed.weekPlan || {}),
      cheatWeek: parsed.cheatWeek || defaultState().cheatWeek,
      days: parsed.days || {}
    });
  } catch (e) {
    return defaultState();
  }
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---------- date helpers ----------
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtDate(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function dowKey(d){ return DOW_KEYS[d.getDay()]; }
function weekKey(d){
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7;
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((tmp - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay()+6)%7)) / 7);
  return `${tmp.getUTCFullYear()}-W${pad2(week)}`;
}
function timeToMinutes(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function minutesToHHMM(mins){
  mins = ((mins % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(mins/60))}:${pad2(mins%60)}`;
}

function todayKey(){ return fmtDate(new Date()); }
function yesterdayKey(){ const d = new Date(); d.setDate(d.getDate()-1); return fmtDate(d); }

function defaultDay(){
  return {
    water: 0,
    meals: { breakfast:false, lunch:false, dinner:false },
    wokeUp: false,
    wokeUpTime: null,
    scheduleDone: {},
    steps: 0,
    workoutDone: false,
    workoutType: null
  };
}

function ensureToday(){
  const key = todayKey();
  if (!state.days[key]) state.days[key] = defaultDay();
  const wk = weekKey(new Date());
  if (state.cheatWeek.weekKey !== wk) {
    state.cheatWeek = { weekKey: wk, used: false };
  }
  trimHistory();
  saveState();
  return state.days[key];
}

function trimHistory(){
  const keys = Object.keys(state.days).sort();
  if (keys.length > 60) {
    keys.slice(0, keys.length - 60).forEach(k => delete state.days[k]);
  }
}

function getDay(key){ return state.days[key] || null; }

// ---------- streaks ----------
function streakFor(checkFn){
  let count = 0;
  let d = new Date();
  if (!checkFn(fmtDate(d))) d.setDate(d.getDate()-1);
  while (true) {
    const key = fmtDate(d);
    if (checkFn(key)) { count++; d.setDate(d.getDate()-1); }
    else break;
  }
  return count;
}

function wakeCheck(key){
  const day = getDay(key);
  if (!day || !day.wokeUp || !day.wokeUpTime) return false;
  return timeToMinutes(day.wokeUpTime) <= timeToMinutes(state.settings.wakeTime) + 20;
}

function fitCheck(key){
  const d = new Date(key + 'T00:00:00');
  const plan = state.weekPlan[dowKey(d)];
  if (plan === 'rest') return true;
  const day = getDay(key);
  return !!(day && day.workoutDone);
}

function waterCheck(key){
  const day = getDay(key);
  return !!(day && day.water >= state.settings.waterGoal);
}

// ---------- fasting timer ----------
function fastingStatus(){
  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  const startMin = timeToMinutes(state.settings.fastEnd);   // eating window opens
  const endMin = timeToMinutes(state.settings.fastStart);   // eating window closes

  let eating;
  if (startMin < endMin) {
    eating = nowMin >= startMin && nowMin < endMin;
  } else {
    eating = nowMin >= startMin || nowMin < endMin;
  }

  let targetMin;
  if (eating) {
    targetMin = endMin > nowMin || startMin >= endMin ? endMin : endMin + 1440;
    if (targetMin <= nowMin) targetMin += 1440;
  } else {
    targetMin = startMin <= nowMin ? startMin + 1440 : startMin;
  }
  let diff = targetMin - nowMin - (now.getSeconds() > 0 ? 0 : 0);
  const totalSeconds = diff*60 - now.getSeconds();
  const hh = Math.floor(totalSeconds/3600);
  const mm = Math.floor((totalSeconds%3600)/60);
  const ss = totalSeconds%60;
  return {
    eating,
    label: eating ? `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}` : `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
  };
}

// ---------- rendering ----------
function renderTopbar(){
  const d = new Date();
  document.getElementById('topDate').textContent = d.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
  const titles = { today:'Сегодня', diet:'Питание', schedule:'График', fitness:'Спорт', stats:'Статистика' };
  document.getElementById('topTitle').textContent = titles[currentTab] || 'LifeOS';
}

function renderToday(){
  const day = ensureToday();
  const fs = fastingStatus();
  document.getElementById('fastState').textContent = fs.eating ? 'Окно питания открыто' : 'Голодание';
  document.getElementById('fastTimes').textContent = `${state.settings.fastEnd}–${state.settings.fastStart}`;
  document.getElementById('fastBig').textContent = fs.label;
  document.getElementById('fastSub').textContent = fs.eating ? 'до закрытия окна' : 'до открытия окна';

  document.getElementById('waterCount').textContent = `${day.water} / ${state.settings.waterGoal}`;
  const dotsEl = document.getElementById('waterDots');
  dotsEl.innerHTML = '';
  for (let i=0;i<state.settings.waterGoal;i++){
    const dot = document.createElement('div');
    dot.className = 'dot' + (i < day.water ? ' filled' : '');
    dot.textContent = i < day.water ? '💧' : '';
    dotsEl.appendChild(dot);
  }

  document.getElementById('nowStreak').textContent = `🔥 ${streakFor(wakeCheck)} дн.`;

  const now = new Date();
  const nowMin = now.getHours()*60 + now.getMinutes();
  const blocks = [...state.schedule].sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time));
  let currentLabel = '—';
  for (let i=0;i<blocks.length;i++){
    const startMin = timeToMinutes(blocks[i].time);
    const endMin = i+1 < blocks.length ? timeToMinutes(blocks[i+1].time) : 24*60;
    if (nowMin >= startMin && nowMin < endMin) currentLabel = blocks[i].label;
  }
  document.getElementById('currentBlock').textContent = currentLabel;

  const listEl = document.getElementById('todayScheduleList');
  listEl.innerHTML = '';
  blocks.forEach(b => {
    const startMin = timeToMinutes(b.time);
    const idx = blocks.indexOf(b);
    const endMin = idx+1 < blocks.length ? timeToMinutes(blocks[idx+1].time) : 24*60;
    const isNow = nowMin >= startMin && nowMin < endMin;
    const done = !!day.scheduleDone[b.id];
    const item = document.createElement('div');
    item.className = 'sched-item' + (isNow ? ' now' : '') + (done ? ' done' : '');
    item.innerHTML = `<div class="check-circle${done?' checked':''}"></div><div class="time">${b.time}</div><div class="label">${b.label}</div>`;
    item.querySelector('.check-circle').addEventListener('click', () => {
      day.scheduleDone[b.id] = !day.scheduleDone[b.id];
      saveState(); renderToday();
    });
    listEl.appendChild(item);
  });

  const badgesEl = document.getElementById('badgesRow');
  badgesEl.innerHTML = '';
  const fitStreak = streakFor(fitCheck);
  const waterStreak = streakFor(waterCheck);
  [
    ['💪 Спорт', `${fitStreak} дн.`],
    ['💧 Вода', `${waterStreak} дн.`]
  ].forEach(([label,val]) => {
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `<div class="muted">${label}</div><div style="font-weight:700;font-size:16px;margin-top:2px">${val}</div>`;
    badgesEl.appendChild(b);
  });
}

function renderDiet(){
  const day = ensureToday();
  document.getElementById('fastEndInput').value = state.settings.fastEnd;
  document.getElementById('fastStartInput').value = state.settings.fastStart;
  document.getElementById('waterGoalInput').value = state.settings.waterGoal;

  const mealsEl = document.getElementById('mealChecklist');
  mealsEl.innerHTML = '';
  const mealLabels = { breakfast:'Завтрак', lunch:'Обед', dinner:'Ужин' };
  Object.keys(mealLabels).forEach(k => {
    const checked = day.meals[k];
    const item = document.createElement('div');
    item.className = 'check-item' + (checked ? ' checked' : '');
    item.innerHTML = `<div class="check-circle${checked?' checked':''}"></div><div class="label">${mealLabels[k]}</div>`;
    item.addEventListener('click', () => {
      day.meals[k] = !day.meals[k];
      saveState(); renderDiet();
    });
    mealsEl.appendChild(item);
  });

  document.getElementById('cheatStatus').textContent = state.cheatWeek.used ? 'использован' : 'не использован';
  document.getElementById('cheatBtn').disabled = state.cheatWeek.used;
  document.getElementById('cheatBtn').textContent = state.cheatWeek.used ? 'Уже использован на этой неделе' : 'Отметить чит-приём';
}

function renderScheduleTab(){
  ensureToday();
  document.getElementById('wakeTimeInput').value = state.settings.wakeTime;
  document.getElementById('shutdownInput').value = state.settings.shutdown;
  document.getElementById('wakeStreak').textContent = `🔥 ${streakFor(wakeCheck)} дн.`;

  const day = ensureToday();
  const statusEl = document.getElementById('wakeStatus');
  statusEl.textContent = day.wokeUp ? `Отмечено сегодня в ${day.wokeUpTime}` : 'Ещё не отмечено сегодня';

  const listEl = document.getElementById('scheduleEditList');
  listEl.innerHTML = '';
  [...state.schedule].sort((a,b)=>timeToMinutes(a.time)-timeToMinutes(b.time)).forEach(b => {
    const item = document.createElement('div');
    item.className = 'sched-item';
    item.innerHTML = `
      <input class="time-input" type="time" value="${b.time}">
      <input class="label-input" type="text" value="${b.label}">
      <button class="del-btn">✕</button>`;
    item.querySelector('.time-input').addEventListener('change', e => { b.time = e.target.value; saveState(); renderScheduleTab(); });
    item.querySelector('.label-input').addEventListener('change', e => { b.label = e.target.value; saveState(); });
    item.querySelector('.del-btn').addEventListener('click', () => {
      state.schedule = state.schedule.filter(x => x.id !== b.id);
      saveState(); renderScheduleTab();
    });
    listEl.appendChild(item);
  });
}

function renderFitness(){
  const day = ensureToday();
  const gridEl = document.getElementById('weekPlanGrid');
  gridEl.innerHTML = '';
  const todayDow = dowKey(new Date());
  const order = ['mon','tue','wed','thu','fri','sat','sun'];
  order.forEach(dk => {
    const col = document.createElement('div');
    col.className = 'day-col';
    const plan = state.weekPlan[dk];
    const isToday = dk === todayDow;
    let done = false;
    if (isToday) done = plan === 'rest' ? true : day.workoutDone;
    col.innerHTML = `
      <div class="dname">${DOW_LABELS[dk]}</div>
      <div class="day-pill${done?' done':''}${isToday?' today':''}">${PLAN_ICON[plan]}</div>`;
    col.querySelector('.day-pill').addEventListener('click', () => {
      const order2 = ['strength','cardio','rest'];
      const next = order2[(order2.indexOf(plan)+1)%order2.length];
      state.weekPlan[dk] = next;
      saveState(); renderFitness();
    });
    gridEl.appendChild(col);
  });

  const plan = state.weekPlan[todayDow];
  const logEl = document.getElementById('todayLog');
  logEl.innerHTML = '';
  if (plan === 'rest') {
    logEl.innerHTML = `<div class="hint">Сегодня день отдыха 😴</div>`;
  } else {
    const btn = document.createElement('button');
    btn.className = 'btn' + (day.workoutDone ? ' active' : ' ghost');
    btn.style.flex = '1';
    btn.textContent = day.workoutDone ? `✓ ${plan === 'strength' ? 'Силовая выполнена' : 'Кардио выполнено'}` : `Отметить: ${plan === 'strength' ? 'Силовая' : 'Кардио'}`;
    btn.addEventListener('click', () => {
      day.workoutDone = !day.workoutDone;
      day.workoutType = day.workoutDone ? plan : null;
      saveState(); renderFitness(); renderToday();
    });
    logEl.appendChild(btn);
  }

  document.getElementById('fitStreak').textContent = `🔥 ${streakFor(fitCheck)} дн.`;
  document.getElementById('stepsInput').value = day.steps || '';
  const pct = Math.min(100, Math.round((day.steps||0) / state.settings.stepGoal * 100));
  document.getElementById('stepsFill').style.width = pct + '%';
  document.getElementById('stepsHint').textContent = `${day.steps||0} / ${state.settings.stepGoal} шагов`;
}

function renderStats(){
  ensureToday();
  const gridEl = document.getElementById('statsWeek');
  gridEl.innerHTML = '';
  const days = [];
  for (let i=6;i>=0;i--){
    const d = new Date(); d.setDate(d.getDate()-i);
    days.push(d);
  }
  let waterGood=0, wakeGood=0, fitGood=0, totalCounted=0;
  days.forEach(d => {
    const key = fmtDate(d);
    const day = getDay(key);
    const col = document.createElement('div');
    col.className = 'stat-day';
    const isFuture = key > todayKey();
    const overall = day ? (waterCheck(key) && wakeCheck(key) && fitCheck(key)) : false;
    col.innerHTML = `<div class="dname">${d.toLocaleDateString('ru-RU',{weekday:'short'})}</div><div class="stat-dot ${isFuture ? '' : (overall ? 'good' : 'bad')}"></div>`;
    gridEl.appendChild(col);
    if (!isFuture && day) {
      totalCounted++;
      if (waterCheck(key)) waterGood++;
      if (wakeCheck(key)) wakeGood++;
      if (fitCheck(key)) fitGood++;
    }
  });
  const pct = n => totalCounted ? Math.round(n/totalCounted*100) : 0;
  document.getElementById('statWater').textContent = pct(waterGood) + '%';
  document.getElementById('statWake').textContent = pct(wakeGood) + '%';
  document.getElementById('statFit').textContent = pct(fitGood) + '%';
}

const renderers = { today: renderToday, diet: renderDiet, schedule: renderScheduleTab, fitness: renderFitness, stats: renderStats };

let currentTab = 'today';
function switchTab(tab){
  currentTab = tab;
  document.querySelectorAll('.view').forEach(v => v.hidden = v.dataset.view !== tab);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderTopbar();
  renderers[tab]();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------- event wiring ----------
document.getElementById('waterPlus').addEventListener('click', () => {
  const day = ensureToday();
  day.water++; saveState(); renderToday();
});
document.getElementById('waterMinus').addEventListener('click', () => {
  const day = ensureToday();
  day.water = Math.max(0, day.water - 1); saveState(); renderToday();
});

document.getElementById('fastEndInput').addEventListener('change', e => { state.settings.fastEnd = e.target.value; saveState(); renderDiet(); });
document.getElementById('fastStartInput').addEventListener('change', e => { state.settings.fastStart = e.target.value; saveState(); renderDiet(); });
document.getElementById('waterGoalInput').addEventListener('change', e => { state.settings.waterGoal = Math.max(1, Number(e.target.value)||8); saveState(); renderDiet(); });

document.getElementById('cheatBtn').addEventListener('click', () => {
  if (state.cheatWeek.used) return;
  state.cheatWeek.used = true; saveState(); renderDiet();
});

document.getElementById('wakeTimeInput').addEventListener('change', e => { state.settings.wakeTime = e.target.value; saveState(); renderScheduleTab(); });
document.getElementById('shutdownInput').addEventListener('change', e => { state.settings.shutdown = e.target.value; saveState(); });
document.getElementById('wakeUpBtn').addEventListener('click', () => {
  const day = ensureToday();
  const now = new Date();
  day.wokeUp = true;
  day.wokeUpTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  saveState(); renderScheduleTab(); renderToday();
});
document.getElementById('addBlockBtn').addEventListener('click', () => {
  const id = 's' + Date.now();
  state.schedule.push({ id, time: '12:00', label: 'Новый блок' });
  saveState(); renderScheduleTab();
});

document.getElementById('stepsInput').addEventListener('change', e => {
  const day = ensureToday();
  day.steps = Math.max(0, Number(e.target.value)||0);
  saveState(); renderFitness();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Удалить все данные приложения без возможности восстановления?')) {
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    ensureToday();
    renderers[currentTab]();
  }
});

// ---------- init ----------
ensureToday();
switchTab('today');
setInterval(() => { if (currentTab === 'today') renderToday(); }, 1000);
setInterval(() => { ensureToday(); }, 60000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
