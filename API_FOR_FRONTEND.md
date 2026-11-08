# Подключение функций к фронтенду друга

Фронтенд `web/` подключён к этим API: история и апелляции загружаются с сервера, фильтры читают последние сохранённые запуски, импорт сохраняет проверенные оценки. Сервер: `python app.py`, адрес http://127.0.0.1:8765. Существующие `/api/import`, `/api/rubric`, `/api/score`, `/api/recalculate` сохраняют формат. Новые ключи в ответах добавлены без удаления старых.

Все POST — `Content-Type: application/json`. Ошибки: `{ "error": "сообщение" }`; 400 — неверные данные, 409 — конфликт ревизии/повторное решение, 502 — ошибка модели, 503 — локальное хранилище недоступно. API рассчитан на этот же origin, без CORS. Защиту Host/Origin не отключать: для разработки обращаться к серверу через локальный прокси фронтенда или отдавать сборку с этого Python-сервера.

## Оценка и загрузка истории

`POST /api/score`

```json
{"conversation": {"conversation_id": "...", "channel": "agent chat", "language": "RU", "transcript": []}, "rubric": []}
```

Объекты заполнить реальными репликами и текущим чек-листом; пустые массивы не являются допустимым запросом. Ответ, как раньше, содержит `conversation_id`, `judgments`, `score`, `rubric`, `audit`; теперь также `run_id`. После успеха сохранять `run_id` вместе с отображаемым результатом. Сохранение на сервере выполняется автоматически. Ошибку 502 не заменять демо-баллами.

`GET /api/runs/RUN_ID` возвращает:

```json
{
  "run_id": "...",
  "conversation": {"conversation_id": "..."},
  "original": {"judgments": {}, "score": {}, "rubric": [], "audit": {}},
  "appeals": [],
  "final_answers": {},
  "final_score": {},
  "revision": 0,
  "stored_at": "2026-11-08T00:00:00+00:00"
}
```

Это сокращённая форма ответа: сервер возвращает полный диалог и исходную оценку. Для карточки использовать `original` и `final_score`, историю строить из `appeals`. Исходные баллы, обоснование и ссылки модели показывать отдельно от финальных ответов и решения человека. Чек-лист для пересмотра — снимок `original.rubric`, а не текущая версия редактора.

## Список и фильтры

```text
GET /api/runs?filter=all&limit=100&offset=0
GET /api/runs?filter=critical
GET /api/runs?filter=final-critical
GET /api/runs?filter=appeal
GET /api/runs?conversation_id=ID&latest=false
```

`conversation_id` URL-кодировать. `latest=true` по умолчанию выбирает последний сохранённый запуск каждого ID **до применения фильтра**. `latest=false` показывает все запуски. Ответ: `total`, `offset`, `limit` и `results`; `limit` 1–500, следующая страница через `offset`.

Карточка списка содержит `run_id`, `conversation_id`, `language`, `channel`, `original_score`, `final_score`, `original_critical`, `final_critical`, `open_appeals`, `revision`, `rubric_sha256`, `stored_at`.

`critical_reasons` содержит исходные флаги модели: `criterion_id`, `reason`, `evidence` (массив диапазонов `{start,end}`). `final_critical_reasons` содержит финальные причины с `source: "model" | "reviewer"`. Если причина взята из решения проверяющего, `evidence` пуст: человек в этом API не задаёт новые диапазоны, поэтому нельзя выдавать старые ссылки модели за доказательства его решения. Старые диапазоны доступны отдельно как `original_model_evidence`.

Кнопка «Грубые ошибки» → `filter=critical`; дополнительный режим «После пересмотра» → `filter=final-critical`. В карточке показывать, был ли флаг снят. Фильтр `appeal` — только открытые апелляции.

## Апелляция и пересмотр

1. Получить актуальный запуск `GET /api/runs/RUN_ID`.
2. `POST /api/appeals`:

```json
{"run_id":"...","criterion_id":"closing","message":"В последней реплике оператор подвёл итог и попрощался. Прошу пересмотреть.","expected_revision":0}
```

3. Ответ содержит обновлённый запуск, новую `revision`, массив `appeals`. Каждая апелляция имеет `appeal_id`, `criterion_id`, `message`, `opened_at`, `status`, `decision`.
4. Проверяющий вызывает `POST /api/reviews`:

```json
{"run_id":"...","appeal_id":"...","answer":"yes","reason":"Подтверждено по финальной реплике оператора.","reviewer":"QA reviewer","expected_revision":1}
```

