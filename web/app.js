"use strict";

const $ = (id) => document.getElementById(id);
const storageKey = "cqa-workspace-v1";
const roles = {client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система"};
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
let historySupported = false, syncing = false, statusTimer;
const pendingReviews = new Set();

async function allSummaries() {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await api(`/api/runs?latest=false&limit=500&offset=${offset}`);
    rows.push(...page.results);
    if (page.results.length < 500 || rows.length >= page.total) return rows;
  }
}

function sameConversation(a, b) {
  return a.language === b.language && a.channel === b.channel && a.audio_url === b.audio_url
    && a.transcript.length === b.transcript.length
    && a.transcript.every((turn, i) => {
      const other = b.transcript[i];
      return turn.timestamp === other.timestamp && turn.speaker === other.speaker && turn.text === other.text;
    });
}

function replaceRun(run, target = workspace) {
  let index = target.records.findIndex(c => c.conversation_id === run.conversation.conversation_id);
  if (index < 0) {
    index = target.records.length;
    target.records.push(run.conversation);
  } else if (!sameConversation(target.records[index], run.conversation)) {
    throw new Error("Сохранённый запуск содержит другой диалог с ID " + run.conversation.conversation_id + ".");
  }
  const runs = target.runs[index] ??= [];
  const prior = runs.findIndex(entry => entry.run_id === run.run_id);
  if (prior < 0) runs.push(run);
  else if (runs[prior].revision <= run.revision) runs[prior] = run;
  return index;
}

async function restoreServerHistory() {
  const summaries = (await allSummaries()).reverse();
  const loaded = [];
  for (let offset = 0; offset < summaries.length; offset += 6) {
    const batch = summaries.slice(offset, offset + 6);
    loaded.push(...await Promise.all(batch.map(row => api("/api/runs/" + row.run_id))));
  }
  // Build a complete snapshot before replacing history. A failed fetch or
  // conflicting dialogue leaves the existing browser data usable.
  const snapshot = {
    records: [...workspace.records],
    runs: Object.fromEntries(Object.entries(workspace.runs).map(([index, runs]) =>
      [index, runs.filter(run => !run.run_id)]))
  };
  for (const run of loaded) replaceRun(run, snapshot);
  workspace.records = snapshot.records;
  workspace.runs = snapshot.runs;
}

function finalScoreFor(run) {
  return run.final_score ?? run.finalScore ?? run.original.score;
}

function criterionAppeals(run, id) {
  if (Array.isArray(run.appeals)) return run.appeals.filter(a => a.criterion_id === id);
  return run.appeals?.[id] ? [run.appeals[id]] : [];
}

function draftKey(run, id, prior) { return [run.run_id, id, prior?.appeal_id || 'new'].join(':'); }
function cacheWorkspace() {
  try { localStorage.setItem(storageKey, JSON.stringify(workspace)); } catch { /* persist reports storage failures */ }
}

function renderImportErrors() {
  const errors = $("import-errors");
  errors.replaceChildren();
  errors.hidden = !workspace.importErrors?.length;
  if (errors.hidden) return;
  const details = node("details");
  const list = node("ul");
  for (const error of workspace.importErrors) {
    const entry = node("li");
    entry.append(node("strong", error.conversation_id), node("p", error.error));
    list.append(entry);
  }
  details.append(node("summary", "Ошибки импорта · " + workspace.importErrors.length), list);
  errors.append(details);
}

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

function status(message, isError = false, keep = false) {
  clearTimeout(statusTimer);
  $("status").textContent = message;
  $("status").dataset.error = String(isError);
  if (!isError && !keep) statusTimer = setTimeout(() => { $("status").textContent = ""; }, 7000);
}

async function api(path, body) {
  const options = body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)
  };
  const response = await fetch(path, options);
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(json?.error || "Запрос не выполнен (HTTP " + response.status + ").");
    error.status = response.status;
    throw error;
  }
  if (json === null) throw new Error("Сервер вернул ответ в неожиданном формате.");
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
  $("start-view").hidden = view !== "start";
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
  document.dispatchEvent(new Event("cqa:view-change"));
}

