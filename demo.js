"use strict";

const $ = id => document.getElementById(id);
const colors = ["#50c4ff", "#b574f0", "#50d2a1", "#ef9a47"];
const scenarios = {
  first: {
    file: "data/first-run.json",
    caption: "Переходы: два автоматических по температуре куба и один ручной. Кнопки демо только перематывают запись.",
    contextTitle: "Первый перегон · 12.10.2026",
    context: "Запись горячего испытания: четыре датчика и четыре этапа. Переход в подготовку охлаждения произошёл при 65 °C в кубе, к отбору сырца оператор перешёл вручную, завершение наступило при 98 °C в кубе.",
    extra: "В первые минуты стенда датчики подключались постепенно. Клапан был отключён, весы не использовались. Объём полученного сырца не измерялся устройством и в демо не показывается.",
    stageCopy: {
      1: "Нагрев до порога температуры в кубе.",
      2: "Достигнут порог 65 °C; оператор готовит охлаждение.",
      3: "Отбор сырца после ручного перехода оператора.",
      4: "Достигнут порог завершения 98 °C в кубе."
    },
    transition: {
      1: ["Ожидание 65 °C", "При достижении порога в кубе и выдержке 5 с устройство перейдёт к подготовке охлаждения."],
      2: ["Подготовить охлаждение", "Порог 65 °C сработал автоматически. Следующий переход к отбору сырца выполняет оператор."],
      3: ["Отбор сырца", "Оператор запустил этап вручную. Завершение настроено по 98 °C в кубе с выдержкой 5 с."],
      4: ["Завершение", "Порог 98 °C в кубе сработал автоматически. Клапан в испытании был отключён."]
    },
    jumps: [["Охлаждение · 65 °C", 2], ["Начало отбора сырца", 3], ["Завершение · 98 °C", 4]]
  },
  liquid: {
    file: "data/session.json",
    caption: "Переходы между этапами этого испытания выполнял оператор. Кнопки демо только перематывают запись.",
    contextTitle: "Отбор по жидкости · 30.10.2026",
    context: "В графике и карточках — измерения одного стендового теста. Скорость для демо вычислена по фрагменту записи и может отличаться от показания прошивки в тот момент.",
    extra: "Скачки при замене тары не интерпретируются как отбор. Целевой объём — оповещение оператору, а не команда клапану.",
    stageCopy: {
      1: "Температуры поднимаются; оператор наблюдает за нагревом.",
      2: "Работа на себя и стабилизация колонны перед отбором.",
      3: "Отбор голов с контролем температуры и целевого объёма.",
      4: "Отбор тела: температуры, расчётный объём и темп набора.",
      5: "Сеанс завершён; дальнейшие действия принимает оператор."
    },
    jumps: [["Начало голов", 3], ["Переход к телу", 4], ["Целевой объём", "SCALE_TARGET_REACHED"], ["Температурная тревога", "ALARM_ACTIVATED"]]
  }
};
const eventCopy = {
  SELF_REFLUX_STARTED: ["Работа на себя началась", "Идёт стабилизация колонны."],
  SELF_REFLUX_COMPLETED: ["Работа на себя завершена", "Можно переходить к отбору голов."],
  SCALE_TARGET_REACHED: ["Целевой объём достигнут", "Это оповещение оператору, а не команда клапану."],
  TEMPERATURE_WARNING: ["Температура близка к пределу", "Температура вышла из рабочего окна."],
  ALARM_ACTIVATED: ["Температурная тревога", "Устройство зафиксировало превышение заданного предела."],
  ALARM_ACKNOWLEDGED: ["Тревога подтверждена", "Оператор подтвердил событие."],
  ALARM_CLEARED: ["Температура восстановилась", "Состояние тревоги снято после возврата в норму."],
  RECOVERY_STARTED: ["Восстановление", "Устройство ожидает устойчивого возврата температуры в рабочий диапазон."],
  RECOVERY_COMPLETED: ["Возврат в норму", "Устойчивость сигнала подтверждена."],
  VALVE_MANUAL_CLOSED: ["Ручное закрытие клапана", "Оператор изменил состояние клапана на стенде."],
  VALVE_MANUAL_OPENED: ["Ручное открытие клапана", "Оператор изменил состояние клапана на стенде."]
};
let scenarioKey, data, samples = [], events = [], stageBounds = {}, time = 0, playing = false, previousFrame = 0, loadVersion = 0;

