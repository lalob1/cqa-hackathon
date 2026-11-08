"use strict";

(() => {
  const canvas = document.querySelector("#brand-ascii");
  const link = canvas?.closest("a");
  const ctx = canvas?.getContext("2d");
  if (!ctx || !link) return;

  const source = document.createElement("canvas");
  let ink = source.getContext("2d", {willReadFrequently: true});
  ink.font = "750 88px Segoe UI, sans-serif";
  const measured = ink.measureText("Democrats");
  source.width = Math.ceil(measured.width + 8);
  source.height = Math.ceil(measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent + 8);
  ink = source.getContext("2d", {willReadFrequently: true});
  ink.font = "750 88px Segoe UI, sans-serif";
  ink.fillStyle = "#fff";
  ink.fillText("Democrats", 4, 4 + measured.actualBoundingBoxAscent);
  const mask = ink.getImageData(0, 0, source.width, source.height).data;
  const points = [];
  for (let y = 3; y < source.height; y += 6) {
    for (let x = 3; x < source.width; x += 6) {
      if (mask[(Math.floor(y) * source.width + Math.floor(x)) * 4 + 3] > 95) points.push([x, y]);
    }
  }
  const chars = "@#%*+01";
  const blue = ["#244e85", "#2c5d9f", "#356db8", "#417dce", "#5b97e3", "#82b2ef"];
  let width = 1, height = 1, scale = 1;
  let elapsed = 0, previous = 0, painted = -Infinity, request, hoverUntil = -1;

  function draw() {
    ctx.clearRect(0, 0, width, height);
    const left = (width - source.width * scale) / 2;
    const top = (height - source.height * scale) / 2;
    const tick = Math.floor(elapsed * 6);
    const hovering = elapsed < hoverUntil;
    ctx.font = Math.max(3, scale * 7.3) + "px ui-monospace, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      const sweep = Math.pow(.5 + .5 * Math.cos(x / source.width * 5 - elapsed * 1.3), 12);
      ctx.fillStyle = blue[Math.min(5, 1 + Math.round(sweep * 3) + (hovering ? 1 : 0))];
      const shift = hovering ? Math.sin(i * 1.3 + elapsed * 13) * .7 : 0;
      ctx.fillText(chars[(i * 3 + tick) % chars.length], left + x * scale + shift, top + y * scale);
    }
  }
  function resize() {
    const box = link.getBoundingClientRect();
    width = box.width;
    height = box.height;
    scale = Math.min((width - 4) / source.width, (height - 4) / source.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.ceil(width * dpr);
    canvas.height = Math.ceil(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function animate(now) {
    if (previous) elapsed += Math.min(now - previous, 100) / 1000;
    previous = now;
    if (now - painted >= 1000 / 24 - .5) { draw(); painted = now; }
    request = requestAnimationFrame(animate);
  }
  function visibility() {
    cancelAnimationFrame(request);
    previous = 0;
    if (!document.hidden) request = requestAnimationFrame(animate);
  }
  link.addEventListener("pointerenter", () => { hoverUntil = elapsed + .8; });
  new ResizeObserver(resize).observe(link);
  document.addEventListener("visibilitychange", visibility);
  resize();
  visibility();
})();
