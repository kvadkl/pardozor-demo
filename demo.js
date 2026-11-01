"use strict";

const $ = (id) => document.getElementById(id);
const names = ["Пар в колонне", "Пар в кубе", "Вода после дефлегматора", "Температура отбора"];
const colors = ["#50c4ff", "#b574f0", "#50d2a1", "#ef9a47"];
const stageCopy = {
  1: "Температуры поднимаются. Оператор следит за выходом на рабочий режим.",
  2: "Колонна стабилизируется перед началом отбора.",
  3: "Медленный отбор голов, контроль температуры и целевого объёма.",
  4: "Основной отбор: температуры, объём и темп набора на одном экране.",
  5: "Сеанс завершён. Дальнейшие действия принимает оператор."
};
const eventCopy = {
  STAGE_CHANGED: ["Этап изменён", "Оператор перешёл к следующему этапу сеанса."],
  SELF_REFLUX_STARTED: ["Работа на себя началась", "Идёт стабилизация колонны."],
  SELF_REFLUX_COMPLETED: ["Работа на себя завершена", "Можно переходить к отбору голов."],
  SCALE_TARGET_REACHED: ["Целевой объём достигнут", "Порог веса вызывает оповещение, а не команду клапану."],
  TEMPERATURE_WARNING: ["Температура близка к пределу", "Контролируемая температура вышла из рабочего окна."],
  ALARM_ACTIVATED: ["Температурная тревога", "Устройство зафиксировало превышение заданного предела."],
  ALARM_ACKNOWLEDGED: ["Тревога подтверждена", "Оператор подтвердил событие; восстановление контролируется отдельно."],
  ALARM_CLEARED: ["Температура восстановилась", "Состояние тревоги снято после возврата в норму."],
  RECOVERY_STARTED: ["Восстановление", "Устройство ожидает устойчивого возврата температуры в рабочий диапазон."],
  RECOVERY_COMPLETED: ["Возврат в норму", "Устойчивость сигнала подтверждена."],
  VALVE_MANUAL_CLOSED: ["Ручное закрытие", "Оператор вручную изменил состояние клапана на стенде."],
  VALVE_MANUAL_OPENED: ["Ручное открытие", "Оператор вручную изменил состояние клапана на стенде."]
};
let data, samples, events, stageBounds, time = 0, playing = false, previousFrame = 0;

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor(s % 3600 / 60), s % 60].map(x => String(x).padStart(2, "0")).join(":");
}
function formatShort(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function nearestIndex(t) {
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (samples[mid].t < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && t - samples[lo - 1].t < samples[lo].t - t) return lo - 1;
  return lo;
}
function latestEvent(t) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].t <= t && eventCopy[events[i].code]) return events[i];
  return null;
}
function rateFor(index) {
  const current = samples[index], stage = current.stage;
  if (stage !== 3 && stage !== 4 || current.volume == null || current.volume < -2) return null;
  const window = stage === 3 ? 480 : 120;
  const low = current.t - window;
  let first = index;
  while (first > 0 && samples[first - 1].t >= low && samples[first - 1].stage === stage) first--;
  if (index - first < (stage === 3 ? 8 : 3)) return null;
  const points = samples.slice(first, index + 1).filter(x => x.volume != null && x.volume >= -2);
  if (points.length < 4) return null;
  const jumpLimit = stage === 3 ? 12 : 80;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i].volume - points[i - 1].volume) > jumpLimit) return null;
  const n = points.length;
  const tx = points.reduce((a, x) => a + x.t, 0) / n;
  const vy = points.reduce((a, x) => a + x.volume, 0) / n;
  let numerator = 0, denominator = 0;
  for (const point of points) { numerator += (point.t - tx) * (point.volume - vy); denominator += (point.t - tx) ** 2; }
  const value = denominator ? numerator / denominator * 3600 : 0;
  if (value < 0 || value > (stage === 3 ? 400 : 2400)) return null;
  return Math.round(value);
}
function renderSensors(sample, isAlarm) {
  $("sensor-grid").innerHTML = sample.temp.map((temp, i) => {
    const alert = isAlarm && i === 0;
    return `<article class="sensor-card"><div class="sensor-name"><strong>${names[i]}</strong><small>Датчик ${i + 1}</small></div><div class="sensor-temp ${alert ? "alarm" : ""}">${temp == null ? "—" : temp.toFixed(1)} °C</div><div class="sensor-bottom"><span>Состояние</span><strong>${alert ? "Тревога" : "Измерение"}</strong></div></article>`;
  }).join("");
}
function renderChart(index) {
  const canvas = $("chart"), box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(box.width * ratio)); canvas.height = Math.max(1, Math.round(box.height * ratio));
  const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
  const w = box.width, h = box.height, left = 5, right = w - 5, top = 7, bottom = h - 8;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#41536a"; ctx.globalAlpha = .48; ctx.lineWidth = 1;
  for (let c = 0; c <= 4; c++) { const y = top + (bottom - top) * c / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const x = t => left + (right - left) * (t - samples[0].t) / (samples[samples.length - 1].t - samples[0].t);
  const y = v => bottom - (bottom - top) * Math.min(100, Math.max(0, v)) / 100;
  for (let channel = 0; channel < 4; channel++) {
    ctx.strokeStyle = colors[channel]; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath(); let started = false;
    for (let i = 0; i <= index; i++) { const v = samples[i].temp[channel]; if (v == null) continue; if (started) ctx.lineTo(x(samples[i].t), y(v)); else { ctx.moveTo(x(samples[i].t), y(v)); started = true; } }
    ctx.stroke();
  }
  ctx.strokeStyle = "#e9f7ff"; ctx.globalAlpha = .75; ctx.lineWidth = 1;
  const cursorX = x(samples[index].t); ctx.beginPath(); ctx.moveTo(cursorX, top); ctx.lineTo(cursorX, bottom); ctx.stroke(); ctx.globalAlpha = 1;
}
function render() {
  if (!data) return;
  const index = nearestIndex(time), sample = samples[index], event = latestEvent(time);
  const stage = sample.stage, bounds = stageBounds[stage], goal = stage === 3 ? 150 : stage === 4 ? 1200 : null;
  const volumeValid = goal != null && sample.volume != null && sample.volume >= -2 && sample.volume < goal * 1.5;
  const volume = volumeValid ? Math.max(0, Math.round(sample.volume)) : null;
  const mass = volumeValid && sample.mass != null ? Math.max(0, Math.round(sample.mass)) : null;
  const rate = volumeValid ? rateFor(index) : null;
  const isAlarm = event?.code === "ALARM_ACTIVATED" && time - event.t < 180;
  $("clock").textContent = formatClock(time);
  $("seek").value = time;
  $("stage").textContent = data.stages[stage];
  $("stage-note").textContent = stageCopy[stage];
  $("stage-time").textContent = formatShort(sample.t - bounds.start);
  $("stage-progress").style.width = `${Math.max(1, Math.min(100, (sample.t - bounds.start) / (bounds.end - bounds.start) * 100))}%`;
  $("weight-value").innerHTML = `${mass == null ? "—" : mass} г <span>·</span> ${volume == null ? "—" : volume} мл`;
  $("rate").textContent = rate == null ? "—" : `${rate} мл/ч`;
  $("target").textContent = goal == null ? "—" : `${goal} мл`;
  $("eta").textContent = goal != null && rate > 0 && volume != null && volume < goal ? `${Math.ceil((goal - volume) / rate * 60)} мин` : "—";
  const reached = goal != null && volume != null && volume >= goal;
  const badge = $("weight-status"); badge.textContent = reached ? "Цель достигнута" : volumeValid ? "Показания есть" : "Ожидание"; badge.className = `status-badge ${reached ? "alert" : volumeValid ? "good" : ""}`;
  $("weight-note").textContent = volumeValid ? "Объём расчётный. Скорость для демо оценена по фрагменту записи." : stage >= 3 ? "Во время смены тары или снятия ёмкости прогноз не рассчитывается." : "Показания появятся на этапе отбора.";
  renderSensors(sample, isAlarm);
  $("event-title").textContent = event ? eventCopy[event.code][0] : "Начало сеанса";
  $("event-detail").textContent = event ? `${eventCopy[event.code][1]} Отметка ${formatClock(event.t)}.` : "Устройство записывает температуры и состояние процесса.";
  $("chart-time").textContent = formatClock(sample.t);
  document.querySelectorAll(".chapter-row button").forEach(button => button.classList.toggle("active", Number(button.dataset.stage) === stage));
  renderChart(index);
}
function setTime(t) { time = Math.max(samples[0].t, Math.min(samples[samples.length - 1].t, t)); render(); }
function togglePlay() { playing = !playing; previousFrame = performance.now(); $("play").textContent = playing ? "Ⅱ Пауза" : "▶ Воспроизвести"; $("play").setAttribute("aria-label", playing ? "Приостановить воспроизведение" : "Начать воспроизведение"); }
function tick(now) { if (playing && data) { const elapsed = Math.min(.2, (now - previousFrame) / 1000); time += elapsed * Number($("speed").value); if (time >= samples[samples.length - 1].t) { time = samples[samples.length - 1].t; togglePlay(); } render(); } previousFrame = now; requestAnimationFrame(tick); }
async function init() {
  try {
    const response = await fetch("data/session.json"); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json(); samples = data.samples; events = data.events;
    if (!Array.isArray(samples) || samples.length < 10) throw new Error("Нет измерений");
    stageBounds = {};
    for (const sample of samples) { if (!stageBounds[sample.stage]) stageBounds[sample.stage] = {start: sample.t, end: sample.t}; stageBounds[sample.stage].end = sample.t; }
    $("seek").min = samples[0].t; $("seek").max = samples[samples.length - 1].t;
    $("duration").textContent = `из ${formatClock(samples[samples.length - 1].t)}`;
    $("chart-end").textContent = `${Math.round(samples[samples.length - 1].t / 60)} мин`;
    $("chapters").innerHTML = Object.keys(stageBounds).map(stage => `<button type="button" data-stage="${stage}">${data.stages[stage]}</button>`).join("");
    $("chapters").addEventListener("click", e => { const button = e.target.closest("button[data-stage]"); if (button) setTime(stageBounds[Number(button.dataset.stage)].start); });
    $("seek").addEventListener("input", e => setTime(Number(e.target.value)));
    $("play").addEventListener("click", togglePlay);
    document.querySelector(".event-actions").addEventListener("click", e => {
      const button = e.target.closest("button[data-jump]"); if (!button) return;
      const jump = button.dataset.jump;
      if (jump === "heads") setTime(stageBounds[3].start + 120);
      if (jump === "body") setTime(stageBounds[4].start + 180);
      if (jump === "target") { const target = events.find(x => x.code === "SCALE_TARGET_REACHED" && x.t > stageBounds[4].start); if (target) setTime(target.t); }
      if (jump === "alarm") { const alarm = events.find(x => x.code === "ALARM_ACTIVATED" && x.t > stageBounds[4].start); if (alarm) setTime(alarm.t); }
    });
    window.addEventListener("resize", render);
    setTime(samples[0].t); requestAnimationFrame(tick);
  } catch (error) {
    $("stage").textContent = "Не удалось загрузить запись";
    $("stage-note").textContent = "Откройте сайт через HTTP-сервер или GitHub Pages.";
    console.error(error);
  }
}
init();