function openRecord(index) {
  selectRecord(index);
  const run = workspace.runs[index]?.[historyIndex];
  const filter = $("list-filter").value;
  let criterion;
  if (run && filter === "appeal") {
    criterion = run.original.rubric.find(item => criterionAppeals(run, item.id)
      .some(appeal => appeal.status === "open"))?.id;
  } else if (run && (filter === "critical" || filter === "final-critical")) {
    const score = filter === "critical" ? run.original.score : finalScoreFor(run);
    criterion = Object.keys(score.flags).find(id => score.flags[id]);
  } else if (run && filter === "needs-review") {
    criterion = Object.keys(run.original.criterion_errors)[0];
  }
  showView("review", criterion ? "score" : "dialogue");
  if (criterion) {
    renderResult(criterion);
    $("score-title").focus({preventScroll: true});
  } else {
    $("transcript-title").focus({preventScroll: true});
  }
}

function selectRecord(index) {
  selected = index;
  historyIndex = (workspace.runs[index] || []).length - 1;
  renderList();
  renderTranscript();
  renderResult();
}

async function importPayload(payload, label, openView = true) {
  if (busy || syncing) return;
  const records = await api("/api/import", {payload});
  if (busy || syncing) return;
  const existing = new Map(workspace.records.map((record, index) => [record.conversation_id, index]));
  for (const record of records) {
    const index = existing.get(record.conversation_id);
    if (index !== undefined && !sameConversation(workspace.records[index], record)) {
      throw new Error("Этот ID уже загружен с другим содержимым: " + record.conversation_id);
    }
  }
  const additions = records.filter((record) => !existing.has(record.conversation_id));
  const first = existing.get(records[0].conversation_id) ?? workspace.records.length;
  workspace.records.push(...additions);
  $("filter").value = "";
  $("list-filter").value = "all";
  selectRecord(first);
  if (openView) {
    showView("dialogues");
    persist(label + " · новых диалогов " + additions.length);
  } else cacheWorkspace();
}

