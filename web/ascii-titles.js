"use strict";

(() => {
  const glyphs = "@#%*+=01";
  const palette = ["#72b0f6", "#91c9ff", "#b4ddff", "#d6eeff", "#f1faff"];
  const titles = [];
  let elapsed = 0, previous = 0, painted = -Infinity, request;

  function buildMask(title) {
    const size = 112;
    const source = document.createElement("canvas");
    let ink = source.getContext("2d", {willReadFrequently: true});
    const font = "850 " + size + "px Segoe UI, sans-serif";
    ink.font = font;
    const metrics = ink.measureText(title.label);
    const ascent = metrics.actualBoundingBoxAscent;
    source.width = Math.ceil(metrics.width + 20);
    source.height = Math.ceil(ascent + metrics.actualBoundingBoxDescent + 18);
    ink = source.getContext("2d", {willReadFrequently: true});
    ink.font = font;
    ink.fillStyle = "#fff";
    ink.fillText(title.label, 8, 8 + ascent);
    const mask = ink.getImageData(0, 0, source.width, source.height).data;
    title.points = [];
    for (let y = 3; y < source.height; y += 5) {
      for (let x = 3; x < source.width; x += 5) {
        const alpha = mask[(y * source.width + x) * 4 + 3];
        if (alpha > 95) title.points.push({x, y, seed: title.points.length});
      }
    }
    title.sourceWidth = source.width;
    title.sourceHeight = source.height;
    title.scale = Math.min((title.width - 4) / source.width, (title.height - 10) / source.height);
  }

  function measure(title) {
    const box = title.element.getBoundingClientRect();
    const visible = box.width > 0 && box.height > 0;
    if (!visible) {
      title.visible = false;
      return;
    }
    const resized = Math.abs(title.width - box.width) > .5 || Math.abs(title.height - box.height) > .5;
    if (!title.visible) title.enteredAt = elapsed;
    title.visible = true;
    if (!resized && title.points.length) return;
    title.width = box.width;
    title.height = box.height;
    buildMask(title);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    title.canvas.width = Math.ceil(title.width * dpr);
    title.canvas.height = Math.ceil(title.height * dpr);
    title.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    title.element.classList.add("is-ascii-ready");
  }

  function draw(title) {
    const ctx = title.context;
    ctx.clearRect(0, 0, title.width, title.height);
    const scale = title.scale;
    const top = (title.height - title.sourceHeight * scale) / 2 - 2;
    const tick = Math.floor(elapsed * 5);
    const entrance = Math.min(1, Math.max(0, (elapsed - title.enteredAt) / .65));
    const hover = title.hoverUntil > elapsed;
    const fontSize = Math.max(3.8, scale * 6.3);
    ctx.font = "600 " + fontSize + "px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const point of title.points) {
      const sweep = Math.pow(.5 + .5 * Math.cos(point.x / title.sourceWidth * 5.5 - elapsed * 1.1), 12);
      const pointerLight = hover ? Math.max(0, 1 - Math.abs(4 + point.x * scale - title.pointerX) / 100) : 0;
      const tone = Math.min(4, 1 + Math.round(sweep * 2 + pointerLight));
      const reveal = Math.min(1, Math.max(0, entrance * 2.2 - point.x / title.sourceWidth * .65));
      ctx.globalAlpha = reveal;
      ctx.fillStyle = palette[tone];
      ctx.fillText(glyphs[(point.seed * 5 + tick * (point.seed % 2 + 1)) % glyphs.length],
        2 + point.x * scale, top + point.y * scale);
    }
    ctx.globalAlpha = 1;
  }

  for (const element of document.querySelectorAll("[data-ascii-title]")) {
    const canvas = element.querySelector(".ascii-title-canvas");
    const context = canvas?.getContext("2d");
    if (!context) continue;
    const title = {element, canvas, context, label: element.dataset.asciiTitle,
      width: 0, height: 0,
      points: [], scale: 1, visible: false, enteredAt: 0, hoverUntil: -1, pointerX: 0};
    titles.push(title);
    element.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse") return;
      title.pointerX = event.clientX - element.getBoundingClientRect().left;
      title.hoverUntil = elapsed + .6;
    }, {passive: true});
    new ResizeObserver(() => { measure(title); if (title.visible) draw(title); }).observe(element);
  }

  function animate(now) {
    if (previous) elapsed += Math.min(now - previous, 100) / 1000;
    previous = now;
    if (now - painted >= 1000 / 24 - .5) {
      for (const title of titles) if (title.visible) draw(title);
      painted = now;
    }
    request = requestAnimationFrame(animate);
  }

  function sync() {
    cancelAnimationFrame(request);
    previous = 0;
    titles.forEach(measure);
    if (!document.hidden && titles.some(title => title.visible)) request = requestAnimationFrame(animate);
  }
  document.addEventListener("cqa:view-change", sync);
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("resize", sync);
  sync();
})();
