"use strict";

(() => {
  const stagger = 72;
  const printInk = [
    {opacity: 0, clipPath: "inset(0 100% 0 0)", transform: "translate(-.12em,.08em)"},
    {opacity: .78, clipPath: "inset(0 54% 0 0)", transform: "translate(.08em,-.045em)", offset: .2},
    {opacity: 1, clipPath: "inset(0 26% 0 0)", transform: "translate(-.045em,.02em)", offset: .43},
    {opacity: 1, clipPath: "inset(0 0 0 0)", transform: "translate(.025em,0)", offset: .71},
    {opacity: 1, clipPath: "inset(0)", transform: "none"}
  ];

  function makeWord(value) {
    const word = document.createElement("span");
    word.className = "verse-word";
    for (const layer of ["ink", "cyan", "magenta"]) {
      const part = document.createElement("span");
      part.className = "verse-" + layer;
      part.textContent = value;
      if (layer !== "ink") part.setAttribute("aria-hidden", "true");
      word.append(part);
    }
    return word;
  }

  function plateFrames(sign, band) {
    return [
      {opacity: 0, transform: "translateX(" + sign * .29 + "em)", clipPath: "inset(" + band + ")"},
      {opacity: .87, transform: "translateX(" + sign * .24 + "em)", offset: .15, clipPath: "inset(" + band + ")"},
      {opacity: .75, transform: "translateX(" + sign * -.11 + "em)", offset: .38, clipPath: "inset(" + band + ")"},
      {opacity: .46, transform: "translateX(" + sign * .06 + "em)", offset: .68, clipPath: "inset(" + band + ")"},
      {opacity: 0, transform: "none", clipPath: "inset(" + band + ")"}
    ];
  }

  function preparePrint(line) {
    const words = [];
    const parts = line.textContent.trim().split(/(\s+)/).map((token) => {
      if (/^\s+$/.test(token)) return document.createTextNode(token);
      const word = makeWord(token);
      words.push(word);
      return word;
    });
    line.replaceChildren(...parts);
    const cyan = plateFrames(1, "5% 0 42% 0");
    const magenta = plateFrames(-1, "47% 0 1% 0");
    let animations = [];

    function replay(delay) {
      for (const animation of animations) animation.cancel();
      animations = [];
      for (const [index, word] of words.entries()) {
        const timing = {duration: 440, delay: delay + index * stagger, fill: "backwards"};
        animations.push(word.children[0].animate(printInk, timing),
          word.children[1].animate(cyan, timing), word.children[2].animate(magenta, timing));
      }
    }

    const entrance = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      entrance.disconnect();
      replay(line.closest(".overview") ? 170 : 40);
    }, {threshold: .2});
    entrance.observe(line);
    line.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      entrance.disconnect();
      replay(0);
    });
  }

  for (const line of document.querySelectorAll("[data-verse]")) preparePrint(line);

  const canvas = document.querySelector(".comet-field");
  const context = canvas?.getContext("2d");
  if (!context) return;

  const hero = document.querySelector(".overview");
  const period = 13.6;
  let width, height, routes, elapsed = 0, previous = 0, paintedAt = -Infinity, request;

  function point(route, time) {
    const [a, b, c, d] = route;
    const u = 1 - time;
    return [
      u ** 3 * a[0] + 3 * u ** 2 * time * b[0] + 3 * u * time ** 2 * c[0] + time ** 3 * d[0],
      u ** 3 * a[1] + 3 * u ** 2 * time * b[1] + 3 * u * time ** 2 * c[1] + time ** 3 * d[1]
    ];
  }

  function glint(x, y, size, alpha) {
    context.fillStyle = "rgba(193,251,255," + alpha + ")";
    context.beginPath();
    context.moveTo(x, y - size);
    context.lineTo(x + .65, y - .65);
    context.lineTo(x + size, y);
    context.lineTo(x + .65, y + .65);
    context.lineTo(x, y + size);
    context.lineTo(x - .65, y + .65);
    context.lineTo(x - size, y);
    context.lineTo(x - .65, y - .65);
    context.closePath();
    context.fill();
  }

  function drawComet({path, start, duration, weight}, phase) {
    const progress = (phase - start) / duration;
    if (progress <= 0 || progress >= 1) return;
    const tail = Math.max(0, progress - .19);
    const [x, y] = point(path, progress);
    const [tx, ty] = point(path, tail);
    const wake = context.createLinearGradient(tx, ty, x, y);
    wake.addColorStop(0, "rgba(42,108,247,0)");
    wake.addColorStop(.43, "rgba(56,151,255,.36)");
    wake.addColorStop(.82, "rgba(70,222,255,.88)");
    wake.addColorStop(1, "#dcfbff");

    context.beginPath();
    context.moveTo(tx, ty);
    for (let segment = 1; segment <= 15; segment += 1) {
      context.lineTo(...point(path, tail + (progress - tail) * segment / 15));
    }
    context.lineCap = "round";
    context.strokeStyle = wake;
    context.lineWidth = 6.5 * weight;
    context.globalAlpha = .20;
    context.stroke();
    context.lineWidth = 1.65 * weight;
    context.globalAlpha = 1;
    context.stroke();

    const glow = context.createRadialGradient(x, y, 0, x, y, 17 * weight);
    glow.addColorStop(0, "rgba(185,249,255,.78)");
    glow.addColorStop(.27, "rgba(68,215,255,.36)");
    glow.addColorStop(1, "rgba(40,136,255,0)");
    context.fillStyle = glow;
    context.fillRect(x - 18 * weight, y - 18 * weight, 36 * weight, 36 * weight);
    glint(x, y, 5.7 * weight, 1);

    for (let index = 1; index <= 12; index += 1) {
      const behind = progress - index * .014;
      if (behind < 0) break;
      const [px, py] = point(path, behind);
      const drift = (4 + index * 1.6) * weight;
      const spread = (1 - index / 13) * (.38 + .4 * Math.sin(phase * 5 + index) ** 2);
      glint(px + Math.sin(index * 7.2) * drift, py + Math.cos(index * 2.7) * drift,
        (index % 4 === 0 ? 3.4 : 1.75) * weight, spread);
    }
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    const phase = elapsed % period;
    for (let index = 1; index <= 24; index += 1) {
      const x = (index * .618 % 1) * width;
      const y = (index * .427 % 1) * height;
      const pulse = (1 + Math.sin(elapsed * 1.9 + index * 2.2)) / 2;
      glint(x, y, index % 6 === 0 ? 3 : 1.3, .1 + .45 * pulse ** 3);
    }
    for (const route of routes) drawComet(route, phase);
  }

  function resize() {
    width = document.documentElement.clientWidth;
    height = window.innerHeight;
    const density = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    context.setTransform(density, 0, 0, density, 0, 0);

    const bounds = hero.getBoundingClientRect();
    const gap = Math.min(height * .72, bounds.bottom + window.scrollY + 50);
    const gutter = Math.max(14, Math.min(85, bounds.left * .65));
    routes = [
      {start: .25, duration: 4.6, weight: 1.12,
        path: [[-130, gap + 32], [width * .24, gap + 4], [width * .72, gap - 30], [width + 150, gap + 16]]},
      {start: 3.15, duration: 5.1, weight: .9,
        path: [[width + 68, -55], [width - gutter * 2.9, height * .12],
          [width - gutter * 2.6, height * .67], [width + 93, height * .91]]},
      {start: 8, duration: 4.9, weight: .82,
        path: [[-65, height * .92], [gutter * 2.95, height * .74], [gutter * 2.6, height * .31], [-75, -55]]}
    ];
    draw();
  }

  function animate(now) {
    if (previous) elapsed += Math.min(now - previous, 120) / 1000;
    previous = now;
    if (now - paintedAt >= 1000 / 30 - .5) {
      draw();
      paintedAt = now;
    }
    request = requestAnimationFrame(animate);
  }

  function syncVisibility() {
    cancelAnimationFrame(request);
    previous = 0;
    if (!document.hidden) request = requestAnimationFrame(animate);
  }

  resize();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
})();
