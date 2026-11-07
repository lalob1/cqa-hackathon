"use strict";

const $ = (id) => document.getElementById(id);
const storageKey = "cqa-workspace-v1";
const roles = {client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система"};
const turnPlural = new Intl.PluralRules("ru");
const svgNamespace = "http://www.w3.org/2000/svg";
const roleArtwork = {
  client: '<circle class="glyph-halo" cx="14" cy="11" r="8" stroke="currentColor" opacity=".26"/><circle class="glyph-head" cx="14" cy="10" r="3.4" fill="currentColor"/><path d="M7 21c.4-4 3.1-6 7-6s6.6 2 7 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  operator: '<path d="M6.7 15v-1.9a7.3 7.3 0 0 1 14.6 0v1.9M21 18v1a3 3 0 0 1-3 3h-3" stroke="currentColor" stroke-width="1.65" stroke-linecap="round"/><g class="glyph-cups" fill="currentColor"><rect x="5.5" y="13.5" width="4.5" height="6.5" rx="1.8"/><rect x="18" y="13.5" width="4.5" height="6.5" rx="1.8"/></g><circle cx="14.5" cy="22" r="1.1" fill="currentColor"/>',
  bot: '<rect x="6" y="8" width="16" height="13" rx="4" stroke="currentColor" stroke-width="1.6"/><path d="M14 5v3m-3 6v1m6-1v1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  system: '<path d="M7 9h14M7 14h14M7 19h9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
};
const answerText = (value) => ({yes: "Да", no: "Нет", na: "N/A"})[value] ?? String(value);
const scoreText = (value) => value === null ? "—" : value.toFixed(2);
let defaults, workspace, selected, historyIndex, busy = false;
let listFilter = "all", statusTimer;
const pendingReviews = new WeakSet();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function speakerBadge(speaker) {
  const badge = node("span", undefined, "role-icon role-" + speaker);
  badge.setAttribute("aria-hidden", "true");
  const icon = document.createElementNS(svgNamespace, "svg");
  icon.setAttribute("viewBox", "0 0 28 28");
  icon.setAttribute("fill", "none");
  icon.innerHTML = roleArtwork[speaker];
  badge.append(icon);
  return badge;
}

function status(message, isError = false) {
  clearTimeout(statusTimer);
  $("status").textContent = message;
  $("status").dataset.error = String(isError);
  if (!isError && !busy) statusTimer = setTimeout(() => { $("status").textContent = ""; }, 7000);
}

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Запрос не выполнен.");
  return json;
}

function persist(message) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(workspace));
    status(message);
  } catch {
    status(message + " Хранилище браузера недоступно или заполнено. Данные есть в текущей вкладке.", true);
  }
}

function setReviewTab(tab) {
  document.body.dataset.reviewTab = tab;
  for (const button of document.querySelectorAll(".review-tabs [data-review-tab]")) {
    button.setAttribute("aria-pressed", String(button.dataset.reviewTab === tab));
  }
}

function showView(view, tab) {
  $("dialogues-view").hidden = view !== "dialogues";
  $("review-view").hidden = view !== "review";
  $("editor").hidden = view !== "checklist";
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll(".app-nav [data-view]")) {
    button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false");
  }
  $("toggle-rubric").setAttribute("aria-expanded", String(view === "checklist"));
  document.querySelector(".import-menu").open = false;
  if (tab) setReviewTab(tab);
  if (view === "dialogues" && workspace) renderList();
  window.scrollTo({top: 0, behavior: "instant"});
}

function openRecord(index) {
  selectRecord(index);
  showView("review", "dialogue");
  $("transcript-title").focus({preventScroll: true});
}

function selectRecord(index) {
  selected = index;
  historyIndex = (workspace.runs[index] || []).length - 1;
  renderList();
  renderTranscript();
  renderResult();
}

async function importPayload(payload, label) {
  if (busy) return;
  const records = await api("/api/import", {payload});
  if (busy) return;
  const existing = new Map(workspace.records.map((record, index) => [record.conversation_id, index]));
  for (const record of records) {
    const index = existing.get(record.conversation_id);
    if (index !== undefined && JSON.stringify(workspace.records[index]) !== JSON.stringify(record)) {
      throw new Error("Этот ID уже загружен с другим содержимым: " + record.conversation_id);
    }
  }
  const additions = records.filter((record) => !existing.has(record.conversation_id));
  const first = existing.get(records[0].conversation_id) ?? workspace.records.length;
  workspace.records.push(...additions);
  $("filter").value = "";
  $("critical-only").checked = false;
  listFilter = "all";
  selectRecord(first);
  showView("dialogues");
  persist(label + " · новых диалогов " + additions.length);
}