5. Заменить локальный вид карточки **полным ответом сервера**. Он содержит новый `final_score`, `final_answers`, историю и ревизию.

Значения `answer` внутренние: `"yes"`, `"no"`, `"na"` или число шкалы; не JavaScript boolean/null. `na` только там, где разрешён. Причина обязательна. При подтверждении исходного ответа тоже сохранять решение с причиной.

`expected_revision` брать из последнего ответа. При HTTP 409 заново запросить запуск и предложить пользователю сверить новое состояние; автоматически повторять сохранение с новой ревизией нельзя. Одновременно можно иметь только одну открытую апелляцию по критерию. После решения можно открыть новую: старое решение остаётся в истории.

Браузерный сценарий использует `/api/appeals` и `/api/reviews`. Для старых локальных запусков предусмотрена кнопка «Сохранить запуск на сервере» с резервной копией исходной истории; перенос не выполняется скрыто. `/api/recalculate` оставить для предварительного расчёта; он не заменяет `/api/reviews` и не записывает историю.

## Пакетные результаты

`POST /api/import-results`:

```json
{"records": [], "payload": {"rubric_sha256":"...","results":[],"errors":[]}}
```

В `records` передать исходные загруженные диалоги, в `payload` — содержимое `runs/dev.json` от `batch.py score`. Сокращённый пример выше — только структура полей. Ответ содержит проверенные `results`, `errors`, `run_ids` в порядке `results`. Все успешные записи сохраняются в серверную историю одной транзакцией. Ошибки остаются в ответе; они не создают оценку или строку с нулевым баллом. После импорта обновить список через `/api/runs`.

Повторный импорт точно того же исходного запуска возвращает прежний `run_id` и сохраняет его апелляции. Новая AI-оценка с новым аудитом создаёт отдельный запуск. Не вызывать импорт при обычном перерисовывании экрана.

Хеши проверяют согласованность текста, языка/канала при наличии соответствующего аудита и чек-листа. Баллы пересчитываются сервером. Хеши не доказывают, что файл действительно был создан моделью, и не делают семантически неверное объяснение правильным.

## Конкурсный JSON

`POST /api/export-results`:

```json
{"records": [], "payload": {"results":[],"errors":[]}, "group":"prod", "team_name":"TEAM_NAME"}
```

В `records` — **полный** исходный набор организаторов, в `payload` — пакет исходных AI-оценок. Ответ — готовый объект JSON 1.0, который можно скачать как UTF-8 `results.json`. Число строк и канонические критерии проверяются. Содержимое должно соответствовать исходному конкурсному чек-листу; произвольно изменённые критерии не экспортируются в конкурсную схему. Финальные ручные решения не подмешиваются в AI-ответы.

Перед скачиванием посчитать `results.filter(r => r.status === 'error')`: если есть ошибки, явно показать неполноту. HTTP 200 здесь означает, что структура экспортирована; оно не означает, что все диалоги успешно оценены.

`GET /api/health` возвращает `server: "ok"`, а доступность модели — `"not_checked"`. Этот endpoint не делает inference; не показывать по нему «AI подключён». `/api/config` содержит дополнительные `provider` и `features`.

## Проверка API в PowerShell без изменения дизайна

После успешной оценки взять настоящий `run_id` из ответа API или команды `python workflow.py list`:

```powershell
$base = 'http://127.0.0.1:8765'
$runId = 'ВСТАВИТЬ_RUN_ID'
$run = Invoke-RestMethod "$base/api/runs/$runId"
$appealBody = @{run_id=$runId; criterion_id='closing'; message='Прошу проверить завершение'; expected_revision=$run.revision} | ConvertTo-Json
$run = Invoke-RestMethod "$base/api/appeals" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($appealBody))
$appeal = $run.appeals | Where-Object { $_.criterion_id -eq 'closing' -and $_.status -eq 'open' } | Select-Object -Last 1
$decisionBody = @{run_id=$runId; appeal_id=$appeal.appeal_id; answer='yes'; reason='Указать реальную причину по диалогу'; expected_revision=$run.revision} | ConvertTo-Json
$run = Invoke-RestMethod "$base/api/reviews" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($decisionBody))
$run.final_score
```

Решение в примере учебное: выбирать его по реальному диалогу. Это локальный прототип без авторизации; `reviewer` не является подтверждённой учётной записью. До демонстрации проверить цепочку: новый диалог → оценка → исходное объяснение → грубые ошибки → апелляция → пересчёт → изменение чек-листа → новая оценка.
