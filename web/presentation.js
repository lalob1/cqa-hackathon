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
})();

(() => {
  const nav = document.querySelector(".app-nav");
  const bubble = nav?.querySelector(".nav-selection");
  if (!bubble) return;
  let motion = null, ready = false, destination = "";

  function place(animate) {
    const button = nav.querySelector('button[aria-current="page"]');
    if (!button || !button.offsetWidth || !nav.getClientRects().length) {
      motion?.cancel();
      motion = null;
      ready = false;
      destination = "";
      bubble.classList.remove("is-ready");
      return;
    }
    const transform = "translate(" + button.offsetLeft + "px," + button.offsetTop + "px)";
    const width = button.offsetWidth + "px";
    const height = button.offsetHeight + "px";
    const target = {transform, width, height};
    const key = [transform, width, height].join("|");
    if (ready && key === destination && animate) return;

    // Read the in-flight position before cancelling, so fast taps retarget smoothly.
    const computed = getComputedStyle(bubble);
    const from = {transform: computed.transform, width: computed.width, height: computed.height};
    motion?.cancel();
    motion = null;
    Object.assign(bubble.style, target);
    bubble.style.borderRadius = getComputedStyle(button).borderRadius;
    nav.classList.add("has-nav-selection");
    bubble.classList.add("is-ready");
    if (ready && animate) {
      const current = bubble.animate([from, target], {
        duration: 420,
        easing: "cubic-bezier(.22,1,.36,1)"
      });
      motion = current;
      current.addEventListener("finish", () => { if (motion === current) motion = null; }, {once: true});
    }
    ready = true;
    destination = key;
  }

  document.addEventListener("cqa:view-change", () => place(true));
  window.addEventListener("resize", () => place(false));
  new ResizeObserver(() => place(false)).observe(nav);
  document.fonts.ready.then(() => place(false));
  place(false);
})();

// A local light reflection follows the pointer; no idle animation or frame loop.
(() => {
  const deck = document.querySelector("#conversation-list");
  if (!deck) return;
  let glass = null;
  let frame = 0, pointerX = 0, pointerY = 0;
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    glass?.classList.remove("is-reflecting");
    glass = null;
  }
  deck.addEventListener("pointermove", event => {
    if (event.pointerType !== "mouse") return;
    const card = event.target.closest(".paper-record");
    if (!card) { reset(); return; }
    if (glass !== card) { reset(); glass = card; }
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const box = glass.getBoundingClientRect();
      glass.style.setProperty("--glass-x", (pointerX - box.left) / box.width * 100 + "%");
      glass.style.setProperty("--glass-y", (pointerY - box.top) / box.height * 100 + "%");
      glass.classList.add("is-reflecting");
    });
  }, {passive: true});
  deck.addEventListener("pointerleave", reset);
  deck.addEventListener("pointercancel", reset);
  document.addEventListener("cqa:view-change", reset);
  document.addEventListener("visibilitychange", reset);
})();