function runKey(audit) {
  return JSON.stringify([audit.input_sha256, audit.rubric_sha256, audit.provider, audit.model, audit.prompt, audit.created_at]);
}

async function importResults(payload) {
  if (busy) return;
  const ids = new Set(Array.isArray(payload?.results) ? payload.results.map((row) => row?.conversation_id) : []);
  const records = workspace.records.filter((record) => ids.has(record.conversation_id));
  if (!records.length && ids.size) throw new Error("Сначала загрузите соответствующие диалоги.");
  const checked = await api("/api/import-results", {payload, records});
  if (busy) return;
  const indexes = new Map(workspace.records.map((record, index) => [record.conversation_id, index]));
  let added = 0;
  for (const result of checked.results) {
    const index = indexes.get(result.conversation_id);
    const runs = workspace.runs[index] ??= [];
    if (runs.some((run) => runKey(run.original.audit) === runKey(result.audit))) continue;
    runs.push({original: result, appeals: {}, source: "batch"});
    added += 1;
  }
  $("filter").value = "";
  $("critical-only").checked = false;
  listFilter = "all";
  selectRecord(indexes.get(checked.results[0].conversation_id));
  showView("review", "score");
  persist("Добавлено оценок: " + added + " · ошибок в пакете: " + checked.failed);
}

