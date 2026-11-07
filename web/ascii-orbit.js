const TAU = 2 * Math.PI;
const CYCLE_MS = 4800;
const GLYPHS = "@#%*+=01";
const BASE = [82, 144, 255];
const CYAN = [119, 234, 255];
const GOLD = [255, 205, 118];
const WHITE = [255, 249, 222];

function noise(seed) {
  const value = Math.sin(seed * 127.1 + 74.7) * 43758.5453123;
  return value - Math.floor(value);
}

function mix(from, to, weight) {
  return from.map((value, index) => Math.round(value + (to[index] - value) * weight));
}

function color(from, to, weight, alpha = 1) {
  return "rgba(" + mix(from, to, weight).join(",") + "," + alpha + ")";
}

function sampleMark() {
  const brush = document.createElement("canvas").getContext("2d");
  const bubble = new Path2D("M5 5h14v11H9l-4 3V5Z");
  const check = new Path2D("m9 10 2 2 4-4");
  brush.lineWidth = 1.6;
  brush.lineJoin = brush.lineCap = "round";
  const cells = [];
  for (let y = 4; y <= 20; y += .5) {
    for (let x = 4; x <= 20; x += .5) {
      const tick = brush.isPointInStroke(check, x, y);
      if (tick || brush.isPointInStroke(bubble, x, y)) cells.push({x, y, tick});
    }
  }
  return cells;
}

const cells = sampleMark();
const tilt = -.38;
const glints = [
  {x: -1.08, y: -.28, phase: .13, size: 27},
  {x: .99, y: -.6, phase: .41, size: 35},
  {x: .7, y: .78, phase: .7, size: 30},
  {x: -.65, y: -.77, phase: .91, size: 26}
];

function orbitPoint(angle, rx, ry) {
  const x = Math.cos(angle) * rx;
  const y = Math.sin(angle) * ry;
  return [x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)];
}

function paintTrail(context, phase, rx, ry, front) {
  const count = 54;
  for (let index = 0; index < count; index += 1) {
    const angle = TAU * (phase - index * .0084);
    if ((Math.sin(angle) >= 0) !== front) continue;
    const jitter = (noise(index + 11) - .5) * 23;
    const [x, y] = orbitPoint(angle, rx + jitter, ry + jitter * .55);
    const power = (1 - index / count) ** 1.16;
    const hot = Math.max(0, 1 - index / 10);
    const glyph = GLYPHS[Math.floor(noise(index + Math.floor(phase * 32) * 61) * GLYPHS.length)];
    context.font = (index % 4 === 0 ? 13 : 9) + "px monospace";
    context.fillStyle = color(index % 6 === 0 ? GOLD : index % 3 === 0 ? BASE : CYAN, WHITE, hot, power * (front ? 1 : .78));
    context.fillText(glyph, x, y);
    if (index < 25 && index % 2 === 0) {
      const [sparkX, sparkY] = orbitPoint(angle, rx + jitter + 15, ry + jitter * .55 + 10);
      context.font = "8px monospace";
      context.fillStyle = color(CYAN, GOLD, noise(index), power * .56);
      context.fillText(index % 6 === 0 ? "*" : "+", sparkX, sparkY);
    }
  }
}

