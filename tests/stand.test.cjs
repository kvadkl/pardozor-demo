const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let now = 0;
let tick;
class Element {
  constructor(id = "") {
    Object.assign(this, { id, value: "", textContent: "", hidden: false, disabled: false, dataset: {}, children: [], handlers: {}, className: "" });
    this.classList = { toggle: (name, enabled) => {
      this.className = this.className.split(" ").filter(part => part && part !== name).join(" ") + (enabled ? ` ${name}` : "");
    } };
  }
  addEventListener(name, listener) { this.handlers[name] = listener; }
  trigger(name) { this.handlers[name]?.(); }
  setAttribute() {}
  focus() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(selector) { return selector === ".stand-sensor" ? this.children : []; }
  querySelector(selector) { this.parts ??= {}; return this.parts[selector] ??= new Element(selector); }
  getBoundingClientRect() { return { width: 600, height: 250 }; }
  getContext() { return { setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {} }; }
}
const elements = new Map();
const element = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
element("scenario").value = "first";
element("speed").value = "300";
const valveButtons = ["closed", "open", "auto"].map(mode => {
  const button = new Element();
  button.dataset.valve = mode;
  return button;
});
const browser = {
  URLSearchParams,
  location: { search: "" },
  performance: { now: () => now },
  setInterval: fn => { tick = fn; },
  window: { devicePixelRatio: 1, addEventListener() {} },
  document: {
    getElementById: element,
    createElement: tag => new Element(tag),
    querySelectorAll: selector => selector === "[data-valve]" ? valveButtons : [],
  },
};
vm.runInNewContext(fs.readFileSync("stand.js", "utf8"), browser, { filename: "stand.js" });
const snapshot = () => browser.window.PardozorStand.snapshot();
const advanceTime = count => { for (let i = 0; i < count; i++) { now += 1000; tick(); } };

assert.equal(snapshot().scenario, "first");
element("run").trigger("click");
advanceTime(3);
assert.ok(snapshot().temperatures[1] > snapshot().temperatures[0] + 8, "first run: boiler heats before column vapor");
advanceTime(4);
assert.ok(snapshot().temperatures[1] > snapshot().temperatures[0] + 25, "first run: column remains cool near 65 C in boiler");
advanceTime(4);
assert.equal(snapshot().stage, 1, "65 °C in boiler should advance first run");
element("next-stage").trigger("click");
assert.equal(snapshot().stage, 2, "operator can start raw spirit stage");
advanceTime(14);
assert.equal(snapshot().stage, 3, "98 °C in boiler should finish first run");

element("scenario").value = "liquid";
element("scenario").trigger("change");
element("run").trigger("click");
advanceTime(3);
assert.ok(snapshot().temperatures[1] > 70 && snapshot().temperatures[0] < 30, "liquid run: boiler warms before vapor appears");
advanceTime(1);
assert.ok(snapshot().temperatures[0] > 77 && snapshot().temperatures[0] < 78, "liquid run: vapor reaches measured plateau");

element("scenario").value = "vapor";
element("scenario").trigger("change");
element("run").trigger("click");
advanceTime(3);
assert.ok(snapshot().temperatures[1] > 70 && snapshot().temperatures[0] < 30, "vapor control reuses liquid-run temperature trace");

element("scenario").value = "observe";
element("scenario").trigger("change");
element("run").trigger("click");
advanceTime(7);
assert.ok(snapshot().temperatures[1] > snapshot().temperatures[0] + 25, "observation reuses first-run temperature trace");

element("scenario").value = "liquid";
element("scenario").trigger("change");
element("next-stage").trigger("click");
element("next-stage").trigger("click");
assert.equal(snapshot().stage, 2);
assert.equal(snapshot().valveOpen, true, "heads stage opens valve in automatic mode");
element("next-stage").trigger("click");
assert.equal(snapshot().stage, 3);
assert.equal(snapshot().valveOpen, true, "body stage starts with column temperature in range");
element("run").trigger("click");
advanceTime(1);
assert.ok(snapshot().grams > 0, "open valve and vessel should accumulate mass");

element("sensor-value").value = "90";
element("sensor-tolerance").value = "0.2";
element("set-reading").trigger("click");
advanceTime(1);
assert.equal(snapshot().alarms[0], true);
assert.equal(snapshot().valveOpen, false, "automatic mode closes valve on column alarm");
valveButtons[1].trigger("click");
assert.equal(snapshot().valveOpen, true, "manual open stays open despite alarm");
element("tare").trigger("click");
assert.equal(snapshot().grams, 0);
element("remove-vessel").trigger("click");
advanceTime(1);
assert.equal(snapshot().grams, 0, "removing vessel pauses weight calculation");

console.log("Browser stand: transitions, valve modes, alarm, scales and vessel — OK");
