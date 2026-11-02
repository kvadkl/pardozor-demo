(() => {
  "use strict";

  const names = ["Пар в колонне", "Жидкость в кубе", "Охлаждающая вода", "Температура отбора"];
  const colors = ["#50c4ff", "#b574f0", "#50d2a1", "#ef9a47"];
  const scenarios = {
    first: {
      name: "Первый перегон",
      description: "Нагрев → подготовка охлаждения при 65 °C в кубе → ручной переход к отбору сырца → завершение при 98 °C в кубе.",
      profile: [[0, 25, 25, 20, 25], [1800, 40, 55, 24, 25], [3600, 77, 90, 52, 26], [7200, 97, 97, 55, 20], [9000, 99, 98.5, 40, 24]],
      stages: [
        {name: "Нагрев", policy: "closed"},
        {name: "Подготовить охлаждение", policy: "closed", trigger: {sensor: 1, above: 65}},
        {name: "Отбор сырца", policy: "closed"},
        {name: "Завершение", policy: "closed", trigger: {sensor: 1, above: 98}}
      ]
    },
    liquid: {
      name: "Отбор по жидкости",
      description: "Нагрев, работа на себя, головы, тело и завершение. На головах показан медленный поток, на теле — быстрый; весы оповещают о цели, но не переключают клапан.",
      profile: [[0, 25, 25, 19, 26], [1800, 77.3, 85, 52, 26], [3600, 77.3, 86, 55, 26], [8000, 77.5, 92, 55, 21], [14000, 77.6, 96, 52, 22], [18000, 77.8, 98, 51, 24]],
      stages: [
        {name: "Нагрев", policy: "closed"},
        {name: "Работа на себя", policy: "closed", timer: 1200},
        {name: "Головы", policy: "open", flow: 110},
        {name: "Тело", policy: "automatic", flow: 1400},
        {name: "Завершение", policy: "closed", flow: 0}
      ]
    },
    vapor: {
      name: "Контроль по пару",
      description: "Пять ручных этапов с наблюдением за температурой пара в колонне. В этом шаблоне клапан не открывается автоматически.",
      profile: [[0, 25, 25, 20, 25], [1800, 77, 84, 45, 24], [3600, 77.4, 87, 53, 23], [9000, 78.1, 93, 53, 22], [15000, 86, 98, 48, 24]],
      stages: [
        {name: "Нагрев", policy: "closed"},
        {name: "Работа на себя", policy: "closed", timer: 1200},
        {name: "Головы", policy: "closed"},
        {name: "Тело", policy: "closed"},
        {name: "Хвосты", policy: "closed"}
      ]
    },
    observe: {
      name: "Наблюдение",
      description: "Четыре температуры, опорные значения, тревоги и график без заранее заданных переходов и автоматического открытия клапана.",
      profile: [[0, 25, 25, 20, 25], [1800, 77, 85, 52, 26], [5400, 77.4, 90, 54, 23], [12000, 78.2, 97, 50, 24]],
      stages: [{name: "Наблюдение", policy: "closed"}]
    }
  };

  const el = id => document.getElementById(id);
  const elements = Object.fromEntries([
    "scenario", "run", "speed", "reset", "scenario-description", "feedback", "process-name", "clock", "stage-name", "stage-hint", "prev-stage", "next-stage", "stage-strip", "process-note", "valve-state", "valve-mode-label", "valve-reason", "weight-main", "weight-state", "flow-reading", "target-reading", "eta-reading", "weight-note", "scale-enabled", "strength", "liquid-temp", "target-input", "flow-input", "apply-weight", "tare", "remove-vessel", "sensors", "chart", "chart-clock", "sensor-choice", "sensor-value", "sensor-tolerance", "set-reading", "clear-reading", "set-reference", "toggle-sensor", "events", "clear-log"
  ].map(id => [id, el(id)]));
  let state;
  let lastTick = performance.now();

  function fmtTime(seconds) {
    const n = Math.max(0, Math.floor(seconds));
    return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, "0")).join(":");
  }

  function round(value, digits = 0) { return Number(value.toFixed(digits)); }
  function volume() { return state.grams / density(); }
  function density() {
    // Deliberately approximate browser model, not the calibration table in firmware.
    return Math.max(0.74, 0.9982 - 0.0012 * state.strength - 0.000008 * state.strength ** 2 - 0.00085 * (state.liquidTemp - 20));
  }

  function baseline(sensor) {
    const profile = scenarios[state.scenario].profile;
    if (state.time <= profile[0][0]) return profile[0][sensor + 1];
    for (let i = 1; i < profile.length; i++) {
      if (state.time <= profile[i][0]) {
        const a = profile[i - 1], b = profile[i];
        const fraction = (state.time - a[0]) / (b[0] - a[0]);
        return a[sensor + 1] + (b[sensor + 1] - a[sensor + 1]) * fraction;
      }
    }
    return profile[profile.length - 1][sensor + 1];
  }

  function reading(sensor) {
    if (state.disconnected[sensor]) return null;
    return state.override[sensor] === null ? baseline(sensor) : state.override[sensor];
  }

  function event(message, alert = false) {
    state.events.unshift({t: state.time, message, alert});
    state.events.length = Math.min(state.events.length, 80);
  }

  function feedback(message, error = false) {
    elements.feedback.textContent = message;
    elements.feedback.classList.toggle("error", error);
    elements.feedback.hidden = false;
  }

  function clearFeedback() { elements.feedback.hidden = true; }

  function currentStage() { return scenarios[state.scenario].stages[state.stage]; }

  function valveOpen() {
    if (state.valveMode === "open") return true;
    if (state.valveMode === "closed") return false;
    const policy = currentStage().policy;
    if (policy === "open") return true;
    if (policy === "automatic") return !state.disconnected[0] && !state.alarms[0] && state.reference[0] !== null;
    return false;
  }

  function advance(to, automatic = false) {
    const stages = scenarios[state.scenario].stages;
    if (to < 0 || to >= stages.length || to === state.stage) return;
    state.stage = to;
    state.stageStarted = state.time;
    const stage = stages[to];
    if (stage.flow !== undefined && !state.customFlow) {
      state.flow = stage.flow;
      elements["flow-input"].value = String(stage.flow);
    }
    if (stage.policy === "automatic" && state.reference[0] === null && reading(0) !== null) {
      state.reference[0] = reading(0);
      event("Опорная температура колонны зафиксирована для автоматического режима");
    }
    event(`${automatic ? "Автопереход" : "Переход оператора"}: ${stage.name}`);
  }

  function checkAlarms() {
    for (let i = 0; i < 4; i++) {
      if (state.disconnected[i]) {
        if (!state.alarms[i]) { state.alarms[i] = true; event(`Обрыв датчика: ${names[i]}`, true); }
        state.alarmStarted[i] = null;
        state.recoveryStarted[i] = null;
        continue;
      }
      const ref = state.reference[i];
      const bad = ref !== null && Math.abs(reading(i) - ref) > state.tolerance[i];
      if (bad) {
        state.recoveryStarted[i] = null;
        if (state.alarmStarted[i] === null) state.alarmStarted[i] = state.time;
        if (!state.alarms[i] && state.time - state.alarmStarted[i] >= 5) {
          state.alarms[i] = true;
          event(`Тревога: ${names[i]} вышел за допуск`, true);
        }
      } else {
        state.alarmStarted[i] = null;
        if (state.alarms[i]) {
          if (state.recoveryStarted[i] === null) state.recoveryStarted[i] = state.time;
          if (state.time - state.recoveryStarted[i] >= 30) {
            state.alarms[i] = false;
            state.recoveryStarted[i] = null;
            event(`Восстановление: ${names[i]} в норме`);
          }
        }
      }
    }
  }

  function checkAutomaticTransition() {
    const next = scenarios[state.scenario].stages[state.stage + 1];
    if (!next || !next.trigger) return;
    const temp = reading(next.trigger.sensor);
    if (temp !== null && temp >= next.trigger.above) advance(state.stage + 1, true);
  }

  function checkValveChange() {
    const open = valveOpen();
    if (open !== state.lastValve) {
      state.lastValve = open;
      event(`Виртуальный клапан ${open ? "открыт" : "закрыт"}`);
    }
  }

  function checkTarget() {
    if (state.scaleEnabled && !state.targetReached && state.target > 0 && volume() >= state.target) {
      state.targetReached = true;
      event(`Целевой объём ${state.target} мл достигнут; клапан не переключается`, true);
    }
  }

  function evaluate() {
    checkAlarms();
    checkAutomaticTransition();
    checkValveChange();
    checkTarget();
  }

  function sampleHistory() {
    state.history.push({t: state.time, temp: names.map((_, i) => reading(i))});
    if (state.history.length > 500) state.history.shift();
  }

  function reset(scenario = elements.scenario.value) {
    const selected = Object.hasOwn(scenarios, scenario) ? scenario : "first";
    state = {
      scenario: selected, running: false, time: 0, stage: 0, stageStarted: 0,
      speed: Number(elements.speed.value) || 300, selectedSensor: 0,
      override: [null, null, null, null], disconnected: [false, false, false, false],
      reference: [null, null, null, null], tolerance: [0.2, 2, 5, 2],
      alarmStarted: [null, null, null, null], recoveryStarted: [null, null, null, null],
      alarms: [false, false, false, false], valveMode: "auto", lastValve: false,
      scaleEnabled: selected === "liquid", vesselPresent: true, grams: 0,
      strength: 95, liquidTemp: 20, target: selected === "liquid" ? 1200 : 0,
      targetReached: false, flow: selected === "liquid" ? 1400 : 0, customFlow: false,
      history: [], events: []
    };
    elements.scenario.value = selected;
    elements["scale-enabled"].checked = state.scaleEnabled;
    elements.strength.value = "95";
    elements["liquid-temp"].value = "20";
    elements["target-input"].value = String(state.target);
    elements["flow-input"].value = String(state.flow);
    elements["sensor-choice"].value = "0";
    syncSensorControls();
    clearFeedback();
    event(`Новый виртуальный цикл: ${scenarios[selected].name}`);
    sampleHistory();
    lastTick = performance.now();
    render();
  }

  function syncSensorControls() {
    const i = state.selectedSensor;
    elements["sensor-choice"].value = String(i);
    elements["sensor-value"].value = reading(i) === null ? "" : round(reading(i), 1).toFixed(1);
    elements["sensor-tolerance"].value = String(state.tolerance[i]);
    elements["toggle-sensor"].textContent = state.disconnected[i] ? "Восстановить датчик" : "Отключить датчик";
  }

  function renderStage() {
    const scenario = scenarios[state.scenario];
    const stage = currentStage();
    elements["process-name"].textContent = scenario.name;
    elements["scenario-description"].textContent = scenario.description;
    elements.clock.textContent = fmtTime(state.time);
    elements["stage-name"].textContent = stage.name;
    elements["prev-stage"].disabled = state.stage === 0;
    elements["next-stage"].disabled = state.stage === scenario.stages.length - 1;
    const next = scenario.stages[state.stage + 1];
    elements["next-stage"].textContent = next ? `К этапу «${next.name}» →` : "Последний этап";
    if (stage.timer) {
      const remain = Math.max(0, stage.timer - (state.time - state.stageStarted));
      elements["stage-hint"].textContent = remain ? `Работа на себя · осталось ${fmtTime(remain)}` : "Работа на себя завершена · переход по решению оператора";
    } else if (next?.trigger) {
      elements["stage-hint"].textContent = `Следующий этап автоматически при ${next.trigger.above} °C: ${names[next.trigger.sensor].toLowerCase()}`;
    } else {
      elements["stage-hint"].textContent = next ? "Переход на следующий этап — по решению оператора" : "Последний этап процесса";
    }
    elements["process-note"].textContent = state.running ? `Виртуальное время ×${state.speed}. Можно менять показания и режим клапана на ходу.` : "Симуляция на паузе. Измените параметры и нажмите «Запустить».";
    elements.run.textContent = state.running ? "Ⅱ Пауза" : "▶ Запустить";
    elements["stage-strip"].replaceChildren(...scenario.stages.map((item, index) => {
      const chip = document.createElement("span");
      chip.textContent = item.name;
      if (index === state.stage) chip.className = "active";
      else if (index < state.stage) chip.className = "done";
      return chip;
    }));
  }

  function renderValve() {
    const open = valveOpen();
    elements["valve-state"].textContent = open ? "Открыт" : "Закрыт";
    elements["valve-state"].className = open ? "open" : state.alarms[0] && state.valveMode === "auto" ? "alarm" : "";
    elements["valve-mode-label"].textContent = state.valveMode === "auto" ? "Автоматика" : state.valveMode === "open" ? "Открыт вручную" : "Закрыт вручную";
    elements["valve-mode-label"].className = `stand-pill${open ? " warn" : " good"}`;
    const policy = currentStage().policy;
    let reason = "";
    if (state.valveMode === "open") reason = "Команда оператора: открыт. При тревоге ручной режим сохраняется.";
    else if (state.valveMode === "closed") reason = "Команда оператора: закрыт. Автоматический режим отключён до передачи управления.";
    else if (policy === "open") reason = "Этап предусматривает открытый клапан.";
    else if (policy === "automatic") reason = open ? "Температура колонны в контрольном окне; управление автоматическое." : "Контроль температуры колонны недоступен или есть тревога; клапан закрыт.";
    else reason = "Для текущего этапа задан закрытый клапан.";
    elements["valve-reason"].textContent = reason;
    document.querySelectorAll("[data-valve]").forEach(button => {
      button.classList.toggle("active", button.dataset.valve === state.valveMode);
      button.setAttribute("aria-pressed", button.dataset.valve === state.valveMode ? "true" : "false");
    });
  }

  function renderWeight() {
    if (!state.scaleEnabled) {
      elements["weight-main"].textContent = "Весы выключены";
      elements["weight-state"].textContent = "Не используются";
      elements["weight-note"].textContent = "Включите весы в параметрах, если хотите проверить расчёт объёма и цели.";
    } else if (!state.vesselPresent) {
      elements["weight-main"].textContent = "Вес — · объём —";
      elements["weight-state"].textContent = "Ёмкость снята";
      elements["weight-note"].textContent = "Расчёт и прогноз приостановлены до возврата ёмкости.";
    } else {
      elements["weight-main"].textContent = `${Math.round(state.grams)} г · ${Math.round(volume())} мл`;
      elements["weight-state"].textContent = state.targetReached ? "Цель достигнута" : "Вес стабилен";
      elements["weight-note"].textContent = `Расчётная плотность ${density().toFixed(3)} г/мл · ${state.strength}% об. · ${state.liquidTemp} °C. Весы не управляют клапаном.`;
    }
    elements["weight-state"].className = `stand-pill${state.targetReached ? " warn" : state.scaleEnabled && state.vesselPresent ? " good" : ""}`;
    const rate = state.scaleEnabled && state.vesselPresent && valveOpen() ? state.flow : 0;
    elements["flow-reading"].textContent = state.scaleEnabled && state.vesselPresent ? `${Math.round(rate)} мл/ч` : "—";
    elements["target-reading"].textContent = state.scaleEnabled && state.target > 0 ? `${Math.round(state.target)} мл` : "—";
    const remaining = Math.max(0, state.target - volume());
    elements["eta-reading"].textContent = state.scaleEnabled && state.vesselPresent && state.target > 0 && !state.targetReached && rate > 0 ? `${Math.ceil(remaining / rate * 60)} мин` : "—";
    elements.tare.disabled = !state.scaleEnabled || !state.vesselPresent;
    elements["remove-vessel"].disabled = !state.scaleEnabled;
    elements["remove-vessel"].textContent = state.vesselPresent ? "Снять ёмкость" : "Вернуть ёмкость";
  }

  function sensorStatus(i) {
    if (state.disconnected[i]) return "Обрыв";
    if (state.alarms[i]) return "Тревога";
    if (state.reference[i] === null) return "Ожидание фиксации";
    if (state.alarmStarted[i] !== null) return "Проверка отклонения";
    return "Норма";
  }

  function renderSensors() {
    const cards = elements.sensors.querySelectorAll(".stand-sensor");
    cards.forEach((card, i) => {
      const temp = reading(i);
      const ref = state.reference[i];
      card.querySelector(".stand-sensor-reading").textContent = temp === null ? "— °C" : `${round(temp, 1).toFixed(1)} °C`;
      card.querySelector(".stand-sensor-status").textContent = sensorStatus(i);
      card.querySelector(".stand-sensor-ref").textContent = ref === null ? "Опорная —" : `Опорная ${round(ref, 1).toFixed(1)} °C`;
      card.querySelector(".stand-sensor-delta").textContent = temp === null || ref === null ? "Откл. —" : `Откл. ${round(temp - ref, 1).toFixed(1)} °C`;
      card.classList.toggle("selected", state.selectedSensor === i);
      card.classList.toggle("alarm", state.alarms[i]);
      card.classList.toggle("disconnected", state.disconnected[i]);
      card.setAttribute("aria-pressed", state.selectedSensor === i ? "true" : "false");
    });
  }

  function renderEvents() {
    elements.events.replaceChildren(...state.events.slice(0, 16).map(item => {
      const li = document.createElement("li");
      if (item.alert) li.className = "alert";
      const time = document.createElement("time");
      time.textContent = fmtTime(item.t);
      const span = document.createElement("span");
      span.textContent = item.message;
      li.append(time, span);
      return li;
    }));
  }

  function drawChart() {
    const canvas = elements.chart;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.clearRect(0, 0, w, h);
    const left = 35, right = w - 8, top = 9, bottom = h - 18;
    ctx.font = "10px Segoe UI, sans-serif";
    ctx.textBaseline = "middle";
    for (const t of [20, 40, 60, 80, 100]) {
      const y = bottom - (t / 110) * (bottom - top);
      ctx.strokeStyle = "#ffffff1b";
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = "#8ba0b7";
      ctx.fillText(String(t), 5, y);
    }
    const points = state.history;
    if (points.length < 2) return;
    const start = points[0].t, span = Math.max(1, points[points.length - 1].t - start);
    for (let series = 0; series < 4; series++) {
      ctx.strokeStyle = colors[series]; ctx.lineWidth = 2; ctx.beginPath();
      let started = false;
      for (const point of points) {
        const value = point.temp[series];
        if (value === null) { started = false; continue; }
        const x = left + (point.t - start) / span * (right - left);
        const y = bottom - Math.max(0, Math.min(110, value)) / 110 * (bottom - top);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#8ba0b7";
    ctx.fillText(fmtTime(start), left, h - 7);
    const endLabel = fmtTime(points[points.length - 1].t);
    ctx.fillText(endLabel, Math.max(left, right - 52), h - 7);
    elements["chart-clock"].textContent = fmtTime(state.time);
  }

  function render() {
    renderStage(); renderValve(); renderWeight(); renderSensors(); renderEvents(); drawChart();
  }

  function validNumber(id, min, max) {
    const raw = elements[id].value.trim();
    const value = Number(raw);
    return raw !== "" && Number.isFinite(value) && value >= min && value <= max ? value : null;
  }

  function tick() {
    const now = performance.now();
    const elapsed = Math.min(1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (!state.running) return;
    const virtualSeconds = elapsed * state.speed;
    state.time += virtualSeconds;
    evaluate();
    if (state.scaleEnabled && state.vesselPresent && valveOpen() && state.flow > 0) {
      state.grams += state.flow * virtualSeconds / 3600 * density();
    }
    checkTarget();
    sampleHistory();
    render();
  }

  function buildSensorCards() {
    names.forEach((name, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "stand-sensor";
      button.dataset.sensor = String(i);
      button.innerHTML = `<span class="stand-sensor-head"><strong>${name}</strong><span class="stand-sensor-status"></span></span><span class="stand-sensor-reading"></span><span class="stand-sensor-detail"><span class="stand-sensor-ref"></span><b class="stand-sensor-delta"></b></span>`;
      button.addEventListener("click", () => { state.selectedSensor = i; syncSensorControls(); render(); elements["sensor-choice"].focus(); });
      elements.sensors.append(button);
    });
  }

  elements.scenario.addEventListener("change", () => reset(elements.scenario.value));
  elements.reset.addEventListener("click", () => reset());
  elements.run.addEventListener("click", () => { state.running = !state.running; lastTick = performance.now(); event(state.running ? "Виртуальный цикл запущен" : "Виртуальный цикл приостановлен"); render(); });
  elements.speed.addEventListener("change", () => { state.speed = Number(elements.speed.value); event(`Скорость времени ×${state.speed}`); render(); });
  elements["next-stage"].addEventListener("click", () => { advance(state.stage + 1); evaluate(); sampleHistory(); render(); });
  elements["prev-stage"].addEventListener("click", () => { advance(state.stage - 1); evaluate(); sampleHistory(); render(); });
  document.querySelectorAll("[data-valve]").forEach(button => button.addEventListener("click", () => {
    state.valveMode = button.dataset.valve;
    event(`Режим клапана: ${state.valveMode === "auto" ? "автоматика" : state.valveMode === "open" ? "открыт вручную" : "закрыт вручную"}`);
    evaluate(); render();
  }));
  elements["apply-weight"].addEventListener("click", () => {
    const strength = validNumber("strength", 0, 100);
    const liquidTemp = validNumber("liquid-temp", 0, 80);
    const target = validNumber("target-input", 0, 100000);
    const flow = validNumber("flow-input", 0, 3000);
    if ([strength, liquidTemp, target, flow].some(value => value === null)) { feedback("Проверьте крепость (0–100), температуру (0–80 °C), цель и поток.", true); return; }
    state.strength = strength; state.liquidTemp = liquidTemp; state.target = target; state.flow = flow;
    state.customFlow = true;
    state.scaleEnabled = elements["scale-enabled"].checked;
    state.targetReached = false;
    checkTarget();
    event(`Параметры весов применены; ${state.scaleEnabled ? "включены" : "выключены"}`);
    feedback("Параметры виртуальных весов применены."); render();
  });
  elements.tare.addEventListener("click", () => {
    if (!state.scaleEnabled || !state.vesselPresent) { feedback("Для обнуления включите весы и верните ёмкость.", true); return; }
    state.grams = 0; state.targetReached = false; event("Весы обнулены с текущей ёмкостью"); feedback("Виртуальные весы обнулены."); render();
  });
  elements["remove-vessel"].addEventListener("click", () => {
    if (!state.scaleEnabled) return;
    state.vesselPresent = !state.vesselPresent;
    event(state.vesselPresent ? "Ёмкость возвращена; измерение возобновлено" : "Ёмкость снята; измерение приостановлено");
    render();
  });
  elements["sensor-choice"].addEventListener("change", () => { state.selectedSensor = Number(elements["sensor-choice"].value); syncSensorControls(); render(); });
  elements["set-reading"].addEventListener("click", () => {
    const temp = validNumber("sensor-value", -20, 125);
    const tolerance = validNumber("sensor-tolerance", 0.1, 30);
    if (temp === null || tolerance === null) { feedback("Проверьте показание датчика (−20…125 °C) и допуск (0,1…30 °C).", true); return; }
    const i = state.selectedSensor;
    state.disconnected[i] = false;
    state.override[i] = temp;
    state.tolerance[i] = tolerance;
    event(`Показание ${names[i].toLowerCase()} задано вручную: ${round(temp, 1)} °C`);
    evaluate(); sampleHistory(); syncSensorControls(); render(); feedback("Виртуальное показание задано.");
  });
  elements["clear-reading"].addEventListener("click", () => {
    const i = state.selectedSensor;
    state.override[i] = null;
    event(`Показание ${names[i].toLowerCase()} снова следует сценарию`);
    evaluate(); sampleHistory(); syncSensorControls(); render();
  });
  elements["set-reference"].addEventListener("click", () => {
    const i = state.selectedSensor;
    const temp = reading(i);
    if (temp === null) { feedback("Сначала восстановите датчик.", true); return; }
    const tolerance = validNumber("sensor-tolerance", 0.1, 30);
    if (tolerance === null) { feedback("Допуск должен быть от 0,1 до 30 °C.", true); return; }
    state.reference[i] = temp;
    state.tolerance[i] = tolerance;
    state.alarms[i] = false;
    state.alarmStarted[i] = null;
    state.recoveryStarted[i] = null;
    event(`Опорная ${names[i].toLowerCase()} зафиксирована: ${round(temp, 1)} °C`);
    evaluate(); render(); feedback("Опорная температура зафиксирована.");
  });
  elements["toggle-sensor"].addEventListener("click", () => {
    const i = state.selectedSensor;
    state.disconnected[i] = !state.disconnected[i];
    if (!state.disconnected[i]) { state.alarms[i] = false; state.recoveryStarted[i] = null; }
    event(`${names[i]}: ${state.disconnected[i] ? "виртуальный обрыв" : "связь восстановлена"}`);
    evaluate(); sampleHistory(); syncSensorControls(); render();
  });
  elements["clear-log"].addEventListener("click", () => { state.events = []; event("Журнал очищен"); renderEvents(); });
  window.addEventListener("resize", drawChart);

  buildSensorCards();
  const query = new URLSearchParams(location.search).get("scenario");
  reset(Object.hasOwn(scenarios, query) ? query : "first");
  setInterval(tick, 250);
  window.PardozorStand = {snapshot: () => ({scenario: state.scenario, running: state.running, time: state.time, stage: state.stage, temperatures: names.map((_, i) => reading(i)), alarms: [...state.alarms], valveMode: state.valveMode, valveOpen: valveOpen(), grams: state.grams, volume: volume(), targetReached: state.targetReached, events: state.events.map(item => item.message)})};
})();