function handleUpload(id, importFile) {
  const input = $(id);
  input.addEventListener("change", async () => {
    const file = input.files[0];
    try {
      if (file?.size > 7 * 1024 * 1024) throw new Error("Файл должен быть до 7 МБ.");
      if (file) await importFile(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
    } catch (error) { status(error.message, true); }
    input.value = "";
  });
}

function conversationIcon(channel) {
  const icon = node("span", undefined, "record-icon");
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.innerHTML = channel === "voice call"
    ? '<path d="m8 4 3 4-2.5 2.5a12 12 0 0 0 5 5L16 13l4 3-1 4C11 21 3 13 4 5l4-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>'
    : '<path d="M4 5h16v11H9l-5 4V5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 9h8m-8 3h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  icon.append(svg);
  return icon;
}

function renderList() {
  const list = $("conversation-list");
  const search = $("filter").value.toLowerCase().trim();
  let scoredCount = 0;
  let criticalCount = 0;
  list.replaceChildren();
  $("record-count").textContent = workspace.records.length;
  for (const button of document.querySelectorAll("[data-list-filter]")) {
    button.setAttribute("aria-pressed", String(button.dataset.listFilter === listFilter));
  }
  for (const [index, conversation] of workspace.records.entries()) {
    const run = workspace.runs[index]?.at(-1);
    const latest = run?.original;
    const critical = Object.values(latest?.score.flags ?? {}).some(Boolean);
    if (latest) scoredCount += 1;
    if (critical) criticalCount += 1;
    if (!(conversation.conversation_id + " " + conversation.language).toLowerCase().includes(search)) continue;
    if ($("critical-only").checked && !critical) continue;
    if (listFilter === "pending" && latest) continue;
    const button = node("button", undefined, "record");
    button.type = "button";
    button.dataset.recordIndex = String(index);
    const channel = conversation.channel === "voice call" ? "Звонок" : "Чат";
    const copy = node("span", undefined, "record-copy");
    const preview = conversation.transcript.find(turn => turn.speaker === "client")?.text
      ?? conversation.transcript[0]?.text ?? "";
    copy.append(node("span", conversation.conversation_id, "record-title"),
      node("span", preview, "record-preview"),
      node("span", conversation.language + " · " + channel + " · " + conversation.transcript.length + " репл.", "record-meta"));
    const end = node("span", undefined, "record-end" + (critical ? " attention" : ""));
    if (latest) {
      end.append(node("span", scoreText((run.finalScore || latest.score).total), "record-score"),
        node("span", critical ? "Ошибка ИИ" : "Оценён", "record-state" + (critical ? " attention" : "")));
    } else {
      end.append(node("span", undefined, "record-chevron"));
    }
    button.append(conversationIcon(conversation.channel), copy, end);
    button.addEventListener("click", () => openRecord(index));
    list.append(button);
  }
  $("workspace-scored").textContent = scoredCount;
  $("workspace-critical").textContent = criticalCount;
  if (!list.childElementCount) list.append(node("p",
    workspace.records.length ? "Нет диалогов по этому фильтру." : "Загрузите диалоги, чтобы начать проверку.", "empty"));
}

function renderTranscript() {
  const conversation = workspace.records[selected];
  $("turns").replaceChildren();
  $("turn-rail").replaceChildren();
  $("turn-overview").hidden = !conversation?.transcript.length;
  $("evidence-note").hidden = true;
  $("transcript-title").textContent = conversation?.conversation_id ?? "Выберите диалог";
  const count = conversation?.transcript.length ?? 0;
  const turnLabel = {one: "реплика", few: "реплики"}[turnPlural.select(count)] ?? "реплик";
  $("conversation-meta").textContent = conversation ? conversation.language + " · " + count + " " + turnLabel : "";
  $("audio").hidden = !conversation?.audio_url;
  if (!conversation) return;
  if (conversation.audio_url) $("audio").href = conversation.audio_url;
  else $("audio").removeAttribute("href");
  for (const [index, turn] of conversation.transcript.entries()) {
    const item = node("li", undefined, "turn " + turn.speaker);
    item.id = "message-" + (index + 1);
    item.tabIndex = -1;
    const meta = node("div", undefined, "turn-meta");
    meta.append(node("span", roles[turn.speaker], "speaker"), node("small", turn.timestamp), node("small", "#" + (index + 1), "turn-index"));
    const content = node("div", undefined, "turn-content");
    content.append(meta, node("p", turn.text));
    item.append(speakerBadge(turn.speaker), content);
    $("turns").append(item);
    $("turn-rail").append(node("span", undefined, turn.speaker));
  }
}

function showEvidence(span) {
  showView("review", "dialogue");
  const rail = $("turn-rail").children;
  for (const [index, turn] of Array.from($("turns").children).entries()) {
    const marked = index + 1 >= span.start && index + 1 <= span.end;
    turn.classList.toggle("marked", marked);
    rail[index].classList.toggle("marked", marked);
    if (marked) {
      const delay = Math.min(index + 1 - span.start, 5) * 55;
      rail[index].animate([{transform: "scaleY(.65)", opacity: .55}, {transform: "scaleY(1.6)"}, {transform: "scaleY(1)", opacity: 1}],
        {duration: 430, delay, easing: "ease-out"});
      turn.animate([{backgroundColor: "#fffbef"}, {backgroundColor: "#ffe0a4", offset: .35}, {backgroundColor: "#fff4d8"}],
        {duration: 710, delay, easing: "ease-out"});
    }
  }
  $("evidence-note").textContent = span.start === span.end
    ? "Выделена реплика #" + span.start
    : "Выделены реплики #" + span.start + "–" + span.end;
  $("evidence-note").hidden = false;
  const target = $("message-" + span.start);
  target.focus({preventScroll: true});
  target.scrollIntoView({block: "nearest", behavior: "smooth"});
}

function scoreMeter(value) {
  const ring = document.createElementNS(svgNamespace, "svg");
  ring.setAttribute("viewBox", "0 0 44 44");
  ring.setAttribute("aria-hidden", "true");
  ring.classList.add("score-meter");
  for (const className of ["meter-track", "meter-value"]) {
    const circle = document.createElementNS(svgNamespace, "circle");
    circle.setAttribute("cx", "22");
    circle.setAttribute("cy", "22");
    circle.setAttribute("r", "17");
    circle.setAttribute("pathLength", "100");
    circle.classList.add(className);
    if (className === "meter-value") {
      circle.setAttribute("stroke-dasharray", "100 100");
      circle.setAttribute("stroke-dashoffset", String(100 - (value ?? 0)));
    }
    ring.append(circle);
  }
  return ring;
}

function reviewForm(run, item, prior, current) {
  const form = node("form", undefined, "review");
  const reason = node("textarea");
  reason.required = true;
  reason.maxLength = 1000;
  const reasonLabel = node("label", prior ? "Причина решения" : "Комментарий к апелляции");
  reasonLabel.append(reason);
  let answer;
  if (prior) {
    answer = node("select");
    for (const value of answersFor(item)) {
      const option = node("option", answerText(value));
      option.value = JSON.stringify(value);
      option.selected = value === current;
      answer.append(option);
    }
    const answerLabel = node("label", "Решение проверяющего");
    answerLabel.append(answer);
    form.append(answerLabel);
  }
  const button = node("button", prior ? "Сохранить решение" : "Подать апелляцию", "secondary");
  form.append(reasonLabel, button);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = reason.value.trim();
    if (!message) return status("Добавьте комментарий.", true);
    if (!prior) {
      run.appeals[item.id] = {message, opened_at: new Date().toISOString()};
      persist("Апелляция сохранена.");
      renderResult(item.id);
      return;
    }
    if (pendingReviews.has(run)) return;
    pendingReviews.add(run);
    button.disabled = true;
    const next = JSON.parse(answer.value);
    const answers = Object.fromEntries(run.original.rubric.map(({id}) => [
      id, run.appeals[id]?.decision?.answer ?? run.original.judgments[id].answer
    ]));
    answers[item.id] = next;
    try {
      const score = await api("/api/recalculate", {rubric: run.original.rubric, answers});
      prior.decision = {answer: next, reason: message, decided_at: new Date().toISOString()};
      run.finalScore = score;
      pendingReviews.delete(run);
      persist("Решение сохранено. Итог пересчитан.");
      renderResult(item.id);
    } catch (error) {
      status(error.message, true);
    } finally {
      pendingReviews.delete(run);
      button.disabled = false;
    }
  });
  return form;
}