(() => {
  const deck = document.querySelector(".dialogue-deck");
  const pager = document.querySelector("#deck-pagination");
  const previous = document.querySelector("#deck-prev");
  const next = document.querySelector("#deck-next");
  if (!deck || !pager) return;
  let cards = [], current = 0, anchor = null, wheelAt = 0, wheelDelta = 0;
  let drag = null, suppressClickUntil = 0;
  const wrap = value => (value % cards.length + cards.length) % cards.length;

  function layout() {
    const narrow = deck.clientWidth < 600;
    cards.forEach((card, index) => {
      let distance = index - current;
      if (distance > cards.length / 2) distance -= cards.length;
      if (distance < -cards.length / 2) distance += cards.length;
      const steps = Math.abs(distance), shown = steps <= 3;
      const x = Math.sign(distance) * Math.min(steps, 4) * (narrow ? 159 : 224);
      const y = Math.min(steps, 4) ** 1.55 * (narrow ? 37 : 43);
      const angle = Math.sign(distance) * Math.min(steps, 4) * (narrow ? 16 : 18);
      card.style.setProperty("--paper-x", x + "px");
      card.style.setProperty("--paper-y", y + "px");
      card.style.setProperty("--paper-angle", angle + "deg");
      card.style.setProperty("--paper-scale", String(Math.max(.58, 1 - steps * .11)));
      card.style.zIndex = String(Math.max(1, 10 - steps));
      card.classList.toggle("is-current", index === current);
      card.classList.toggle("is-away", !shown);
      card.tabIndex = index === current ? 0 : -1;
      card.setAttribute("aria-current", String(index === current));
      card.setAttribute("aria-hidden", String(!shown));
    });
  }

  function paginate() {
    pager.replaceChildren();
    const count = Math.min(cards.length, 7);
    const start = Math.max(0, Math.min(current - 3, cards.length - count));
    for (let index = start; index < start + count; index++) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "deck-dot";
      dot.setAttribute("aria-label", "Диалог " + cards[index].querySelector(".record-title").textContent);
      dot.setAttribute("aria-current", String(index === current));
      dot.addEventListener("click", () => move(index, true));
      pager.append(dot);
    }
  }

  function move(index, focus = false) {
    if (!cards.length) return;
    current = wrap(index);
    anchor = cards[current].dataset.recordIndex;
    layout();
    paginate();
    document.querySelector("#deck-status").textContent = cards[current].querySelector(".record-title").textContent
      + ", " + cards[current].querySelector(".record-meta").textContent;
    if (focus) cards[current].focus({preventScroll: true});
  }

  function refresh() {
    cards = Array.from(deck.querySelectorAll(".paper-record"));
    const preserved = cards.findIndex(card => card.dataset.recordIndex === anchor);
    current = preserved < 0 ? 0 : preserved;
    previous.disabled = next.disabled = cards.length < 2;
    pager.hidden = cards.length < 2;
    deck.classList.toggle("is-empty", !cards.length);
    if (cards.length) move(current);
    else { pager.replaceChildren(); document.querySelector("#deck-status").textContent = ""; }
  }

  previous.addEventListener("click", () => move(current - 1));
  next.addEventListener("click", () => move(current + 1));
  deck.addEventListener("keydown", event => {
    const direction = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
    if (direction || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      move(event.key === "Home" ? 0 : event.key === "End" ? cards.length - 1 : current + direction, true);
    }
  });
  deck.addEventListener("wheel", event => {
    if (event.ctrlKey || cards.length < 2) return;
    event.preventDefault();
    const time = performance.now();
    if (time - wheelAt < 480) return;
    wheelDelta += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(wheelDelta) < 30) return;
    move(current + Math.sign(wheelDelta));
    wheelDelta = 0;
    wheelAt = time;
  }, {passive: false});
  deck.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary) return;
    drag = {x: event.clientX, y: event.clientY, id: event.pointerId, moved: false};
  });
  deck.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy)) {
      drag.moved = true;
      deck.setPointerCapture(event.pointerId);
      deck.classList.add("is-dragging");
    }
    if (drag.moved) {
      event.preventDefault();
      deck.style.setProperty("--drag-x", Math.max(-70, Math.min(70, dx * .32)) + "px");
    }
  });
  function release(event) {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) {
      suppressClickUntil = performance.now() + 350;
      const dx = event.clientX - drag.x;
      if (!["pointercancel", "lostpointercapture"].includes(event.type) && Math.abs(dx) > 35)
        move(current + (dx < 0 ? 1 : -1));
    }
    drag = null;
    deck.classList.remove("is-dragging");
    deck.style.removeProperty("--drag-x");
  }
  deck.addEventListener("pointerup", release);
  deck.addEventListener("pointercancel", release);
  // Touch transfers implicit capture from the paper to the deck. Ignore the
  // paper's bubbling lost-capture event while the deck still owns the gesture.
  deck.addEventListener("lostpointercapture", event => { if (event.target === deck) release(event); });
  window.addEventListener("pointerup", release);
  deck.addEventListener("click", event => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const card = event.target.closest(".paper-record");
    if (card) anchor = card.dataset.recordIndex;
  }, {capture: true});
  document.addEventListener("cqa:records-change", refresh);
  document.addEventListener("cqa:view-change", layout);
  new ResizeObserver(layout).observe(deck);
  refresh();
})();
