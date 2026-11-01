const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const data = JSON.parse(fs.readFileSync("data/session.json", "utf8"));
const elements = new Map();
const context2d = {
  scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
};
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, style: {}, textContent: "", innerHTML: "", value: "", className: "",
    addEventListener() {}, setAttribute() {},
    getBoundingClientRect() { return { width: 700, height: 280 }; },
    getContext() { return context2d; },
  });
  return elements.get(id);
}
const context = vm.createContext({
  console,
  document: {
    getElementById: element,
    querySelector() { return element("event-actions"); },
    querySelectorAll() { return []; },
  },
  window: { devicePixelRatio: 1, addEventListener() {} },
  performance: { now() { return 0; } },
  requestAnimationFrame() {},
  fetch: async () => ({ ok: true, json: async () => data }),
});

vm.runInContext(fs.readFileSync("demo.js", "utf8"), context, { filename: "demo.js" });
setImmediate(() => {
  assert.equal(element("stage").textContent, "Нагрев");
  const stageStart = (number) => data.samples.find((x) => x.stage === number).t;
  vm.runInContext(`setTime(${stageStart(3) + 300})`, context);
  assert.equal(element("stage").textContent, "Головы");
  vm.runInContext(`setTime(${stageStart(4) + 300})`, context);
  assert.equal(element("stage").textContent, "Тело");
  const target = data.events.find((x) => x.code === "SCALE_TARGET_REACHED" && x.t > stageStart(4));
  vm.runInContext(`setTime(${target.t})`, context);
  assert.match(element("event-title").textContent, /объём достигнут/);
  const alarm = data.events.find((x) => x.code === "ALARM_ACTIVATED" && x.t > stageStart(4));
  vm.runInContext(`setTime(${alarm.t})`, context);
  assert.match(element("event-title").textContent, /тревога/);
  vm.runInContext(`setTime(${stageStart(5) + 100})`, context);
  assert.equal(element("stage").textContent, "Завершение");
  console.log("Demo replay: stages, target and alarm — OK");
});