async function importResults(payload) {
  if (busy || syncing || pendingReviews.size) return;
  const known = new Set(Object.values(workspace.runs).flat().map(run => run.run_id));
  const ids = new Set([payload?.results, payload?.errors].flatMap(rows =>
    Array.isArray(rows) ? rows.map(row => row?.conversation_id) : []));
  const records = workspace.records.filter(record => ids.has(record.conversation_id));
  if (!records.length && ids.size) throw new Error("Сначала загрузите диалоги для этого файла оценок.");
  syncing = true;
  try {
    const checked = await api("/api/import-results", {payload, records: ids.size ? records : workspace.records});
    workspace.importErrors = checked.errors;
    renderImportErrors();
    cacheWorkspace();
    if (checked.run_ids.length) {
      try { await restoreServerHistory(); }
      catch (error) {
        throw new Error("Оценки сохранены. Не удалось обновить историю: " + error.message + " Повторите обновление через меню ⋯.");
      }
    }
    selectRecord(selected);
    const incomplete = checked.results.filter(run => run.status === "needs_review").length;
    persist("Оценок в файле: " + checked.results.length + " · требуют проверки: " + incomplete + " · новых: "
      + checked.run_ids.filter(id => !known.has(id)).length + " · ошибок: " + checked.errors.length);
    showView("dialogues");
  } finally {
    syncing = false;
    renderResult();
  }
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
  const filter = $("list-filter").value;
  list.replaceChildren();
  for (const [index, conversation] of workspace.records.entries()) {
    const run = workspace.runs[index]?.at(-1);
    if (!(conversation.conversation_id + " " + conversation.language).toLowerCase().includes(search)) continue;
    const final = run && finalScoreFor(run);
    const incomplete = run?.original.status === "needs_review";
    const originalCritical = run && Object.values(run.original.score.flags).some(Boolean);
    const finalCritical = final && Object.values(final.flags).some(Boolean);
    const openAppeals = run ? run.original.rubric.reduce((count, item) => count
      + criterionAppeals(run, item.id).filter(appeal => appeal.status === "open").length, 0) : 0;
    if (filter === "critical" && !originalCritical) continue;
    if (filter === "final-critical" && !finalCritical) continue;
    if (filter === "appeal" && !openAppeals) continue;
    if (filter === "pending" && run) continue;
    if (filter === "needs-review" && !incomplete) continue;
    const button = node("button", undefined, "record paper-record");
    button.type = "button";
    button.dataset.recordIndex = String(index);
    const copy = node("span", undefined, "record-copy");
    const preview = conversation.transcript.find(turn => turn.speaker === "client")?.text
      ?? conversation.transcript[0]?.text ?? "";
    copy.append(node("span", conversation.conversation_id, "record-title"),
      node("span", preview, "record-preview"),
      node("span", conversation.language, "record-meta"));
    const end = node("span", undefined, "record-end");
    if (run) {
      if (!incomplete) end.append(node("span", scoreText(final.total), "record-score"));
      const flags = node("span", undefined, "record-flags");
      if (incomplete) flags.append(node("span", "Требуется проверка", "record-state"));
      if (finalCritical) flags.append(node("span", originalCritical ? "Грубая ошибка ИИ" : "Ошибка после пересмотра", "record-state attention"));
      else if (originalCritical) flags.append(node("span", "Флаг ИИ снят", "record-state"));
      if (openAppeals) flags.append(node("span", "Апелляций: " + openAppeals, "record-state appeal-state"));
      if (flags.childElementCount) copy.append(flags);
    } else {
      end.append(node("span", undefined, "record-chevron"));
    }
    const paper = node("span", undefined, "paper-lines");
    paper.setAttribute("aria-hidden", "true");
    for (let line = 0; line < 3; line++) paper.append(node("i"));
    button.append(conversationIcon(conversation.channel), paper, copy, end);
    button.addEventListener("click", () => openRecord(index));
    list.append(button);
  }
  if (!list.childElementCount) list.append(node("p",
    workspace.records.length ? "Нет диалогов по этому фильтру." : "Загрузите диалоги, чтобы начать проверку.", "empty"));
  document.dispatchEvent(new Event("cqa:records-change"));
}

