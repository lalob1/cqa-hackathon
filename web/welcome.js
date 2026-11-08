"use strict";

(() => {
  const stage = document.querySelector("#ascii-stage");
  const canvas = document.querySelector("#ascii-canvas");
  const baseContext = canvas?.getContext("2d", {alpha: true});
  if (!baseContext || !stage) return;

  const glyphs = "@#%*+=01";
  const green = ["#103a2b", "#155a34", "#1f8d43", "#2fb857", "#48d972", "#67ea89", "#8ef5a1", "#d9ffe2"];
  const step = .027;
  let points = [], width = 1, height = 1, scale = 1;
  let elapsed = 0, previous = 0, painted = -Infinity, request;
  let yaw = 0, pitch = 0, aimX = 0, aimY = 0, tiltX = 0, tiltY = 0;
  let drag = null, dragged = false, pulseAt = -10, exitAt = -1, exitDuration = 1.25;
  let pointer = {x: -1000, y: -1000, inside: false};
  let exitLayer = null, hitPoints = [];
  const escapes = new Map();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const active = () => !document.hidden && document.body.dataset.view === "start";

  function inside(x, y, polygon) {
    let result = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  }

  function prepare(model) {
    const letter = model.surfaces.find(face => face.material === 3 && face.vertices.length > 10);
    const shield = model.surfaces.find(face => face.material === 0 && face.vertices.length > 10);
    const result = [];
    const add = (position, normal, strength) => result.push({position, normal, strength, seed: result.length});
    for (let y = -.50; y <= .50; y += step) {
      for (let x = -.43; x <= .43; x += step) {
        if (inside(x, y, letter.vertices)) add([x, y, .12], [0, 0, 1], .92);
        else if (inside(x, y, shield.vertices)) add([x, y, .05], [0, 0, 1], .17);
      }
    }
    for (const face of model.surfaces) {
      if (face.vertices.length !== 4) continue;
      const [a, b, c, d] = face.vertices;
      const across = Math.max(1, Math.ceil(Math.hypot(...a.map((v, i) => v - b[i])) / step));
      const deep = Math.max(1, Math.ceil(Math.hypot(...a.map((v, i) => v - d[i])) / step));
      const strength = [0, .30, .57, 0, .60, .96][face.material];
      for (let u = 0; u < across; u++) {
        for (let v = 0; v <= deep; v++) {
          const s = u / across, t = v / deep;
          add(a.map((value, i) => (1-s)*(1-t)*value + s*(1-t)*b[i] + s*t*c[i] + (1-s)*t*d[i]),
            face.normal, strength);
        }
      }
    }
    points = result;
    draw();
  }

  fetch("/f-model.json").then(response => {
    if (!response.ok) throw new Error("ASCII model unavailable");
    return response.json();
  }).then(prepare).catch(() => {
    // The workspace remains available if a decorative model cannot be loaded.
    stage.setAttribute("aria-label", "Логотип F");
  });

  function rotation(x, y, z) {
    const cy = Math.cos(y), sy = Math.sin(y);
    const cx = Math.cos(x), sx = Math.sin(x);
    const cz = Math.cos(z), sz = Math.sin(z);
    return point => {
      const a = point[0] * cy + point[2] * sy;
      const b = point[2] * cy - point[0] * sy;
      const c = point[1] * cx - b * sx;
      return [a * cz - c * sz, a * sz + c * cz, point[1] * sx + b * cx];
    };
  }

  function draw() {
    if (!active()) return;
    const ctx = exitLayer?.context ?? baseContext;
    const paintWidth = exitLayer?.width ?? width;
    const paintHeight = exitLayer?.height ?? height;
    const offsetX = exitLayer?.left ?? 0;
    const offsetY = exitLayer?.top ?? 0;
    ctx.clearRect(0, 0, paintWidth, paintHeight);
    const centerX = offsetX + width / 2;
    const centerY = offsetY + height * .49 + Math.sin(elapsed * .65) * 7;
    const exit = exitAt < 0 ? 0 : clamp((elapsed - exitAt) / exitDuration, 0, 1);
    const turn = rotation(-.11 + pitch + tiltY,
      .18 + Math.sin(elapsed * .27) * .22 + yaw + tiltX, Math.sin(elapsed * .31) * .025);
    const fog = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, scale * .72);
    fog.addColorStop(0, "rgba(63,197,98," + .085 * (1 - exit) + ")");
    fog.addColorStop(1, "rgba(27,112,66,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, paintWidth, paintHeight);
    const projected = [];
    const hits = [];
    for (const [seed, state] of escapes) if (elapsed - state.start >= state.duration) escapes.delete(seed);
    const age = elapsed - pulseAt;
    for (const point of points) {
      const normal = turn(point.normal);
      if (normal[2] < -.05 && !escapes.has(point.seed)) continue;
      const position = turn(point.position);
      const perspective = 3.3 / (3.3 - position[2] * .65);
      let x = centerX + position[0] * scale * perspective;
      let y = centerY - position[1] * scale * perspective;
      let depth = position[2];
      if (!exitLayer && point.strength > .4) hits.push({x, y, seed: point.seed});
      const light = clamp(normal[0] * -.3 + normal[1] * .35 + normal[2] * .9, .1, 1);
      const sweep = Math.pow(.5 + .5 * Math.cos(position[0] * 5 - position[1] * 2 - elapsed * 1.1), 16);
      const hover = pointer.inside ? Math.max(0, 1 - Math.hypot(x - pointer.x - offsetX, y - pointer.y - offsetY) / 80) : 0;
      const wave = age >= 0 && age < 2.1
        ? Math.max(0, 1 - Math.abs(Math.hypot(...point.position.slice(0, 2)) - age * .55) / .10) : 0;
      let brightness = point.strength * (.60 + light * .40) + sweep * .25 + hover * .35 + wave * .5;
      let opacity = 1;
      const escaped = escapes.get(point.seed);
      if (escaped) {
        const age = elapsed - escaped.start;
        const release = clamp(age / .18, 0, 1);
        const returning = clamp((age - escaped.hold) / .5, 0, 1);
        const weight = release * release * (3 - 2 * release) *
          (1 - returning * returning * (3 - 2 * returning));
        x += escaped.dx * weight;
        y += escaped.dy * weight;
        depth += weight * .12;
        brightness += weight * .28;
      }
      if (exitAt >= 0) {
        const delay = (point.seed % 19) / 19 * .10 +
          (point.position[0] + .5) * .06 + (.5 - point.position[1]) * .10;
        const progress = clamp((exit - delay) / .76, 0, 1);
        const spread = progress ** 1.85;
        const angle = Math.atan2(y - centerY, x - centerX) + Math.sin(point.seed * .8) * .14 + spread * .30;
        const distance = Math.hypot(paintWidth, paintHeight) * spread * (.8 + (point.seed % 7) * .055);
        x += Math.cos(angle) * distance;
        y += Math.sin(angle) * distance * .78 - spread * scale * .12;
        brightness += Math.sin(Math.min(1, progress * 2) * Math.PI) * .40;
        opacity = 1 - progress;
      }
      projected.push({x, y, z: depth, opacity, glyph: escaped?.glyph,
        color: Math.round(clamp(brightness * 5.8, 0, 7)), seed: point.seed});
    }
    if (!exitLayer) hitPoints = hits;
    projected.sort((a, b) => a.z - b.z);
    ctx.font = Math.max(7, Math.min(13, scale * step * .91)) + "px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const tick = Math.floor(elapsed * (age < 1 ? 17 : 7));
    for (const point of projected) {
      ctx.globalAlpha = point.opacity;
      ctx.fillStyle = green[point.color];
      ctx.fillText(point.glyph ?? glyphs[(point.seed * 7 + tick * (point.seed % 3 + 1)) % glyphs.length], point.x, point.y);
    }
    ctx.globalAlpha = 1;
    if (exitAt >= 0) {
      ctx.font = Math.max(5, Math.min(9, scale * step * .64)) + "px ui-monospace, Consolas, monospace";
      for (const point of projected) {
        if (point.seed % 8 || point.opacity < .02) continue;
        ctx.globalAlpha = point.opacity * .36;
        ctx.fillStyle = green[Math.min(6, point.color)];
        ctx.fillText(point.seed % 3 ? "+" : ".", point.x - 7 - point.seed % 5, point.y + 5);
      }
      ctx.globalAlpha = 1;
    }
    // A few detached characters give the mark a quiet terminal atmosphere.
    ctx.font = "9px ui-monospace, Consolas, monospace";
    for (let i = 0; i < 20; i++) {
      const angle = i * 2.39996 + elapsed * .045;
      const spread = scale * (.57 + (i % 4) * .035);
      const alpha = (.14 + (.5 + .5 * Math.sin(elapsed * .8 + i)) * .25) * (1 - exit);
      ctx.fillStyle = "rgba(112,229,138," + alpha + ")";
      ctx.fillText(i % 3 ? "+" : "1", centerX + Math.cos(angle) * spread,
        centerY + Math.sin(angle) * spread * .7);
    }
  }

  function resize() {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    width = box.width;
    height = box.height;
    scale = Math.min(width * .94, height * .86);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    baseContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function escapeCharacters(from, to) {
    if (escapes.size >= 120 || exitAt >= 0) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    let added = 0;
    for (const point of hitPoints) {
      if (escapes.has(point.seed) || point.seed % 2) continue;
      const t = length ? clamp(((point.x - from.x) * dx + (point.y - from.y) * dy) / length, 0, 1) : 0;
      const x = from.x + dx * t, y = from.y + dy * t;
      if (Math.hypot(point.x - x, point.y - y) > 23) continue;
      const hold = .25 + (point.seed % 4) * .035;
      const distance = 24 + (point.seed % 5) * 6;
      const angle = Math.hypot(point.x - x, point.y - y) < 2 ? point.seed * 2.39996 :
        Math.atan2(point.y - y, point.x - x) + (point.seed % 5 - 2) * .12;
      escapes.set(point.seed, {start: elapsed, hold, duration: hold + .5,
        dx: Math.cos(angle) * distance, dy: Math.sin(angle) * distance,
        glyph: glyphs[(point.seed * 7 + Math.floor(elapsed * 7) * (point.seed % 3 + 1)) % glyphs.length]});
      if (++added >= 14 || escapes.size >= 120) break;
    }
  }

  function startExit(event) {
    if (exitLayer) return;
    exitAt = elapsed;
    exitDuration = (event.detail?.duration ?? 1250) / 1000;
    pulseAt = elapsed;
    const box = stage.getBoundingClientRect();
    const overlay = document.createElement("canvas");
    overlay.className = "ascii-exit-field";
    overlay.setAttribute("aria-hidden", "true");
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    overlay.width = Math.ceil(window.innerWidth * dpr);
    overlay.height = Math.ceil(window.innerHeight * dpr);
    const context = overlay.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    exitLayer = {canvas: overlay, context, width: window.innerWidth, height: window.innerHeight,
      left: box.left, top: box.top};
    document.body.append(overlay);
    canvas.classList.add("is-dissolving");
    draw();
  }

  stage.addEventListener("pointermove", event => {
    const box = stage.getBoundingClientRect();
    const from = pointer;
    pointer = {x: event.clientX - box.left, y: event.clientY - box.top, inside: true};
    if (event.pointerType === "mouse" && !drag) escapeCharacters(from.inside ? from : pointer, pointer);
    aimX = (pointer.x / width - .5) * .32;
    aimY = (pointer.y / height - .5) * .18;
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) dragged = true;
    yaw = clamp(yaw + (event.clientX - drag.x) * .005, -.70, .70);
    pitch = clamp(pitch + (event.clientY - drag.y) * .003, -.32, .32);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }, {passive: true});
  stage.addEventListener("pointerleave", () => { pointer.inside = false; aimX = 0; aimY = 0; });
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY};
    dragged = false;
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
  stage.addEventListener("click", event => { if (!dragged || event.detail === 0) pulseAt = elapsed; });
  stage.addEventListener("ascii:exit", startExit);

  function animate(now) {
    const delta = previous ? Math.min(now - previous, 100) / 1000 : 0;
    elapsed += delta;
    previous = now;
    const ease = 1 - Math.exp(-delta * 5);
    tiltX += (aimX - tiltX) * ease;
    tiltY += (aimY - tiltY) * ease;
    if (!drag) { yaw *= Math.exp(-delta * .18); pitch *= Math.exp(-delta * .18); }
    if (now - painted >= 1000 / 30 - .5) { draw(); painted = now; }
    request = requestAnimationFrame(animate);
  }
  function sync() {
    cancelAnimationFrame(request);
    previous = 0;
    if (!active()) {
      exitLayer?.canvas.remove();
      exitLayer = null;
      canvas.classList.remove("is-dissolving");
      escapes.clear();
    }
    if (active()) { exitAt = -1; resize(); request = requestAnimationFrame(animate); }
  }
  new ResizeObserver(resize).observe(stage);
  document.addEventListener("visibilitychange", sync);
  document.addEventListener("cqa:view-change", sync);
  sync();
})();
