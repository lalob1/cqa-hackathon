"use strict";

(() => {
  const canvas = document.querySelector(".orbit-field");
  const stage = document.querySelector("#orbit-stage");
  const ctx = canvas?.getContext("2d", {alpha: true});
  if (!ctx || !stage) return;

  const tau = Math.PI * 2;
  let fModel = null;
  fetch("/f-model.json").then(response => {
    if (!response.ok) throw new Error("F model unavailable");
    return response.json();
  }).then(model => {
    if (!Array.isArray(model.surfaces) || !Array.isArray(model.materials)) return;
    fModel = model;
    draw();
  }).catch(() => { /* The vector mark remains available as a loading fallback. */ });
  const logo = new Image();
  logo.src = "/f-mark.svg";
  const shield = new Path2D("M16 20h128v39c0 52-20 88-64 113C36 147 16 111 16 59V20Z");
  const orbits = [
    {radius: .86, tilt: 1.12, lean: -.15, twist: -.32, speed: .23, count: 4},
    {radius: 1.12, tilt: .64, lean: .48, twist: .72, speed: -.16, count: 4},
    {radius: 1.36, tilt: 1.28, lean: -.60, twist: -.72, speed: .12, count: 3}
  ];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let width = 0, height = 0, dpr = 1;
  let elapsed = 0, orbitTime = 0, previous = 0, paintedAt = -Infinity, request;
  let yaw = 0, pitch = 0, aimX = 0, aimY = 0, tiltX = 0, tiltY = 0;
  let drag = null, wasDragged = false, pulseAt = -10;

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

  function scene() {
    return {x: width * .76, y: height * .81,
      radius: Math.min(width * .52, height * .5)};
  }

  function project(point, view) {
    const perspective = 4.2 / (4.2 - point[2] * .6);
    return {x: view.x + point[0] * view.radius * perspective,
      y: view.y + point[1] * view.radius * perspective, z: point[2], perspective};
  }

  function position(orbit, angle) {
    const local = [Math.cos(angle) * orbit.radius, Math.sin(angle) * orbit.radius, 0];
    return rotate(rotate(local, orbit.tilt, orbit.lean, orbit.twist),
      pitch + tiltY, yaw + tiltX);
  }

  function glow(x, y, radius, opacity, green = false) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, (green ? "rgba(91,200,122," : "rgba(115,208,255,") + opacity + ")");
    light.addColorStop(1, "rgba(65,143,205,0)");
    ctx.fillStyle = light;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function glint(x, y, radius, opacity, gold = false) {
    const rgb = gold ? "255,237,177," : "160,235,255,";
    ctx.strokeStyle = "rgba(" + rgb + opacity + ")";
    ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(x - radius, y);
    ctx.lineTo(x + radius, y);
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x, y + radius);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,251,229," + opacity + ")";
    ctx.fillRect(x - .8, y - .8, 1.6, 1.6);
  }

  function ring(orbit, view, front) {
    ctx.lineWidth = .7;
    ctx.strokeStyle = front ? "rgba(123,208,242,.20)" : "rgba(93,172,217,.10)";
    ctx.beginPath();
    let connected = false;
    for (let i = 0; i <= 144; i++) {
      const p = project(position(orbit, i / 144 * tau), view);
      if ((p.z > 0) !== front) { connected = false; continue; }
      if (!connected) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      connected = true;
    }
    ctx.stroke();
  }

  function coin(item, view) {
    const {p, id, angle, orbit} = item;
    // A short light trail follows each actual orbital path.
    for (let j = 16; j > 0; j--) {
      const direction = Math.sign(orbit.speed);
      const a = project(position(orbit, angle - j * .009 * direction), view);
      const b = project(position(orbit, angle - (j - 1) * .009 * direction), view);
      ctx.lineWidth = .6 + (1 - j / 16) * 1.1;
      ctx.strokeStyle = "rgba(119,216,235," + (1 - j / 17) * .25 + ")";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    const size = clamp(view.radius * .047, 9, 22) * p.perspective;
    const face = .26 + .74 * Math.abs(Math.cos(elapsed * .50 + id * 1.9));
    const alpha = p.z > 0 ? .76 : .35;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(elapsed * .14 + id) * .22);
    ctx.globalAlpha = alpha;
    // Offset rim, milled edge, warm metal face and an inset stamped currency.
    ctx.fillStyle = "#79531f";
    ctx.beginPath();
    ctx.ellipse(2.8, 1.4, size * face, size, 0, 0, tau);
    ctx.fill();
    ctx.strokeStyle = "#e0ad4e";
    ctx.lineWidth = 1.1;
    for (let i = -4; i <= 4; i++) {
      const y = i / 5 * size;
      const x = Math.sqrt(size * size - y * y) * face;
      ctx.beginPath();
      ctx.moveTo(x - .2, y);
      ctx.lineTo(x + 2.7, y + 1.3);
      ctx.stroke();
    }
    ctx.scale(face, 1);
    const metal = ctx.createLinearGradient(-size, -size, size, size);
    metal.addColorStop(0, "#fff0b7");
    metal.addColorStop(.27, "#e8c06e");
    metal.addColorStop(.56, "#b88635");
    metal.addColorStop(.8, "#edcf89");
    metal.addColorStop(1, "#a5752b");
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, tau);
    ctx.fill();
    ctx.strokeStyle = "#ffe9aa";
    ctx.lineWidth = .9;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, size * .77, 0, tau);
    ctx.strokeStyle = "#805c2f8c";
    ctx.lineWidth = .8;
    ctx.stroke();
    ctx.font = "600 " + size * 1.07 + "px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const currency = ["₸", "$", "€"][id % 3];
    ctx.fillStyle = "#fff0b7a6";
    ctx.fillText(currency, -.5, 1);
    ctx.fillStyle = "#795221";
    ctx.fillText(currency, 0, .4);
    ctx.restore();
    const sparkle = Math.pow(.5 + .5 * Math.sin(elapsed * 1.3 + id * 2.1), 14);
    if (sparkle > .25 && p.z > 0) {
      glow(p.x - size * .35, p.y - size * .7, size, sparkle * .16);
      glint(p.x - size * .35, p.y - size * .7, 3 + sparkle * 4, sparkle * .65, true);
    }
  }

  function flatMark(view) {
    if (!logo.complete || !logo.naturalWidth) return;
    const h = view.radius * .76;
    const w = h * 160 / 184;
    const floatX = Math.sin(elapsed * .43) * view.radius * .011;
    const floatY = Math.sin(elapsed * .72) * view.radius * .027;
    const turn = Math.sin(elapsed * .48) * .15 + tiltX * .5 + Math.sin(yaw) * .12;
    const roll = Math.sin(elapsed * .55) * .037 + tiltY * .10;
    const breathe = 1 + Math.sin(elapsed * .72 - .6) * .018;
    glow(view.x + floatX, view.y + floatY, h * .85,
      .10 + (Math.sin(elapsed * .72) + 1) * .014, true);
    ctx.save();
    ctx.translate(view.x + floatX, view.y + floatY);
    ctx.rotate(roll);
    ctx.transform(Math.cos(turn), Math.sin(turn) * .065, Math.sin(turn) * .16, 1, 0, 0);
    ctx.scale(breathe, breathe);
    ctx.translate(-w / 2, -h / 2);
    ctx.globalAlpha = .73;
    ctx.drawImage(logo, 0, 0, w, h);
    // A narrow light pass stays clipped to the shield silhouette.
    ctx.scale(w / 160, h / 184);
    ctx.clip(shield);
    const travel = (elapsed % 8) / 8 * 430 - 150;
    const light = ctx.createLinearGradient(travel - 65, 0, travel + 65, 184);
    light.addColorStop(0, "rgba(183,241,211,0)");
    light.addColorStop(.46, "rgba(199,253,223,0)");
    light.addColorStop(.5, "rgba(231,255,223,.36)");
    light.addColorStop(.56, "rgba(199,253,223,0)");
    light.addColorStop(1, "rgba(183,241,211,0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, 160, 184);
    ctx.restore();
  }

  function normalized(point) {
    const length = Math.hypot(...point);
    return point.map(value => value / length);
  }

  function mark(view) {
    if (!fModel) return flatMark(view);
    const size = view.radius * .71;
    const x = view.x + Math.sin(elapsed * .43) * view.radius * .011;
    const y = view.y + Math.sin(elapsed * .72) * view.radius * .027;
    const turn = .38 + Math.sin(elapsed * .48) * .22 + tiltX * .60 + yaw * .70;
    const lean = -.14 + Math.sin(elapsed * .39) * .075 + tiltY * .45 + pitch * .60;
    const roll = Math.sin(elapsed * .55) * .035;
    const breathe = 1 + Math.sin(elapsed * .72 - .6) * .018;
    const light = normalized([-.8 + Math.sin(elapsed * .25) * .25, .85, 1.7]);
    const halfway = normalized([light[0], light[1], light[2] + 1]);
    const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
    const shade = (color, illumination, specular) =>
      "rgb(" + color.map(value => Math.round(clamp(value * illumination + specular, 0, 255))).join(",") + ")";
    const faces = [];
    const frontFacing = rotate([0, 0, 1], lean, turn, roll)[2] > 0;
    for (const face of fModel.surfaces) {
      if (face.material >= 3 && !frontFacing) continue;
      const normal = rotate(face.normal, lean, turn, roll);
      if (normal[2] < .001) continue;
      const points = face.vertices.map(vertex => rotate(vertex, lean, turn, roll));
      const screen = points.map(point => {
        const perspective = 3 / (3 - point[2] * .7);
        return [x + point[0] * size * perspective * breathe,
          y - point[1] * size * perspective * breathe];
      });
      faces.push({screen, normal, material: face.material,
        depth: points.reduce((sum, point) => sum + point[2], 0) / points.length});
    }
    faces.sort((a, b) => Number(a.material >= 3) - Number(b.material >= 3) || a.depth - b.depth);
    glow(x, y, size * .80, .10 + (Math.sin(elapsed * .72) + 1) * .014, true);
    ctx.save();
    ctx.globalAlpha = .84;
    for (const face of faces) {
      const material = fModel.materials[face.material];
      const illumination = .35 + Math.max(0, dot(face.normal, light)) * .85;
      const specular = Math.pow(Math.max(0, dot(face.normal, halfway)), 34) * 105;
      const points = face.screen;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        if (!i) ctx.moveTo(...points[i]);
        else ctx.lineTo(...points[i]);
      }
      ctx.closePath();
      if (points.length > 10) {
        const minX = Math.min(...points.map(point => point[0]));
        const maxX = Math.max(...points.map(point => point[0]));
        const minY = Math.min(...points.map(point => point[1]));
        const maxY = Math.max(...points.map(point => point[1]));
        const gradient = ctx.createLinearGradient(minX, minY, maxX, maxY);
        gradient.addColorStop(0, shade(material.color, illumination * 1.14, specular));
        gradient.addColorStop(.6, shade(material.color, illumination, specular * .7));
        gradient.addColorStop(1, shade(material.color, illumination * .75, specular * .3));
        ctx.fillStyle = gradient;
      } else {
        ctx.fillStyle = shade(material.color, illumination, specular);
      }
      ctx.fill();
      // Matching edge strokes close subpixel seams between neighbouring faces.
      ctx.strokeStyle = shade(material.color, illumination, specular);
      ctx.lineWidth = .5;
      ctx.stroke();
      if (face.material === 3 && points.length > 10) {
        ctx.save();
        ctx.clip();
        const shine = (elapsed % 8) / 8 * size * 2.5 - size * 1.2;
        const pass = ctx.createLinearGradient(x + shine - size * .15, y - size * .5,
          x + shine + size * .15, y + size * .5);
        pass.addColorStop(0, "rgba(229,255,211,0)");
        pass.addColorStop(.46, "rgba(229,255,211,0)");
        pass.addColorStop(.5, "rgba(229,255,211,.20)");
        pass.addColorStop(.56, "rgba(229,255,211,0)");
        pass.addColorStop(1, "rgba(229,255,211,0)");
        ctx.fillStyle = pass;
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const view = scene();
    const coins = [];
    let id = 0;
    for (const orbit of orbits) {
      ring(orbit, view, false);
      for (let i = 0; i < orbit.count; i++) {
        const angle = orbitTime * orbit.speed + i / orbit.count * tau + id * .34;
        coins.push({p: project(position(orbit, angle), view), id, angle, orbit});
        id++;
      }
    }
    coins.sort((a, b) => a.p.z - b.p.z);
    for (const item of coins) if (item.p.z <= 0) coin(item, view);
    mark(view);
    for (const orbit of orbits) ring(orbit, view, true);
    for (const item of coins) if (item.p.z > 0) coin(item, view);

    const age = elapsed - pulseAt;
    if (age >= 0 && age < 2.4) {
      const progress = age / 2.4;
      ctx.beginPath();
      ctx.arc(view.x, view.y, view.radius * (.12 + progress * 1.2), 0, tau);
      ctx.strokeStyle = "rgba(125,225,215," + (1 - progress) * .22 + ")";
      ctx.lineWidth = .8;
      ctx.stroke();
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function pulse() { pulseAt = elapsed; }

  function beginDrag(event) {
    if (event.button !== 0) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY};
    wasDragged = false;
    stage.setPointerCapture(event.pointerId);
  }
  window.addEventListener("pointermove", event => {
    aimX = (event.clientX / width - .5) * .30;
    aimY = (event.clientY / height - .5) * .20;
    if (!drag || drag.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) wasDragged = true;
    yaw += (event.clientX - drag.x) * .007;
    pitch = clamp(pitch + (event.clientY - drag.y) * .004, -.8, .8);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }, {passive: true});
  stage.addEventListener("pointerdown", beginDrag);
  window.addEventListener("pointerdown", event => {
    if (event.target.closest("button, a, input, textarea, select, label, summary, .workspace, .editor, .library, nav")) return;
    beginDrag(event);
  });
  function release(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener("lostpointercapture", () => { drag = null; });
  stage.addEventListener("click", event => { if (!wasDragged || event.detail === 0) pulse(); });
  window.addEventListener("click", event => {
    if (event.target.closest("button, a, input, textarea, select, label, summary, .workspace, .editor, .library")) return;
    pulse();
  });
  window.addEventListener("blur", () => { drag = null; aimX = 0; aimY = 0; });
  window.addEventListener("resize", resize);

  function animate(now) {
    const delta = previous ? Math.min(now - previous, 100) / 1000 : 0;
    elapsed += delta;
    previous = now;
    const boost = Math.max(0, 1 - (elapsed - pulseAt) / 3);
    orbitTime += delta * (1 + boost * 2);
    const ease = 1 - Math.exp(-delta * 5);
    tiltX += (aimX - tiltX) * ease;
    tiltY += (aimY - tiltY) * ease;
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
  logo.addEventListener("load", draw);
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
})();
