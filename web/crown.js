"use strict";

(() => {
  const canvas = document.querySelector(".crown-field");
  const stage = document.querySelector("#crown-stage");
  const ctx = canvas?.getContext("2d", {alpha: true});
  if (!ctx || !stage) return;

  const tau = Math.PI * 2;
  const samples = 144;
  const sphere = Array.from({length: 920}, (_, index) => {
    const y = 1 - 2 * (index + .5) / 920;
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const r = Math.sqrt(1 - y * y) * .79;
    return [Math.cos(angle) * r, y * .79, Math.sin(angle) * r, index % 3];
  });
  const nodes = [
    [0, 0, .03],
    [-.30, .23, .17], [.35, .18, -.18],
    [-.76, -.36, .20], [-.36, -.63, -.38],
    [.39, -.56, .36], [.76, -.21, -.23]
  ];
  const parents = [0, 0, 0, 1, 1, 2, 2];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let width = 0, height = 0, dpr = 1, bounds;
  let elapsed = 0, previous = 0, paintedAt = -Infinity, request;
  let yaw = 0, pitch = 0, aimX = 0, aimY = 0, tiltX = 0, tiltY = 0;
  let drag = null, wasDragged = false, lastPulse = -2.2, selectedLeaf = 3;
  let nextPulse = 4.6;

  // Rotate in model space before projecting; all views share the same geometry.
  function rotate(point, x, y, z = 0) {
    const [px, py, pz] = point;
    const cy = Math.cos(y), sy = Math.sin(y);
    const cx = Math.cos(x), sx = Math.sin(x);
    const cz = Math.cos(z), sz = Math.sin(z);
    const a = px * cy + pz * sy;
    const b = pz * cy - px * sy;
    const c = py * cx - b * sx;
    return [a * cz - c * sz, a * sz + c * cz, py * sx + b * cx];
  }

  function project(point, view) {
    const perspective = 3.7 / (3.7 - point[2] * .55);
    return [view.x + point[0] * view.radius * perspective,
      view.y + point[1] * view.radius * perspective, point[2]];
  }

  function ribbon(index, turnX, turnY) {
    const radius = [1, .71, .43][index];
    const tilt = [.68, -1.05, 1.32][index];
    const phase = elapsed * .13 + index * 1.9;
    const points = [];
    for (let i = 0; i <= samples; i++) {
      const u = i / samples * tau;
      // Narrow arcs open into four tapered, translucent crown fins.
      const lobe = Math.pow(.5 + .5 * Math.cos(4 * u + phase), 9);
      const spread = (.012 + .29 * lobe) * radius;
      const ring = radius * (.96 - .035 * Math.cos(4 * u + phase));
      const row = [];
      for (let strand = 0; strand < 7; strand++) {
        const v = strand / 3 - 1;
        const r = ring + spread * v * .15;
        const local = [Math.cos(u) * r, Math.sin(u) * r,
          v * spread + Math.sin(3 * u + phase) * .045 * radius];
        const inclined = rotate(local, tilt, index * .54, index * .7 + elapsed * .035);
        row.push(rotate(inclined, turnX, turnY));
      }
      points.push(row);
    }
    return points;
  }

  function segment(a, b) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  function star(x, y, size, alpha) {
    ctx.strokeStyle = "rgba(210,244,255," + alpha + ")";
    ctx.lineWidth = .7;
    segment([x - size, y], [x + size, y]);
    segment([x, y - size], [x, y + size]);
    ctx.fillStyle = "rgba(241,252,255," + alpha + ")";
    ctx.fillRect(x - .9, y - .9, 1.8, 1.8);
  }

  function drawRibbon(points, view, front, index) {
    const projected = points.map(row => row.map(point => project(point, view)));
    const alpha = view.alpha;
    for (let i = 0; i < samples; i++) {
      const a = projected[i], b = projected[i + 1];
      const depth = (a[3][2] + b[3][2]) / 2;
      if ((depth > 0) !== front) continue;
      const light = clamp((depth + 1.1) / 2.1, .1, 1);
      const glimmer = Math.pow(.5 + .5 * Math.cos(i / samples * tau - elapsed * .63 - index), 12);
      ctx.beginPath();
      ctx.moveTo(a[0][0], a[0][1]);
      ctx.lineTo(b[0][0], b[0][1]);
      ctx.lineTo(b[6][0], b[6][1]);
      ctx.lineTo(a[6][0], a[6][1]);
      ctx.closePath();
      ctx.fillStyle = "rgba(160,190,255," + alpha * (.05 + light * .24 + glimmer * .15) + ")";
      ctx.fill();
      if (front && glimmer > .65) {
        ctx.strokeStyle = "rgba(111,170,255," + alpha * glimmer * .18 + ")";
        ctx.lineWidth = 4.5;
        segment(a[0], b[0]);
        segment(a[6], b[6]);
      }
      for (const strand of [0, 1, 3, 5, 6]) {
        const edge = strand === 0 || strand === 6;
        ctx.lineWidth = edge ? .85 + glimmer * .85 : .4;
        ctx.strokeStyle = (edge ? "rgba(218,232,255," : "rgba(126,182,255,") +
          alpha * (edge ? .42 + light * .50 + glimmer * .08 : .14 + light * .16) + ")";
        segment(a[strand], b[strand]);
      }
      if (i % 3 === 0) {
        ctx.lineWidth = .4;
        ctx.strokeStyle = "rgba(150,194,255," + alpha * (.08 + light * .11) + ")";
        segment(a[0], a[6]);
      }
      if (view.focus && glimmer > .985 && i % 2 === 0 && front) {
        star(a[6][0], a[6][1], 2 + glimmer * 3, alpha * .85);
      }
    }
  }

  function glow(x, y, radius, opacity) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, "rgba(155,220,255," + opacity + ")");
    light.addColorStop(.17, "rgba(81,160,255," + opacity * .42 + ")");
    light.addColorStop(1, "rgba(55,123,255,0)");
    ctx.fillStyle = light;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawTree(points, view) {
    const p = points.map(point => project(point, view));
    const age = elapsed - lastPulse;
    const active = age >= 0 && age < 2.5;
    const path = [selectedLeaf, parents[selectedLeaf], 0];
    ctx.lineWidth = .65;
    ctx.strokeStyle = "rgba(169,205,239," + view.alpha * .3 + ")";
    for (let i = 1; i < p.length; i++) segment(p[i], p[parents[i]]);
    if (active) {
      const travel = clamp(age / 1.65, 0, 1) * 2;
      for (let step = 0; step < 2; step++) {
        const a = p[path[step]], b = p[path[step + 1]];
        const t = clamp(travel - step, 0, 1);
        if (!t) continue;
        const end = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        ctx.strokeStyle = "rgba(213,245,255," + view.alpha * .95 + ")";
        ctx.lineWidth = 1;
        segment(a, end);
        glow(end[0], end[1], view.focus ? 15 : 24, view.alpha * .5);
        star(end[0], end[1], view.focus ? 3.5 : 5, view.alpha);
      }
      if (age > 1.65) {
        const fade = 1 - (age - 1.65) / .85;
        glow(p[0][0], p[0][1], 34, view.alpha * fade * .6);
        ctx.strokeStyle = "rgba(143,220,255," + view.alpha * fade * .6 + ")";
        ctx.lineWidth = .7;
        ctx.beginPath();
        ctx.arc(p[0][0], p[0][1], 5 + (1 - fade) * 24, 0, tau);
        ctx.stroke();
      }
    }
    for (let i = 0; i < p.length; i++) {
      const highlighted = active && path.includes(i);
      const size = view.focus ? (i ? 3.4 : 4.5) : 4;
      ctx.fillStyle = "rgba(9,24,47," + view.alpha * .95 + ")";
      ctx.fillRect(p[i][0] - size / 2, p[i][1] - size / 2, size, size);
      ctx.strokeStyle = "rgba(203,235,255," + view.alpha * (highlighted ? 1 : .55) + ")";
      ctx.lineWidth = .8;
      ctx.strokeRect(p[i][0] - size / 2, p[i][1] - size / 2, size, size);
    }
    if (view.focus) {
      ctx.font = "8px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "rgba(206,229,255,.85)";
      ctx.fillText(active && age > 1.65 ? "[ NEW ROOT ]" : "[ ROOT ]", p[0][0] + 9, p[0][1] + 3);
      if (active) {
        ctx.fillStyle = "rgba(163,210,250,.8)";
        ctx.fillText("ORDER " + (selectedLeaf - 2), p[selectedLeaf][0] + 8, p[selectedLeaf][1] - 7);
      }
    }
  }

  function drawView(view, ribbons, dots, tree) {
    glow(view.x, view.y, view.radius * 1.35, view.alpha * .11);
    for (let i = 0; i < ribbons.length; i++) drawRibbon(ribbons[i], view, false, i);
    ctx.font = Math.max(5, Math.min(7, view.radius / 22)) + "px ui-monospace, Consolas, monospace";
    for (let i = 0; i < dots.length; i++) {
      const point = project(dots[i], view);
      const opacity = view.alpha * (.11 + (point[2] + .8) * .18);
      ctx.fillStyle = "rgba(161,204,255," + opacity + ")";
      if (view.focus && i % 4 === 0) ctx.fillText(sphere[i][3] ? "1" : "0", point[0], point[1]);
      else ctx.fillRect(point[0], point[1], .9, .9);
    }
    for (let i = ribbons.length - 1; i >= 0; i--) drawRibbon(ribbons[i], view, true, i);
    drawTree(tree, view);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const turnX = -.28 + pitch + tiltY;
    const turnY = elapsed * .095 + yaw + tiltX;
    const ribbons = [0, 1, 2].map(index => ribbon(index, turnX, turnY));
    const dots = sphere.map(point => rotate(point, turnX, turnY * .73));
    const tree = nodes.map(point => rotate(point, turnX, turnY));
    // A quiet, oversized echo continues behind the grid and workspace margins.
    drawView({x: width * .62, y: height * .62, radius: Math.max(width * .44, height * .52),
      alpha: .15, focus: false}, ribbons, dots, tree);
    if (bounds.bottom > 0 && bounds.top < height) {
      drawView({x: bounds.left + bounds.width * .5, y: bounds.top + bounds.height * .50,
        radius: Math.min(bounds.width * .38, bounds.height * .40), alpha: .96, focus: true},
      ribbons, dots, tree);
    }
  }

  function measure() {
    bounds = stage.getBoundingClientRect();
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measure();
    draw();
  }

  function pulse(x, y) {
    const view = {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
      radius: Math.min(bounds.width * .38, bounds.height * .40)};
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const projected = nodes.map(point => project(rotate(point, -.28 + pitch + tiltY,
        elapsed * .095 + yaw + tiltX), view));
      selectedLeaf = [3, 4, 5, 6].sort((a, b) =>
        Math.hypot(projected[a][0] - x, projected[a][1] - y) -
        Math.hypot(projected[b][0] - x, projected[b][1] - y))[0];
    } else {
      selectedLeaf = 3 + (selectedLeaf - 2) % 4;
    }
    lastPulse = elapsed;
    nextPulse = elapsed + 7.5;
  }

  window.addEventListener("pointermove", event => {
    aimX = (event.clientX / width - .5) * .32;
    aimY = (event.clientY / height - .5) * .22;
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) wasDragged = true;
    yaw += dx * .007;
    pitch = clamp(pitch + dy * .004, -.85, .85);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }, {passive: true});
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY};
    wasDragged = false;
    stage.setPointerCapture(event.pointerId);
  });
  function release(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("lostpointercapture", () => { drag = null; });
  stage.addEventListener("click", event => {
    if (!wasDragged || event.detail === 0) pulse(event.detail ? event.clientX : undefined,
      event.detail ? event.clientY : undefined);
  });
  window.addEventListener("click", event => {
    if (event.target.closest("button, a, input, textarea, select, label, summary, .workspace, .editor")) return;
    pulse(event.clientX, event.clientY);
  });
  window.addEventListener("blur", () => { drag = null; aimX = 0; aimY = 0; });
  window.addEventListener("resize", resize);
  window.addEventListener("scroll", measure, {passive: true});
  new ResizeObserver(measure).observe(stage);

  function animate(now) {
    const delta = previous ? Math.min(now - previous, 100) / 1000 : 0;
    elapsed += delta;
    previous = now;
    const ease = 1 - Math.exp(-delta * 5);
    tiltX += (aimX - tiltX) * ease;
    tiltY += (aimY - tiltY) * ease;
    if (elapsed >= nextPulse) pulse();
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
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
})();