function renderTranscript() {
  const conversation = workspace.records[selected];
  $("turns").replaceChildren();
  $("turn-rail").replaceChildren();
  $("turn-overview").hidden = !conversation?.transcript.length;
  $("evidence-note").hidden = true;
  $("transcript-title").textContent = conversation?.conversation_id ?? "Выберите диалог";
  $("conversation-meta").textContent = conversation?.language ?? "";
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
  reason.required = true; reason.maxLength = 1000;
  reason.setAttribute('aria-label', prior ? 'Причина решения' : 'Комментарий к апелляции');
  const key = draftKey(run, item.id, prior);
  workspace.drafts ??= {};
  const draft = workspace.drafts[key] ??= {reason: '', answer: current};
  reason.value = draft.reason;
  reason.addEventListener('input', () => { draft.reason = reason.value; cacheWorkspace(); });
  const reasonLabel = node("label", prior ? "Причина решения" : "Комментарий к апелляции");
  reasonLabel.append(reason);
  let answer;
  if (prior) {
    answer = node("select");
    answer.setAttribute('aria-label', 'Решение проверяющего');
    for (const value of answersFor(item)) {
      const option = node("option", answerText(value)); option.value = JSON.stringify(value);
      option.selected = value === draft.answer; answer.append(option);
    }
    answer.addEventListener('change', () => { draft.answer = JSON.parse(answer.value); cacheWorkspace(); });
    const answerLabel = node("label", "Решение проверяющего"); answerLabel.append(answer); form.append(answerLabel);
  }
  const button = node("button", prior ? "Сохранить решение" : "Подать апелляцию", "primary");
  form.append(reasonLabel, button);
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const message = reason.value.trim();
    if (!message) return status("Добавьте комментарий.", true);
    if (syncing || pendingReviews.has(run.run_id)) return;
    pendingReviews.add(run.run_id); button.disabled = true;
    try {
      const body = prior
        ? {run_id: run.run_id, appeal_id: prior.appeal_id, answer: JSON.parse(answer.value), reason: message, expected_revision: run.revision}
        : {run_id: run.run_id, criterion_id: item.id, message, expected_revision: run.revision};
      const updated = await api(prior ? '/api/reviews' : '/api/appeals', body);
      replaceRun(updated); delete workspace.drafts[key];
      const conflict = workspace.conflictDrafts?.[run.run_id];
      if (conflict?.criterion_id === item.id && conflict.message === message) delete workspace.conflictDrafts[run.run_id];
      persist(prior ? "Решение сохранено на сервере. Итог пересчитан." : "Апелляция сохранена на сервере.");
      renderList();
      if (workspace.runs[selected]?.[historyIndex]?.run_id === run.run_id) renderResult(item.id);
    } catch (error) {
      if (error.status === 409) {
        workspace.conflictDrafts ??= {};
        workspace.conflictDrafts[run.run_id] = {criterion_id: item.id, message, answer: prior ? JSON.parse(answer.value) : null};
        cacheWorkspace();
        try {
          replaceRun(await api("/api/runs/" + run.run_id));
          cacheWorkspace();
          renderList();
          if (workspace.runs[selected]?.[historyIndex]?.run_id === run.run_id) renderResult(item.id);
        }
        catch (refreshError) { status(refreshError.message, true); return; }
        status("Запуск изменён в другой вкладке. Данные обновлены, черновик сохранён. Сверьте решение перед повторным сохранением.", true);
      } else status(error.message, true);
    } finally { pendingReviews.delete(run.run_id); button.disabled = false; }
  });
  return form;
}

function renderCriterion(run, item, finalScore, opened) {
  const original = run.original.judgments[item.id];
  const row = node("details", undefined, "criterion");
  row.open = opened;
  row.dataset.criterionId = item.id;
  const summary = node("summary");
  const detail = node("div", undefined, "criterion-body");
  row.append(summary, detail);
  summary.append(node("span", item.title, "criterion-title"));
  if (!original) {
    summary.append(node("span", "Требуется проверка", "answer skip"));
    const validation = node("details");
    validation.append(node("summary", "Подробности проверки"), node("p", run.original.criterion_errors[item.id], "meta"));
    detail.append(node("p", "По этому критерию модель не вернула ответ, прошедший проверку."), validation);
    return row;
  }
  const appeals = criterionAppeals(run, item.id);
  const appeal = appeals.findLast(a => a.status === 'open');
  const current = run.final_answers?.[item.id] ?? appeals.at(-1)?.decision?.answer ?? original.answer;
  const tone = item.type === "flag" ? (current === "yes" ? "fail" : "skip")
    : {yes: "pass", no: "fail", na: "skip"}[current] ?? "number";
  if (appeal) summary.append(node("span", "Апелляция", "criterion-appeal"));
  summary.append(node("span", answerText(current), "answer " + tone));
  const points = finalScore.criteria[item.id];
  const weight = item.type === "flag" ? "Отдельный флаг" : "Вес " + item.weight
    + (points ? " · начислено " + scoreText(points.points) + " из " + scoreText(points.effective_weight) : "");
  detail.append(node("p", weight, "meta"), node("p", original.reason, "criterion-reason"));
  detail.append(node("p", "Ответ ИИ: " + answerText(original.answer), "meta"));
  const evidence = node("div", undefined, "evidence-links");
  evidence.setAttribute("role", "group");
  evidence.setAttribute("aria-label", "Реплики исходной оценки ИИ");
  for (const span of original.evidence) {
    const link = node("a", "#" + span.start + (span.end === span.start ? "" : "–" + span.end), "evidence");
    link.href = "#message-" + span.start;
    link.addEventListener("click", (event) => { event.preventDefault(); showEvidence(span); });
    evidence.append(link);
  }
  detail.append(evidence);
  if (appeals.length) {
    const history = node("div", undefined, "appeal-history");
    history.append(node("h4", "История апелляций"));
    for (const entry of appeals) {
      history.append(node("p", entry.message));
      if (entry.decision) history.append(node("p", "Решение: " + answerText(entry.decision.answer) + " · " + entry.decision.reason, "meta"));
      else history.append(node("p", "Открыта", "meta"));
    }
    detail.append(history);
  }
  if (run.run_id && historySupported) {
    const panel = node('details', undefined, 'appeal-panel'); panel.open = Boolean(appeal);
    panel.append(node('summary', appeal ? 'Рассмотреть апелляцию' : (appeals.length ? 'Подать новую апелляцию' : 'Оспорить оценку')),
      reviewForm(run, item, appeal, current)); detail.append(panel);
  }
  return row;
}

