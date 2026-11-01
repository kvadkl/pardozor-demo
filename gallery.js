"use strict";

const galleryButtons = [...document.querySelectorAll(".capture-open")];
const dialog = document.getElementById("capture-dialog");
const largeImage = document.getElementById("capture-large");
const viewport = document.getElementById("capture-viewport");
const zoomButton = document.getElementById("capture-zoom");
const originalLink = document.getElementById("capture-original");
let currentIndex = 0;
let opener = null;
let touchStart = null;

function setZoom(enabled) {
  viewport.classList.toggle("is-zoomed", enabled);
  zoomButton.textContent = enabled ? "Вписать в экран" : "Масштаб 1:1";
  zoomButton.setAttribute("aria-label", enabled ? "Вписать изображение в экран" : "Показать изображение в исходном размере");
  viewport.scrollTo(0, 0);
}

function showImage(index) {
  currentIndex = (index + galleryButtons.length) % galleryButtons.length;
  const button = galleryButtons[currentIndex];
  const thumbnail = button.querySelector("img");
  const caption = button.closest("figure").querySelector("figcaption").textContent.trim();
  largeImage.src = thumbnail.src;
  largeImage.alt = thumbnail.alt;
  originalLink.href = thumbnail.src;
  document.getElementById("capture-counter").textContent = `Кадр ${currentIndex + 1} из ${galleryButtons.length}`;
  document.getElementById("capture-caption").textContent = caption;
  setZoom(false);
}

galleryButtons.forEach((button, index) => {
  button.addEventListener("click", () => {
    opener = button;
    showImage(index);
    dialog.showModal();
    document.body.classList.add("lightbox-open");
  });
});

document.getElementById("capture-close").addEventListener("click", () => dialog.close());
document.getElementById("capture-prev").addEventListener("click", () => showImage(currentIndex - 1));
document.getElementById("capture-next").addEventListener("click", () => showImage(currentIndex + 1));
zoomButton.addEventListener("click", () => setZoom(!viewport.classList.contains("is-zoomed")));
largeImage.addEventListener("click", () => setZoom(!viewport.classList.contains("is-zoomed")));
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener("close", () => {
  document.body.classList.remove("lightbox-open");
  opener?.focus();
});
dialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") { event.preventDefault(); showImage(currentIndex - 1); }
  if (event.key === "ArrowRight") { event.preventDefault(); showImage(currentIndex + 1); }
});
viewport.addEventListener("touchstart", (event) => {
  if (viewport.classList.contains("is-zoomed")) return;
  const touch = event.changedTouches[0];
  touchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });
viewport.addEventListener("touchend", (event) => {
  if (!touchStart || viewport.classList.contains("is-zoomed")) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) showImage(currentIndex + (dx < 0 ? 1 : -1));
}, { passive: true });