function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, "0")).join(":");
}
function shortClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function nearestIndex(t) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (samples[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo > 0 && t - samples[lo - 1].t < samples[lo].t - t ? lo - 1 : lo;
}
function latestEvent(t) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t <= t) return events[i];
  return null;
}
function eventText(event) {
  if (!event) return ["Начало записи", "Устройство записывает температуры и состояние процесса."];
  if (scenarioKey === "first") {
    const next = Math.min(4, (event.stage || 1) + 1);
    const descriptions = {
      2: ["Порог 65 °C", "Температура куба достигла 65 °C; переход к подготовке охлаждения выполнен автоматически."],
      3: ["Начало отбора сырца", "Оператор вручную перешёл от подготовки охлаждения к отбору сырца."],
      4: ["Порог 98 °C", "Температура куба достигла 98 °C; переход к завершению выполнен автоматически."]
    };
    return descriptions[next];
  }
  return eventCopy[event.code] || ["Этап изменён", "Оператор перешёл к следующему этапу сеанса."];
}
function rateFor(index) {
  const current = samples[index], stage = current.stage;
  if ((stage !== 3 && stage !== 4) || current.volume == null || current.volume < -2) return null;
  const windowSeconds = stage === 3 ? 480 : 120;
  let first = index;
  while (first > 0 && samples[first - 1].t >= current.t - windowSeconds && samples[first - 1].stage === stage) first--;
  if (index - first < (stage === 3 ? 8 : 3)) return null;
  const points = samples.slice(first, index + 1).filter(x => x.volume != null && x.volume >= -2);
  if (points.length < 4) return null;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i].volume - points[i - 1].volume) > (stage === 3 ? 12 : 80)) return null;
  const tx = points.reduce((sum, x) => sum + x.t, 0) / points.length;
  const vy = points.reduce((sum, x) => sum + x.volume, 0) / points.length;
  let numerator = 0, denominator = 0;
  for (const point of points) { numerator += (point.t - tx) * (point.volume - vy); denominator += (point.t - tx) ** 2; }
  const value = denominator ? numerator / denominator * 3600 : 0;
  return value >= 0 && value <= (stage === 3 ? 400 : 2400) ? Math.round(value) : null;
}
function renderSensors(sample, alarm) {
  $("sensor-grid").innerHTML = sample.temp.map((temp, i) => {
    const alert = alarm && i === 0;
    return `<article class="sensor-card"><div class="sensor-name"><strong>${data.sensors[i]}</strong><small>Датчик ${i + 1}</small></div><div class="sensor-temp ${alert ? "alarm" : ""}">${temp == null ? "—" : temp.toFixed(1)} °C</div><div class="sensor-bottom"><span>Состояние</span><strong>${alert ? "Тревога" : temp == null ? "Нет данных" : "Измерение"}</strong></div></article>`;
  }).join("");
}
function renderChart(index) {
  const canvas = $("chart"), box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const w = box.width, h = box.height, left = 5, right = w - 5, top = 7, bottom = h - 8;
  ctx.clearRect(0, 0, w, h); ctx.strokeStyle = "#41536a"; ctx.globalAlpha = .48; ctx.lineWidth = 1;
  for (let c = 0; c <= 4; c++) { const y = top + (bottom - top) * c / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const x = t => left + (right - left) * (t - samples[0].t) / (samples[samples.length - 1].t - samples[0].t);
  const y = value => bottom - (bottom - top) * Math.min(100, Math.max(0, value)) / 100;
  for (let channel = 0; channel < 4; channel++) {
    ctx.strokeStyle = colors[channel]; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath(); let started = false;
    for (let i = 0; i <= index; i++) { const value = samples[i].temp[channel]; if (value == null) continue; if (started) ctx.lineTo(x(samples[i].t), y(value)); else { ctx.moveTo(x(samples[i].t), y(value)); started = true; } }
    ctx.stroke();
  }
  ctx.strokeStyle = "#e9f7ff"; ctx.globalAlpha = .75; ctx.lineWidth = 1;
  const cursorX = x(samples[index].t); ctx.beginPath(); ctx.moveTo(cursorX, top); ctx.lineTo(cursorX, bottom); ctx.stroke(); ctx.globalAlpha = 1;
}
function renderWeight(sample, index) {
  const stage = sample.stage, goal = stage === 3 ? 150 : stage === 4 ? 1200 : null;
  const valid = goal != null && sample.volume != null && sample.volume >= -2 && sample.volume < goal * 1.5;
  const volume = valid ? Math.max(0, Math.round(sample.volume)) : null;
  const mass = valid && sample.mass != null ? Math.max(0, Math.round(sample.mass)) : null;
  const rate = valid ? rateFor(index) : null;
  $("weight-value").innerHTML = `${mass == null ? "—" : mass} г <span>·</span> ${volume == null ? "—" : volume} мл`;
  $("rate").textContent = rate == null ? "—" : `${rate} мл/ч`;
  $("target").textContent = goal == null ? "—" : `${goal} мл`;
  $("eta").textContent = goal != null && rate > 0 && volume != null && volume < goal ? `${Math.ceil((goal - volume) / rate * 60)} мин` : "—";
  const reached = goal != null && volume != null && volume >= goal;
  const badge = $("weight-status"); badge.textContent = reached ? "Цель достигнута" : valid ? "Показания есть" : "Ожидание";
  badge.className = `status-badge ${reached ? "alert" : valid ? "good" : ""}`;
  $("weight-note").textContent = valid ? "Объём расчётный. Скорость для демо оценена по фрагменту записи." : stage >= 3 ? "При смене тары или снятии ёмкости прогноз не рассчитывается." : "Показания появятся на этапе отбора.";
}
function render() {
  if (!data) return;
  const index = nearestIndex(time), sample = samples[index], stage = sample.stage, bounds = stageBounds[stage];
  const event = latestEvent(time), words = eventText(event);
  $("clock").textContent = clock(time); $("seek").value = time;
  $("stage").textContent = data.stages[stage]; $("stage-note").textContent = scenarios[scenarioKey].stageCopy[stage];
  $("stage-time").textContent = shortClock(sample.t - bounds.start);
  $("stage-progress").style.width = `${Math.max(1, Math.min(100, (sample.t - bounds.start) / Math.max(1, bounds.end - bounds.start) * 100))}%`;
  if (scenarioKey === "liquid") renderWeight(sample, index);
  else { const transition = scenarios.first.transition[stage]; $("transition-title").textContent = transition[0]; $("transition-detail").textContent = transition[1]; }
  renderSensors(sample, scenarioKey === "liquid" && event?.code === "ALARM_ACTIVATED" && time - event.t < 180);
  $("event-title").textContent = words[0];
  $("event-detail").textContent = `${words[1]}${event ? ` Отметка ${clock(event.t)}.` : ""}`;
  $("chart-time").textContent = clock(sample.t);
  document.querySelectorAll(".chapter-row button").forEach(button => button.classList.toggle("active", Number(button.dataset.stage) === stage));
  renderChart(index);
}
function setTime(t) { if (!samples.length) return; time = Math.max(samples[0].t, Math.min(samples[samples.length - 1].t, t)); render(); }
function setPlaying(value) {
  playing = value; previousFrame = performance.now();
  $("play").textContent = playing ? "Ⅱ Пауза" : "▶ Воспроизвести";
  $("play").setAttribute("aria-label", playing ? "Приостановить воспроизведение" : "Начать воспроизведение");
}
function tick(now) {
  if (playing && data) {
    time += Math.min(.2, (now - previousFrame) / 1000) * Number($("speed").value);
    if (time >= samples[samples.length - 1].t) { time = samples[samples.length - 1].t; setPlaying(false); }
    render();
  }
  previousFrame = now; requestAnimationFrame(tick);
}
async function loadScenario(key) {
  const version = ++loadVersion, profile = scenarios[key];
  if (!profile) return;
  setPlaying(false); data = null; scenarioKey = key;
  $("stage").textContent = "Загрузка записи…";
  try {
    const response = await fetch(profile.file); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const incoming = await response.json(); if (version !== loadVersion) return;
    if (!Array.isArray(incoming.samples) || incoming.samples.length < 10) throw new Error("Нет измерений");
    data = incoming; samples = data.samples; events = data.events; stageBounds = {};
    for (const sample of samples) { if (!stageBounds[sample.stage]) stageBounds[sample.stage] = {start: sample.t, end: sample.t}; stageBounds[sample.stage].end = sample.t; }
    $("seek").min = samples[0].t; $("seek").max = samples[samples.length - 1].t;
    $("duration").textContent = `из ${clock(samples[samples.length - 1].t)}`;
    $("chart-end").textContent = `${Math.round(samples[samples.length - 1].t / 60)} мин`;
    $("chapters").innerHTML = Object.keys(stageBounds).map(stage => `<button type="button" data-stage="${stage}">${data.stages[stage]}</button>`).join("");
    $("event-actions").innerHTML = profile.jumps.map(([label, target]) => {
      const seconds = typeof target === "number" ? stageBounds[target]?.start : events.find(event => event.code === target && event.t > (stageBounds[4]?.start || 0))?.t;
      return seconds == null ? "" : `<button type="button" data-time="${seconds}">${label} ↗</button>`;
    }).join("");
    $("chart-legend").innerHTML = data.sensors.map((name, i) => `<span><i class="series-${i + 1}"></i>${name}</span>`).join("");
    $("process-caption").textContent = profile.caption;
    $("context-title").textContent = profile.contextTitle; $("context-copy").textContent = profile.context; $("context-extra").textContent = profile.extra;
    $("scenario-source").textContent = data.source;
    $("weight-card").hidden = key !== "liquid"; $("transition-card").hidden = key !== "first"; $("context-gallery").hidden = key !== "liquid";
    document.querySelectorAll("[data-scenario]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.scenario === key)));
    if (window.history?.replaceState) window.history.replaceState(null, "", `?scenario=${key}`);
    setTime(samples[0].t);
  } catch (error) {
    if (version !== loadVersion) return;
    $("stage").textContent = "Не удалось загрузить запись";
    $("stage-note").textContent = "Откройте сайт через HTTP-сервер или GitHub Pages.";
    console.error(error);
  }
}
function init() {
  $("chapters").addEventListener("click", event => { const button = event.target.closest("button[data-stage]"); if (button) setTime(stageBounds[Number(button.dataset.stage)].start); });
  $("seek").addEventListener("input", event => setTime(Number(event.target.value)));
  $("play").addEventListener("click", () => { if (data) setPlaying(!playing); });
  $("event-actions").addEventListener("click", event => { const button = event.target.closest("button[data-time]"); if (button) setTime(Number(button.dataset.time)); });
  document.querySelectorAll("[data-scenario]").forEach(button => button.addEventListener("click", () => loadScenario(button.dataset.scenario)));
  window.addEventListener("resize", render);
  const selected = new URLSearchParams(window.location?.search || "").get("scenario");
  loadScenario(selected in scenarios ? selected : "first");
  requestAnimationFrame(tick);
}
init();
