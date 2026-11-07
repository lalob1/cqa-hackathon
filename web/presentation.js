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