function renderCriterion(run, item, finalScore, opened) {
  const original = run.original.judgments[item.id];
  const appeal = run.appeals[item.id];
  const current = appeal?.decision?.answer ?? original.answer;
  const row = node("details", undefined, "criterion");
  row.open = opened;
  const summary = node("summary");
  const tone = item.type === "flag" ? (current === "yes" ? "fail" : "skip")
    : {yes: "pass", no: "fail", na: "skip"}[current] ?? "number";
  summary.append(node("span", item.title, "criterion-title"), node("span", answerText(current), "answer " + tone));
  row.append(summary);
  const points = finalScore.criteria[item.id];
  const weight = item.type === "flag" ? "Отдельный флаг" :
    "Вес " + item.weight + " · начислено " + scoreText(points.points) + " из " + scoreText(points.effective_weight);
  row.append(node("p", weight, "meta"), node("p", original.reason));
  if (appeal?.decision) row.append(node("p", "Исходная оценка ИИ: " + answerText(original.answer), "meta"));
  for (const span of original.evidence) {
    const link = node("a", "#" + span.start + (span.end === span.start ? "" : "–" + span.end), "evidence");
    link.href = "#message-" + span.start;
    link.addEventListener("click", (event) => { event.preventDefault(); showEvidence(span); });
    row.append(link);
  }
  if (appeal) row.append(node("p", "Апелляция: " + appeal.message));
  if (appeal?.decision) {
    row.append(node("p", "Решение: " + answerText(current) + " · " + appeal.decision.reason));
  } else {
    const panel = node("details", undefined, "appeal-panel");
    panel.open = Boolean(appeal);
    panel.append(node("summary", appeal ? "Рассмотреть апелляцию" : "Оспорить оценку"),
      reviewForm(run, item, appeal, current));
    row.append(panel);
  }
  return row;
}