function renderResult(openCriterion, reveal = false) {
  const runs = workspace.runs[selected] || [];
  const run = runs[historyIndex];
  $("score").disabled = !historySupported || busy || syncing || !workspace.records[selected];
  $("score").textContent = busy ? "Оценка выполняется…" : run ? "Новая оценка" : "Оценить диалог";
  $("score").classList.toggle("is-scoring", busy);
  $("history-label").hidden = runs.length < 2;
  $("history").replaceChildren();
  for (const [index, entry] of runs.entries()) {
    const time = new Date(entry.original.audit.created_at).toLocaleString("ru", {dateStyle: "short", timeStyle: "short"});
    const outcome = entry.original.status === "needs_review" ? "требуется проверка" : scoreText(finalScoreFor(entry).total);
    const option = node("option", time + " · " + outcome + (entry.run_id ? "" : " · локально"));
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
  const final = finalScoreFor(run);
  const conflict = workspace.conflictDrafts?.[run.run_id];
  if (conflict) {
    const draft = node('aside', undefined, 'conflict-draft');
    draft.append(node('strong', 'Неотправленный черновик после конфликта · ' + conflict.criterion_id),
      node('p', (conflict.answer === null ? '' : answerText(conflict.answer) + ' · ') + conflict.message));
    const dismiss = node('button', 'Закрыть черновик', 'secondary');
    dismiss.addEventListener('click', () => { delete workspace.conflictDrafts[run.run_id]; cacheWorkspace(); draft.remove(); });
    draft.append(dismiss); pane.append(draft);
  }
  if (original.status === "needs_review") {
    const notice = node("div", undefined, "empty-result");
    notice.append(node("strong", "Требуется проверка"),
      node("p", "Итоговый балл недоступен. Ниже показаны ответы, прошедшие проверку, и критерии, которые требуют внимания."));
    pane.append(notice);
  } else {
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
  }
  const flags = Object.entries(final.flags).filter(([, value]) => value).map(([id]) => original.rubric.find((item) => item.id === id).title);
  if (flags.length) pane.append(node("p", flags.join(" · "), "flag"));
  for (const item of original.rubric) pane.append(renderCriterion(run, item, final, openCriterion === item.id));
  const info = node("details", undefined, "run-info");
  info.append(node("summary", "О запуске"));
  const sections = node("ul", undefined, "section-list");
  for (const [name, row] of Object.entries(final.sections)) sections.append(node("li", name + " · " + scoreText(row.points) + " / " + scoreText(row.max)));
  if (sections.childElementCount) info.append(sections);
  const source = run.run_id ? "Сохранено на сервере · ревизия " + run.revision : "Локальная история браузера";
  info.append(node("p", source + " · " + original.audit.model + " · чек-лист " + original.audit.rubric_sha256.slice(0, 8) + " · вход " + original.audit.input_sha256.slice(0, 8), "meta"));
  const settings = original.audit.settings;
  info.append(node('p', 'Промпт: ' + original.audit.prompt + ' · ' + original.audit.provider
    + ' · попыток: ' + (original.audit.attempts ?? '—')
    + (settings ? ' · рассуждение: ' + (typeof settings.thinking !== 'boolean' ? 'не указано'
      : settings.thinking ? (original.audit.reasoning_observed ? 'подтверждено ответом' : 'запрошено') : 'выключено')
      : ' · прежний запуск без снимка настроек'), 'meta'));
  if (original.audit.repair_criteria?.length) info.append(node('p', 'Повторно проверены критерии: ' + original.audit.repair_criteria.join(', '), 'meta'));
  pane.append(info);
  if (!run.run_id && historySupported) {
    const conversation = workspace.records[selected];
    const migrate = node('button', 'Сохранить запуск на сервере', 'primary');
    migrate.addEventListener('click', async () => {
      if (syncing || busy || pendingReviews.size) return;
      syncing = true;
      migrate.disabled = true;
      try {
        const imported = await api('/api/import-results', {records: [conversation], payload: {results: [original], errors: []}});
        let restored = await api('/api/runs/' + imported.run_ids[0]);
        // Keep the exact local snapshot, including its original client timestamps.
        workspace.legacyBackup ??= []; workspace.legacyBackup.push(JSON.parse(JSON.stringify(run))); cacheWorkspace();
        for (const [id, old] of Object.entries(run.appeals || {})) {
          const pending = restored.appeals.find(a => a.criterion_id === id && a.status === 'open');
          const prior = restored.appeals.find(a => a.criterion_id === id && a.message === old.message);
          if (pending && pending.message !== old.message) throw new Error('По критерию уже есть другая серверная апелляция. Сверьте историю перед переносом.');
          if (prior?.decision && old.decision && prior.decision.answer !== old.decision.answer) throw new Error('Решение в серверной истории отличается от браузерного. Оба варианта сохранены для сверки.');
          if (prior && !pending) continue;
          if (!pending) restored = await api('/api/appeals', {run_id: restored.run_id, criterion_id: id, message: old.message, expected_revision: restored.revision});
          if (old.decision) {
            const appeal = restored.appeals.find(a => a.criterion_id === id && a.status === 'open');
            restored = await api('/api/reviews', {run_id: restored.run_id, appeal_id: appeal.appeal_id,
              answer: old.decision.answer, reason: old.decision.reason, reviewer: 'Импорт истории браузера', expected_revision: restored.revision});
          }
        }
        await restoreServerHistory();
        const index = workspace.records.indexOf(conversation);
        const runs = workspace.runs[index];
        const position = runs.indexOf(run);
        if (position >= 0) runs.splice(position, 1);
        selectRecord(selected);
        if (index === selected) historyIndex = runs.findIndex(entry => entry.run_id === restored.run_id);
        persist('История перенесена на сервер. Исходные даты браузера сохранены в резервной копии.');
      } catch (error) { status(error.message, true); }
      finally {
        syncing = false;
        migrate.disabled = false;
        renderResult();
      }
    });
    pane.append(migrate);
  }
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
  historySupported = Boolean(config.features?.includes("run_history"));
  $("model").textContent = config.model;
  $("model-badge").title = "Настроенная модель: " + config.model + " · доступность не проверена";
  $("refresh-runs").disabled = $("upload-results").disabled = !historySupported;
  try { workspace = JSON.parse(localStorage.getItem(storageKey)); } catch { workspace = null; }
  workspace ??= {rubric: defaults, records: [], runs: {}};
  renderImportErrors();
  if (historySupported) {
    try {
      await restoreServerHistory();
      cacheWorkspace();
    } catch (error) {
      status("История недоступна. " + error.message + " Обновите её через меню ⋯.", true);
    }
  } else {
    status("Запустите обновлённый сервер для сохранения оценок и апелляций.", true);
  }
  fillEditor(workspace.rubric);
  selectRecord(0);
  if (!workspace.records.length) await importPayload(await api("/synthetic.json"), "Синтетические примеры загружены", false);
  $("enter-workspace").disabled = false;
  $("enter-workspace").addEventListener("click", async () => {
    const button = $("enter-workspace");
    if (button.disabled) return;
    button.disabled = true;
    const exitDuration = 1250;
    $("ascii-stage").dispatchEvent(new CustomEvent("ascii:exit", {detail: {duration: exitDuration}}));
    const departure = button.animate([
      {transform: "scale(1)", opacity: 1, boxShadow: "0 0 0 rgba(120,242,153,0)"},
      {transform: "scale(.90)", opacity: 1, offset: .16, boxShadow: "0 0 36px rgba(120,242,153,.42)"},
      {transform: "translateX(12px) scale(1.12)", opacity: 0, boxShadow: "0 0 52px rgba(120,242,153,0)"}
    ], {duration: exitDuration, easing: "cubic-bezier(.3,.05,.2,1)", fill: "forwards"});
    await departure.finished;
    showView("dialogues");
    departure.cancel();
    button.disabled = false;
    document.querySelector("main").animate([
      {opacity: 0, transform: "translateY(20px) scale(.99)", filter: "blur(5px)"},
      {opacity: .95, transform: "translateY(2px) scale(1)", filter: "blur(.5px)", offset: .65},
      {opacity: 1, transform: "none", filter: "blur(0)"}
    ], {duration: 540, easing: "cubic-bezier(.18,.8,.2,1)"});
    document.querySelector(".paper-record.is-current")?.focus({preventScroll: true});
  });
  $("refresh-runs").addEventListener("click", async () => {
    if (syncing || busy || pendingReviews.size) return;
    syncing = true;
    $("refresh-runs").disabled = true;
    $("score").disabled = true;
    try {
      await restoreServerHistory();
      selectRecord(selected);
      persist("История обновлена с сервера.");
    } catch (error) { status(error.message, true); }
    finally {
      syncing = false;
      $("refresh-runs").disabled = false;
      renderResult();
    }
  });
  $("filter").addEventListener("input", renderList);
  $("list-filter").addEventListener("change", renderList);
  for (const button of document.querySelectorAll(".app-nav [data-view]")) {
    button.addEventListener("click", () => showView(button.dataset.view,
      button.dataset.view === "review" ? "score" : undefined));
  }
  for (const button of document.querySelectorAll(".review-tabs [data-review-tab]")) {
    button.addEventListener("click", () => setReviewTab(button.dataset.reviewTab));
  }
  $("back-to-list").addEventListener("click", () => {
    showView("dialogues");
    (document.querySelector(".paper-record.is-current") || $("list-filter")).focus({preventScroll: true});
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
    if (!historySupported || busy || syncing || !workspace.records[selected]) return;
    const index = selected;
    busy = true;
    $("upload").disabled = $("upload-results").disabled = $("demo").disabled = true;
    renderResult();
    status("Модель анализирует диалог. Это может занять несколько минут.", false, true);
    let reveal = false;
    try {
      const result = await api("/api/score", {conversation: workspace.records[index], rubric: workspace.rubric});
      let stored;
      try { stored = await api("/api/runs/" + result.run_id); }
      catch (error) {
        throw new Error("Оценка сохранена. Не удалось загрузить результат: " + error.message + " Обновите историю через меню ⋯.");
      }
      replaceRun(stored);
      if (index === selected) historyIndex = workspace.runs[index].findIndex(run => run.run_id === stored.run_id);
      reveal = index === selected;
      persist(result.status === "needs_review"
        ? "Доступные результаты сохранены. Требуется проверка." : "Оценка сохранена на сервере.");
      $("model").textContent = result.audit.model;
      $("model-badge").title = "Последний запрос выполнен: " + result.audit.model;
      $("model-badge").classList.add("is-ready");
    } catch (error) { status(error.message, true); }
    finally {
      busy = false;
      $("upload").disabled = $("upload-results").disabled = $("demo").disabled = false;
      renderList();
      renderResult(undefined, reveal);
    }
  });
}

boot().catch(error => status("Не удалось открыть приложение. " + error.message + " Перезагрузите страницу.", true));
