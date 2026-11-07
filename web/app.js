"use strict";

const $ = (id) => document.getElementById(id);
const storageKey = "cqa-workspace-v1";
const roles = {client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система"};
const answerText = (value) => ({yes: "Да", no: "Нет", na: "N/A"})[value] ?? String(value);
const scoreText = (value) => value === null ? "—" : value.toFixed(2);
let defaults, workspace, selected, historyIndex, busy = false;
const pendingReviews = new WeakSet();

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function status(message, isError = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(isError);
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
  selectRecord(first);
  persist(label + " · новых диалогов " + additions.length);
}

function renderList() {
  const list = $("conversation-list");
  const search = $("filter").value.toLowerCase().trim();
  list.replaceChildren();
  $("record-count").textContent = workspace.records.length;
  for (const [index, conversation] of workspace.records.entries()) {
    if (!(conversation.conversation_id + " " + conversation.language).toLowerCase().includes(search)) continue;
    const button = node("button", conversation.conversation_id, "record");
    button.type = "button";
    button.setAttribute("aria-current", String(index === selected));
    button.append(node("small", conversation.language + " · " + (conversation.channel === "voice call" ? "Звонок" : "Чат")));
    button.addEventListener("click", () => selectRecord(index));
    list.append(button);
  }
  if (!list.childElementCount) list.append(node("p", "Диалоги не найдены.", "empty"));
}

function renderTranscript() {
  const conversation = workspace.records[selected];
  $("turns").replaceChildren();
  $("transcript-title").textContent = conversation?.conversation_id ?? "Выберите диалог";
  $("conversation-meta").textContent = conversation ? conversation.language + " · " + conversation.transcript.length + " реплик" : "";
  $("audio").hidden = !conversation?.audio_url;
  if (!conversation) return;
  if (conversation.audio_url) $("audio").href = conversation.audio_url;
  for (const [index, turn] of conversation.transcript.entries()) {
    const item = node("li", undefined, "turn " + turn.speaker);
    item.id = "message-" + (index + 1);
    item.tabIndex = -1;
    item.append(node("small", "#" + (index + 1) + " · " + turn.timestamp + " · " + roles[turn.speaker]), node("p", turn.text));
    $("turns").append(item);
  }
}

function showEvidence(span) {
  for (const turn of $("turns").children) turn.classList.remove("marked");
  for (let index = span.start; index <= span.end; index += 1) $("message-" + index).classList.add("marked");
  const target = $("message-" + span.start);
  target.focus({preventScroll: true});
  target.scrollIntoView({block: "nearest", behavior: "smooth"});
}

function metric(label, value) {
  const tile = node("div", undefined, "metric");
  tile.append(node("small", label), node("strong", scoreText(value)));
  return tile;
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
  row.append(node("summary", item.title + " · " + answerText(current)));
  const points = finalScore.criteria[item.id];
  const weight = item.type === "flag" ? "Отдельный флаг" :
    "Вес " + item.weight + " · начислено " + scoreText(points.points) + " из " + scoreText(points.effective_weight);
  row.append(node("p", weight, "meta"), node("p", "Исходная оценка: " + answerText(original.answer)), node("p", "Обоснование модели: " + original.reason));
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
    row.append(reviewForm(run, item, appeal, current));
  }
  return row;
}

function renderResult(openCriterion) {
  const runs = workspace.runs[selected] || [];
  const run = runs[historyIndex];
  $("score").disabled = busy || !workspace.records[selected];
  $("score").textContent = busy ? "Оценка выполняется…" : "Оценить диалог";
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
    pane.append(node("p", "После запуска здесь появятся баллы и ссылки на реплики.", "empty"));
    return;
  }
  const original = run.original;
  const final = run.finalScore || original.score;
  const totals = node("div", undefined, "totals");
  totals.append(metric("Исходный / 100", original.score.total), metric("Финальный / 100", final.total));
  pane.append(totals);
  const flags = Object.entries(final.flags).filter(([, value]) => value).map(([id]) => original.rubric.find((item) => item.id === id).title);
  if (flags.length) pane.append(node("p", flags.join(" · "), "flag"));
  const sections = node("ul", undefined, "section-list");
  for (const [name, row] of Object.entries(final.sections)) sections.append(node("li", name + " · " + scoreText(row.points) + " / " + scoreText(row.max)));
  if (sections.childElementCount) pane.append(sections);
  pane.append(node("p", original.audit.model + " · чек-лист " + original.audit.rubric_sha256.slice(0, 8) + " · вход " + original.audit.input_sha256.slice(0, 8), "meta"));
  for (const item of original.rubric) pane.append(renderCriterion(run, item, final, openCriterion === item.id));
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
  $("history").addEventListener("change", () => { historyIndex = Number($("history").value); renderResult(); });
  $("upload").addEventListener("change", async () => {
    const file = $("upload").files[0];
    try {
      if (file?.size > 7 * 1024 * 1024) throw new Error("Файл должен быть до 7 МБ.");
      if (file) await importPayload(JSON.parse((await file.text()).replace(/^\uFEFF/, "")), "Данные загружены");
    } catch (error) { status(error.message, true); }
    $("upload").value = "";
  });
  $("demo").addEventListener("click", async () => {
    try { await importPayload(await api("/synthetic.json"), "Синтетические примеры загружены"); }
    catch (error) { status(error.message, true); }
  });
  $("toggle-rubric").addEventListener("click", () => {
    $("editor").hidden = !$("editor").hidden;
    $("toggle-rubric").setAttribute("aria-expanded", String(!$("editor").hidden));
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
    $("upload").disabled = $("demo").disabled = true;
    renderResult();
    status("Локальная модель анализирует диалог…");
    try {
      const result = await api("/api/score", {conversation: workspace.records[index], rubric: workspace.rubric});
      const runs = workspace.runs[index] ??= [];
      runs.push({original: result, appeals: {}});
      if (index === selected) historyIndex = runs.length - 1;
      persist("Оценка сохранена.");
    } catch (error) { status(error.message, true); }
    finally {
      busy = false;
      $("upload").disabled = $("demo").disabled = false;
      renderResult();
    }
  });
}

boot().catch((error) => status(error.message, true));