function paintStar(context, x, y, size, alpha, diagonals) {
  if (alpha < .02) return;
  context.save();
  context.translate(x, y);
  context.globalAlpha = alpha;
  const bloom = context.createRadialGradient(0, 0, 0, 0, 0, size * .85);
  bloom.addColorStop(0, "rgba(255,222,156,.38)");
  bloom.addColorStop(.45, "rgba(255,185,98,.12)");
  bloom.addColorStop(1, "rgba(255,185,98,0)");
  context.fillStyle = bloom;
  context.fillRect(-size, -size, size * 2, size * 2);
  context.fillStyle = "#fff2cf";
  context.shadowColor = "#ffbd67";
  context.shadowBlur = 13;
  for (let index = 0; index < (diagonals ? 4 : 2); index += 1) {
    context.rotate(index === 0 ? 0 : (diagonals ? Math.PI / 4 : Math.PI / 2));
    const length = index % 2 === 0 ? size : size * .63;
    context.beginPath();
    context.moveTo(0, -length);
    context.lineTo(1.55, -2.2);
    context.lineTo(0, length);
    context.lineTo(-1.55, 2.2);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function paintMark(context, phase, scale) {
  context.font = "600 " + (scale * .51) + "px monospace";
  context.shadowColor = "#f4c67c";
  for (const [index, cell] of cells.entries()) {
    const drift = noise(index + 7);
    const pulse = (1 + Math.cos(TAU * (phase - (cell.x + cell.y * .65) / 38))) / 2;
    const beam = pulse ** 11;
    const position = Math.floor(phase * (drift > .45 ? 24 : 13) + drift);
    const glyph = GLYPHS[Math.floor(noise(index * 3.4 + position * 149) * GLYPHS.length)];
    const body = mix(cell.tick ? GOLD : BASE, cell.tick ? WHITE : CYAN, .27 + .58 * pulse);
    context.shadowBlur = beam > .76 ? scale * .44 : 0;
    context.fillStyle = color(body, mix(GOLD, WHITE, beam), beam * .96, .84 + drift * .16);
    context.fillText(glyph, (cell.x - 12) * scale, (cell.y - 12) * scale);
  }
  context.shadowBlur = 0;
}

export function renderAsciiOrbit(context, width, height, time, compact = false) {
  const phase = ((time % CYCLE_MS) + CYCLE_MS) % CYCLE_MS / CYCLE_MS;
  const logicalHeight = compact ? 350 : 720;
  const markY = compact ? 156 : 318;
  const scale = compact ? 13.8 : 18.3;
  const radius = compact ? 131 : 171;
  const minor = compact ? 70 : 102;
  context.setTransform(width / 720, 0, 0, height / logicalHeight, 0, 0);
  context.clearRect(0, 0, 720, logicalHeight);
  if (!compact) {
    context.fillStyle = "#070c1a";
    context.fillRect(0, 0, 720, logicalHeight);
  }
  const glow = context.createRadialGradient(360, markY, 6, 360, markY, compact ? 148 : 278);
  glow.addColorStop(0, "rgba(44,91,182,.27)");
  glow.addColorStop(.48, "rgba(21,64,134,.14)");
  glow.addColorStop(1, "rgba(9,20,48,0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 720, logicalHeight);

  context.save();
  context.translate(360, markY);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "8px monospace";
  for (let index = 0; index < 29; index += 1) {
    const angle = noise(index + 20) * TAU;
    const distance = radius * (.65 + .73 * noise(index + 70));
    const twinkle = ((1 + Math.cos(TAU * (phase * (1 + index % 3) + noise(index)))) / 2) ** 4;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance * .73;
    context.fillStyle = color(index % 4 === 0 ? GOLD : CYAN, WHITE, twinkle * .55, .10 + twinkle * .61);
    context.fillText(index % 3 === 0 ? "+" : "*", x, y);
  }
  paintTrail(context, phase, radius, minor, false);
  paintMark(context, phase, scale);
  paintTrail(context, phase, radius, minor, true);
  for (const [index, glint] of glints.entries()) {
    const flash = ((1 + Math.cos(TAU * (phase - glint.phase))) / 2) ** 19;
    paintStar(context, glint.x * radius, glint.y * radius, glint.size * (compact ? .75 : 1), flash, index % 2 === 1);
  }
  context.restore();

  const title = "CQA DESK";
  context.font = (compact ? "600 19px" : "600 22px") + " monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#e3edff";
  const spacing = compact ? 15 : 19;
  for (const [index, letter] of [...title].entries()) {
    context.fillText(letter, 360 + (index - (title.length - 1) / 2) * spacing, compact ? 294 : 545);
  }
}

const canvas = document.querySelector("[data-ascii-orbit]");
if (canvas) {
  const context = canvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let onscreen = false;
  let pending = 0;
  let last = -Infinity;
  let elapsed = 1660;
  let previous = 0;

  function render(time) {
    renderAsciiOrbit(context, canvas.width, canvas.height, time, true);
  }

  function animate(time) {
    pending = 0;
    elapsed += previous ? time - previous : 0;
    previous = time;
    if (time - last >= 1000 / 30) {
      render(elapsed);
      last = time;
    }
    pending = requestAnimationFrame(animate);
  }

  function sync() {
    if (!reducedMotion.matches && onscreen && !document.hidden) {
      if (!pending) pending = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(pending);
      pending = previous = 0;
      if (reducedMotion.matches) render(1660);
    }
  }

  render(1660);
  new IntersectionObserver(([entry]) => {
    onscreen = entry.isIntersecting;
    sync();
  }).observe(canvas);
  reducedMotion.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
}
