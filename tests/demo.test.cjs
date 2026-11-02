const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const fixtures = {
  "data/first-run.json": JSON.parse(fs.readFileSync("data/first-run.json", "utf8")),
  "data/session.json": JSON.parse(fs.readFileSync("data/session.json", "utf8")),
};
const elements = new Map();
const context2d = { scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, style: {}, textContent: "", innerHTML: "", value: "", className: "", hidden: false,
    addEventListener() {}, setAttribute() {},
    getBoundingClientRect() { return { width: 700, height: 280 }; },
    getContext() { return context2d; },
  });
  return elements.get(id);
}
const context = vm.createContext({
  console,
  URLSearchParams,
  document: {
    getElementById: element,
    querySelectorAll() { return []; },
  },
  window: { devicePixelRatio: 1, location: { search: "" }, history: { replaceState() {} }, addEventListener() {} },
  performance: { now() { return 0; } },
  requestAnimationFrame() {},
  fetch: async path => ({ ok: true, json: async () => fixtures[path] }),
});

vm.runInContext(fs.readFileSync("demo.js", "utf8"), context, { filename: "demo.js" });

async function test() {
  await new Promise(resolve => setImmediate(resolve));
  const first = fixtures["data/first-run.json"];
  assert.equal(element("stage").textContent, "Нагрев");
  assert.equal(element("weight-card").hidden, true, "first run must not show weights");
  assert.equal(element("transition-card").hidden, false);
  assert.equal(first.samples.length, 296);
  assert.equal(first.events.length, 3);
  assert.ok(first.samples.every(sample => !Object.hasOwn(sample, "volume") && !Object.hasOwn(sample, "mass")));
  assert.deepEqual(first.events.map(event => event.stage), [1, 2, 3]);
  for (const [stage, title] of [[2, "Подготовить охлаждение"], [3, "Отбор сырца"], [4, "Завершение"]]) {
    const start = first.samples.find(sample => sample.stage === stage).t;
    vm.runInContext(`setTime(${start + 40})`, context);
    assert.equal(element("stage").textContent, title);
  }
  assert.match(element("event-title").textContent, /98 °C/);

  await vm.runInContext('loadScenario("liquid")', context);
  const liquid = fixtures["data/session.json"];
  assert.equal(element("weight-card").hidden, false);
  assert.equal(element("transition-card").hidden, true);
  assert.equal(element("stage").textContent, "Нагрев");
  const stageStart = stage => liquid.samples.find(sample => sample.stage === stage).t;
  vm.runInContext(`setTime(${stageStart(3) + 300})`, context);
  assert.equal(element("stage").textContent, "Головы");
  vm.runInContext(`setTime(${stageStart(4) + 300})`, context);
  assert.equal(element("stage").textContent, "Тело");
  const target = liquid.events.find(event => event.code === "SCALE_TARGET_REACHED" && event.t > stageStart(4));
  vm.runInContext(`setTime(${target.t})`, context);
  assert.match(element("event-title").textContent, /объём достигнут/);
  const alarm = liquid.events.find(event => event.code === "ALARM_ACTIVATED" && event.t > stageStart(4));
  vm.runInContext(`setTime(${alarm.t})`, context);
  assert.match(element("event-title").textContent, /тревога/);
  console.log("Demo replay: first run, liquid run, stages, target and alarm — OK");
}
test().catch(error => { console.error(error); process.exitCode = 1; });