function renderResult(openCriterion, reveal = false) {
  const runs = workspace.runs[selected] || [];
  const run = runs[historyIndex];
  $("score").disabled = busy || !workspace.records[selected];
  $("score").textContent = busy ? "Оценка выполняется…" : "Оценить диалог";
  $("score").classList.toggle("is-scoring", busy);
  $("history-label").hidden = runs.length < 2;
  $("history").replaceChildren();
  for (const [index, entry] of runs.entries()) {
    const time = new Date(entry.original.audit.created_at).toLocaleTimeString("ru");
    const option = node("option", String(index + 1) + " · " + time);
    option.value = index;
    option.selected = index === historyIndex;
    $("history").append(option);
  }
  const pane = $("results");
  pane.replaceChildren();
  if (!run) {
    const empty = node("div", undefined, "empty-result");
    empty.append(node("p", "Оцените диалог по текущему чек-листу."));
    pane.append(empty);
    return;
  }
  const original = run.original;
  const final = run.finalScore || original.score;
  const totals = node("div", undefined, "totals");
  const total = node("div", undefined, "final-total");
  const value = node("div", undefined, "total-value");
  value.append(node("strong", scoreText(final.total)), node("small", " / 100"));
  total.append(node("span", "Итоговая оценка", "total-label"), value);
  const initial = node("p", undefined, "original-total");
  initial.append(node("span", "Исходная оценка ИИ"), node("strong", scoreText(original.score.total)));
  const meter = scoreMeter(final.total);
  totals.append(total, meter, initial);
  pane.append(totals);
  if (reveal) {
    totals.animate([{opacity: .65, transform: "translateY(5px)"}, {opacity: 1, transform: "translateY(0)"}],
      {duration: 240, easing: "ease-out"});
    meter.querySelector(".meter-value").animate([{strokeDashoffset: "100"}, {strokeDashoffset: String(100 - (final.total ?? 0))}],
      {duration: 720, easing: "cubic-bezier(.2,.75,.3,1)"});
  }
  const flags = Object.entries(final.flags).filter(([, value]) => value).map(([id]) => original.rubric.find((item) => item.id === id).title);
  if (flags.length) pane.append(node("p", flags.join(" · "), "flag"));
  for (const item of original.rubric) pane.append(renderCriterion(run, item, final, openCriterion === item.id));
  const info = node("details", undefined, "run-info");
  info.append(node("summary", "О запуске"));
  const sections = node("ul", undefined, "section-list");
  for (const [name, row] of Object.entries(final.sections)) sections.append(node("li", name + " · " + scoreText(row.points) + " / " + scoreText(row.max)));
  if (sections.childElementCount) info.append(sections);
  const source = run.source === "batch" ? "Импорт из CLI" : "Запуск в приложении";
  info.append(node("p", source + " · " + original.audit.model + " · чек-лист " + original.audit.rubric_sha256.slice(0, 8) + " · вход " + original.audit.input_sha256.slice(0, 8), "meta"));
  pane.append(info);
}

function answersFor(item) {
  const choices = item.type === "scale" ? item.levels.map((level) => level.value) : ["yes", "no"];
  return item.na ? [...choices, "na"] : choices;
}

function editField(label, name, kind, value, wide = false) {
  const row = node("label", label, wide ? "wide" : undefined);
  const control = node(kind === "textarea" || kind === "select" ? kind : "input");
  control.name = name;
  if (kind === "select") {
    for (const [key, title] of [["binary", "Да / Нет"], ["scale", "Шкала"], ["flag", "Флаг"]]) {
      const option = node("option", title);
      option.value = key;
      control.append(option);
    }
  } else if (kind !== "textarea") control.type = kind;
  control.value = value ?? "";
  row.append(control);
  return row;
}

function addEditor(item, open = false) {
  const card = node("details", undefined, "editor-item");
  card.open = open;
  const fields = node("div", undefined, "fields");
  const levels = (item.levels || []).map(({value, anchor}) => value + " | " + anchor).join("\n");
  fields.append(
    editField("ID", "id", "text", item.id),
    editField("Название", "title", "text", item.title),
    editField("Секция", "section", "text", item.section),
    editField("Вес", "weight", "number", item.weight),
    editField("Тип", "type", "select", item.type),
    editField("Правило оценки", "rule", "textarea", item.rule, true),
    editField("Условие N/A (пусто = отключено)", "na", "textarea", item.na, true),
    editField("Ступени шкалы (по одной строке: 0 | описание)", "levels", "textarea", levels, true)
  );
  const type = fields.querySelector("[name=type]");
  const weight = fields.querySelector("[name=weight]");
  const na = fields.querySelector("[name=na]");
  const levelField = fields.querySelector("[name=levels]");
  const update = () => {
    levelField.closest("label").hidden = type.value !== "scale";
    na.closest("label").hidden = type.value === "flag";
    weight.disabled = type.value === "flag";
  };
  type.addEventListener("change", update);
  update();
  const remove = node("button", "Удалить критерий", "secondary");
  remove.type = "button";
  remove.addEventListener("click", () => card.remove());
  fields.append(remove);
  card.append(node("summary", item.title || "Новый критерий"), fields);
  $("criteria-editor").append(card);
}

