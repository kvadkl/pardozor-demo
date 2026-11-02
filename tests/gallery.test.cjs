const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function mockElement() {
  const listeners = {};
  const classes = new Set();
  return {
    listeners, textContent: "", src: "", alt: "", href: "", focused: false,
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
    addEventListener: (event, handler) => { listeners[event] = handler; },
    setAttribute() {}, scrollTo() {},
    focus() { this.focused = true; },
    fire(event, detail = {}) { listeners[event]?.(detail); },
  };
}

const ids = Object.fromEntries(["capture-dialog", "capture-large", "capture-viewport", "capture-zoom", "capture-original", "capture-counter", "capture-caption", "capture-close", "capture-prev", "capture-next"].map(id => [id, mockElement()]));
const thumbs = ["self-reflux", "body", "alarm", "finish"].map(name => {
  const button = mockElement();
  button.querySelector = () => ({ src: `assets/interface-${name}.png`, alt: name });
  button.closest = () => ({ querySelector: () => ({ textContent: name }) });
  return button;
});
const photos = ["controller-mounted", "display-closeup"].map(name => {
  const button = mockElement();
  button.dataset = { gallery: "photos", fullSrc: `assets/photos/${name}.jpg` };
  button.querySelector = () => ({ src: `assets/photos/thumbs/${name}.jpg`, alt: name });
  button.closest = () => ({ querySelector: () => ({ textContent: name }) });
  return button;
});
ids["capture-dialog"].showModal = function () { this.open = true; };
ids["capture-dialog"].close = function () { this.open = false; this.fire("close"); };
const context = vm.createContext({
  document: {
    body: { classList: mockElement().classList },
    querySelectorAll: () => [...thumbs, ...photos],
    getElementById: id => ids[id],
  },
});

vm.runInContext(fs.readFileSync("gallery.js", "utf8"), context, { filename: "gallery.js" });
thumbs[0].fire("click");
assert.equal(ids["capture-dialog"].open, true);
assert.equal(ids["capture-large"].src, "assets/interface-self-reflux.png");
assert.equal(ids["capture-counter"].textContent, "Кадр 1 из 4");
ids["capture-next"].fire("click");
assert.equal(ids["capture-large"].src, "assets/interface-body.png");
ids["capture-zoom"].fire("click");
assert.equal(ids["capture-viewport"].classList.contains("is-zoomed"), true);
ids["capture-dialog"].fire("keydown", { key: "ArrowLeft", preventDefault() {} });
assert.equal(ids["capture-large"].src, "assets/interface-self-reflux.png");
assert.equal(ids["capture-viewport"].classList.contains("is-zoomed"), false);
ids["capture-close"].fire("click");
assert.equal(ids["capture-dialog"].open, false);
assert.equal(thumbs[0].focused, true);
photos[0].fire("click");
assert.equal(ids["capture-large"].src, "assets/photos/controller-mounted.jpg");
assert.equal(ids["capture-original"].href, "assets/photos/controller-mounted.jpg");
assert.equal(ids["capture-counter"].textContent, "Кадр 1 из 2");
ids["capture-next"].fire("click");
assert.equal(ids["capture-large"].src, "assets/photos/display-closeup.jpg");
ids["capture-dialog"].close();
console.log("Gallery: open, navigate, zoom and close — OK");