function fillEditor(rubric) {
  $("criteria-editor").replaceChildren();
  for (const item of rubric) addEditor(item);
}

function readEditor() {
  return [...$("criteria-editor").children].map((card) => {
    const field = (name) => card.querySelector("[name=" + name + "]").value.trim();
    const type = field("type");
    const weight = field("weight");
    const result = {id: field("id"), title: field("title"), section: field("section"), type,
      weight: type === "flag" ? 0 : (weight ? Number(weight) : null), rule: field("rule"),
      na: type === "flag" ? null : (field("na") || null)};
    if (type === "scale") {
      result.levels = field("levels").split("\n").filter((line) => line.trim()).map((line) => {
        const [number, ...anchor] = line.split("|");
        return {value: number.trim() ? Number(number) : null, anchor: anchor.join("|").trim()};
      });
    }
    return result;
  });
}

async function boot() {
  const config = await api("/api/config");
  defaults = config.rubric;
  $("model").textContent = config.model;
  try { workspace = JSON.parse(localStorage.getItem(storageKey)); } catch { workspace = null; }
  workspace ??= {rubric: defaults, records: [], runs: {}};
  fillEditor(workspace.rubric);
  selectRecord(0);
  if (!workspace.records.length) await importPayload(await api("/synthetic.json"), "Синтетические примеры загружены");
  $("filter").addEventListener("input", renderList);
  $("critical-only").addEventListener("change", () => {
    listFilter = $("critical-only").checked ? "critical" : "all";
    renderList();
  });
  for (const button of document.querySelectorAll("[data-list-filter]")) {
    button.addEventListener("click", () => {
      listFilter = button.dataset.listFilter;
      $("critical-only").checked = false;
      renderList();
    });
  }
  for (const button of document.querySelectorAll(".app-nav [data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view,
      button.dataset.view === "review" ? "score" : undefined));
  }
  for (const button of document.querySelectorAll(".review-tabs [data-review-tab]")) {
    button.addEventListener("click", () => setReviewTab(button.dataset.reviewTab));
  }
  $("back-to-list").addEventListener("click", () => {
    showView("dialogues");
    document.querySelector('[data-record-index="' + selected + '"]')?.focus({preventScroll: true});
  });
  document.addEventListener("click", event => {
    const menu = document.querySelector(".import-menu");
    if (!menu.contains(event.target)) menu.open = false;
  });
  $("history").addEventListener("change", () => { historyIndex = Number($("history").value); renderResult(); });
  handleUpload("upload", (payload) => importPayload(payload, "Данные загружены"));
  handleUpload("upload-results", importResults);
  $("demo").addEventListener("click", async () => {
    try { await importPayload(await api("/synthetic.json"), "Синтетические примеры загружены"); }
    catch (error) { status(error.message, true); }
  });
  $("add").addEventListener("click", () => addEditor({type: "binary", weight: 5}, true));
  $("reset-rubric").addEventListener("click", () => {
    fillEditor(defaults);
    status("Исходный чек-лист открыт для редактирования. Нажмите «Сохранить чек-лист» для применения.");
  });
  $("export-rubric").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(workspace.rubric, null, 2)], {type: "application/json"}));
    const link = node("a");
    link.href = url;
    link.download = "cqa-rubric.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("rubric-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      workspace.rubric = await api("/api/rubric", {rubric: readEditor()});
      persist("Чек-лист сохранён для новых запусков.");
    } catch (error) { status(error.message, true); }
  });
  $("score").addEventListener("click", async () => {
    if (busy || !workspace.records[selected]) return;
    const index = selected;
    busy = true;
    $("upload").disabled = $("upload-results").disabled = $("demo").disabled = true;
    renderResult();
    status("Локальная модель анализирует диалог…");
    let reveal = false;
    try {
      const result = await api("/api/score", {conversation: workspace.records[index], rubric: workspace.rubric});
      const runs = workspace.runs[index] ??= [];
      runs.push({original: result, appeals: {}});
      if (index === selected) historyIndex = runs.length - 1;
      reveal = index === selected;
      persist("Оценка сохранена.");
    } catch (error) { status(error.message, true); }
    finally {
      busy = false;
      $("upload").disabled = $("upload-results").disabled = $("demo").disabled = false;
      renderList();
      renderResult(undefined, reveal);
    }
  });
}

boot().catch((error) => status(error.message, true));
