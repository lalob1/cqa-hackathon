# CQA Hackathon — agent and team handoff

Updated 2026-11-07 (Asia/Qyzylorda). This handoff covers the implementation, consultation calibration, and control-run preparation for the Freedom Broker Data Challenge.

## Repository and access

- Team repository [lalob1/cqa-hackathon](https://github.com/lalob1/cqa-hackathon), private while the team builds. Start from `main`. GitHub lists `toxxxapts` and `Ain-gl` as collaborators. `zhaziiaa14` has a pending invitation. The consultation calibration is on `model/consultation-applicability` for review.
- Work in short branches, for example `eval/dev-labels`, `model/rubric-calibration`, `ui/review`, and `ops/demo`. Keep branches independent by using the interfaces in the table below. Open PRs into `main`.
- The guide calls for a public repository URL for the submission. The team still needs to decide when to publish and submit it. Confirm the organizer’s current cutoff and submission channel.
- Local checkout on the original Windows machine is `C:/Users/lolol/Documents/Codex/2026-11-07/50-ai-10-ground-truth-1/work/cqa-hackathon`. Collaborators should clone GitHub.

## Source materials

| Material | What it contributes |
| --- | --- |
| `CQA_Hackathon_Student_Guide_v3.pdf` and `CQA_Hackathon_Student_Guide_v3 1.pdf` | Byte-identical four-page guide. HTML/CSS/JS front end, RU/KZ/EN support, checklist changes from the UI, evidence, appeals, and a five-minute defense. The API link is on p. 3. |
| `CQA_Chat_Quality_Checklist.pdf` and `tg_image_2529044409.png` | The image points to the separate checklist. Its eight criteria, four N/A gates, two discrete scales, proportional weights, rounding and independent critical flag are encoded in `rubric.json` and `engine.py`. |
| `IMG_3695.MP4` | 15-second phone screen recording opening the guide’s DEV API link and showing the JSON response. Sampled frames show Cyrillic rendered incorrectly by the phone viewer. The Python importer reads the response as UTF-8. The audio track is effectively silent. |
| `Data 2 (1) 1.pdf` | Five-page Freedom Holding company overview. Context for the domain. The starter evaluates the transcript and checklist, and has no approved operations-policy reference. |
| `dev_dialogues.json` | User-supplied offline copy of the DEV API response. Parsed JSON is identical to the retrieved response, including all 65 transcript records. |
| User’s top-50 criteria | Accuracy against organizer labels on 10 unseen transcripts comes first. Other considerations are useful features, usability, live analysis and diversity of architectures. The materials give no official score-distance formula or label file. |

DEV retrieval was verified from the signed organizer endpoint. It returned **65 records, 60 chats and 5 calls**. Languages were **35 RU, 15 KZ and 15 EN**. Transcripts have 11–115 turns and use `client`, `operator`, `bot`, and `system`. The starter keeps timestamp strings as provided. On the original machine, the correctly decoded response is `../dev-utf8.json` relative to the checkout and the signed link is in `../dev-url.txt`. Store copies in an ignored `data/` directory if needed. Share organizer materials only through the team’s approved data channel. Raw data, signed URLs, audio, weights and runtime logs stay outside Git.

## Deliverables

| Path | Contents and interface |
| --- | --- |
| [README.md](README.md) | Setup for Ollama or llama.cpp, architecture diagram, DEV and control commands, label format, and demo steps. |
| [rubric.json](rubric.json) | Default Russian rubric. Each criterion has an ID, label, section, type, rule, weight, and optional N/A condition. Scales list numeric levels and anchors. |
| [engine.py](engine.py) | Validate imports and rubrics, call the model with the current checklist and numbered turns, validate each answer and evidence range, calculate the final score, and add provenance. Both adapters are local. |
| [app.py](app.py) | Standard-library loopback HTTP server. `GET /api/config`, `POST /api/import`, `/api/import-results`, `/api/rubric`, `/api/score` and `/api/recalculate`. |
| [web/index.html](web/index.html), [web/app.js](web/app.js), [web/style.css](web/style.css) | Browser workspace with import, filters, transcript and audio link, rubric editing and export, criterion scores, evidence links, per-dialogue run history, and appeal review. |
| [batch.py](batch.py) | `fetch`, `score`, `compare`. Batches can require an exact input count and resume a matching checkpoint. Output records judgments, input and rubric hashes, provider, model, prompt, duration, token counts, and errors. Comparison reports criterion agreement, false and missed N/A, missing IDs, and total MAE. |
| [examples/synthetic.json](examples/synthetic.json) | Three invented dialogues, one per language, with no customer data and no precomputed scores. |
| [examples/consultation-cases.json](examples/consultation-cases.json) | Four invented dialogues for the consultation applicability regression. The expected levels are documented below and stay outside the model input. |
| [tests/test_cqa.py](tests/test_cqa.py) | Eleven checks covering rubric math, evidence, resume and lock behavior, expected input counts, and import rejection for mismatched transcripts or altered totals. |
| [HANDOFF.md](HANDOFF.md) | This record of decisions, status, verification, and next work. |

## Design sketch and decisions

```text
[Upload JSON] [Examples] [Checklist editor]
    Dialogues          Transcript              Result
    ID / language      numbered turns          AI and final scores
    list and search    audio link for calls    criterion / evidence / appeal
```

The model sees the configured rubrics and transcript, including bot and system events as context. It does not receive the conversation ID, prior judgments or labels. The code assigns points and flags from the answers. It uses exact fractional arithmetic before rounding totals and normalizes to 100 over applicable positive weight, including when an edited rubric has a different total configured weight. Sections show their earned points and maximum after redistribution. A saved run retains its own rubric so later edits do not change it. Each review decision records the final answer and reason separately.

Qwen3-4B Q4_K_M is the initial local model candidate. The engine requests schema-constrained JSON, retries an invalid judgment once, and reports an error if it still cannot validate it. Bounds validation ensures referenced turns exist. Human review still needs to check whether a cited passage supports the decision. Current calls are scored from transcripts. Audio is a playback link. The demo uses browser-local storage for data, rubrics, runs and appeals. Team collaboration here is shared source code through GitHub. App state lives in each browser profile.

## Verification and limits

- Run `python -m unittest discover -s tests -v` and `node --check web/app.js`. Both passed on the control-readiness branch with eleven automated tests. The API and browser accepted all 65 DEV records.
- The original Chrome smoke test used Qwen3-4B Q4_K_M through llama.cpp Vulkan build 11719. A fresh synthetic RU chat returned all eight judgments in about 38 seconds. The evidence link highlighted the referenced turn. A test appeal preserved the 100.00 original and changed the final to 92.31. The rubric editor saved an added criterion, and both scores survived reload. Live Ollama, full DEV scoring, and a successful long-call run remain open.
- The baseline marked consultation N/A even though the customer asked an explicit tariff question in turn 1. It cited the closing turn. Evidence bounds and valid JSON allowed the result. See the paired calibration below.
- No organizer Ground Truth was available in the attachments or DEV response. There is no challenge accuracy result. The team must label a development set and keep it separate from the 10 unseen controls.
- The attachment checklist covers chat criteria and uses a separate critical flag. Calls use those same transcript-based criteria for now. No voice-tone or diction evaluation has been implemented.
- App storage is browser-local and subject to quota. CLI output is persisted to a local JSON file. The current prototype runs without accounts, as the demo guide specifies.
- The public submission, control run and final commit freeze are future milestones.

## Consultation calibration

The `cqa-rubric-v3` candidate asks for evidence and rationale before the answer, checks each configured N/A rule against the full transcript, and gives the model a uniform string choice for every answer. The parser converts numeric scale choices to integers before scoring or export. `batch.py compare` now separates false N/A from missed N/A. The timeout is configurable through `CQA_TIMEOUT_SECONDS` with a default of 240 seconds.

Four synthetic cases were tested with Qwen3-4B Q4_K_M, seed 42, temperature 0 and llama.cpp Vulkan build 11719. These are developer-authored expectations for the consultation criterion. Organizer labels are still needed to measure challenge accuracy. The model hash for the local GGUF is `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.

| Case | Expected | V1 (`8ffaf34`) | V3 candidate | Separate one-criterion probe |
| --- | ---: | ---: | ---: | ---: |
| RU tariff question answered | 20 | N/A | 15 | 20 |
| RU greeting, then disconnect before a request | N/A | N/A | N/A | N/A |
| KZ password request followed only by a greeting | 0 | N/A | N/A | N/A |
| EN statement question raised after the opening | 20 | N/A | 15 | 20 |

- Consultation applicability rose from **1/4 to 3/4**. Exact consultation levels were **1/4 in both full-rubric runs**. The V3 explanation in both 15-point cases claimed a missing secondary detail without identifying it. The Kazakh case still confused an unanswered request with a conversation that ended before a request was made.
- A short intermediate run with evidence first and mixed JSON answer types still marked the RU tariff question N/A and assigned 15 to the genuine no-request case. The tested V3 measures the prompt and schema changes together.
- The separate one-criterion probe reached **3/4 exact consultation levels** and missed the same Kazakh case. The app uses the V3 full-rubric call. A next experiment can first identify the concrete client request and its turn, then apply the configured N/A condition and score anchor.
- The 115-turn DEV call hit the 240-second timeout on the laptop. The English fixture initially waited behind it and timed out. The isolated English retry produced the result in the table. Schedule the next long-call test with a larger timeout and measure throughput on the machine planned for the control run. The edited single-criterion rubric returned a valid live `yes` with turn 2 as evidence. That check exercised the engine through Python.
- Raw experimental outputs on the original computer are `../consultation-baseline.json`, `../consultation-candidate.json` (intermediate), `../consultation-v3.json`, `../consultation-v3-en-retry.json`, `../consultation-focused-probe.json`, and `../calibration-edited-rubric-smoke.json`. Runtime logs are `../calibration-llama-err.log` and `../calibration-llama-out.log`.

Reproduce the full-rubric comparison from this branch with the same local model server and the [synthetic cases](examples/consultation-cases.json):

```powershell
git worktree add --detach ../cqa-v1 8ffaf34
python ../cqa-v1/batch.py score examples/consultation-cases.json --output runs/consultation-v1.json
python batch.py score examples/consultation-cases.json --output runs/consultation-v3.json
```

Run the two batches sequentially on a single-slot model server. Compare `judgments.consultation.answer` with the table. Keep the candidate in review until it has been evaluated against independently labeled DEV transcripts. Score the baseline and candidate against the same holdout and inspect both total MAE and criterion errors.

## Control-run readiness

The `ops/control-readiness` branch adds an exact record-count gate, atomic checkpoints, and `--resume` with input, rubric, prompt, provider, model and model-revision checks. A failed or unfinished record is retried while completed records are retained. Use a separate output path when the rubric or model changes. A process-scoped file lock prevents two scorers from writing the same checkpoint.

The browser can import a saved CLI batch after importing its transcripts. It verifies the transcript and rubric hashes, judgment types, evidence bounds, and recalculated points. Imported cards are labeled as CLI runs. In isolated Chrome, a genuine model result imported and survived reload, importing it again added zero copies, and a modified total was rejected. The user-supplied `dev_dialogues.json` added all 65 DEV records alongside three built-in examples. The current demo can show the imported batch and still score a newly edited rubric live.

Local six-chat DEV diagnostic used two seeded selections per language. The provisional reference was written from the transcripts and rubric before opening model outputs. It is one assistant review pass and needs independent adjudication. V3 returned **5/6** usable scores, with **6.454/100** total-score MAE on the five paired rows. Exact agreement was **3/5** for consultation, **0/5** for closing, **1/5** for needs, and **4/5** for the critical flag. One English after-hours paid advice offer was missed. One Kazakh chat timed out at 420 seconds while the model generated over 1,800 tokens. These are DEV diagnostics, with organizer Ground Truth still pending.

The 115-turn call was used to measure a compact prompt prototype on the local tokenizer. Input content fell from **9,713 to 4,824 tokens** in that measurement while retaining all 115 turns. To continue the DEV comparison locally, use `../dev-review-six.json`, `../dev-review-six-labels.json`, `../dev-review-six-notes.md`, `../dev-review-v3-cuda.json`, and `../dev-review-v3-cuda-metrics.json`. The verified Windows CUDA runtime is under `../runtime-cuda-b11719/`. This material stays local.

Control validation requires the organizer's 10 transcripts and the scoring reference when released. The commands are in [README.md](README.md#контрольный-запуск). Before the code freeze, run the full control batch, check all ten rows and the empty error list, rehearse the five-minute flow with the replacement criterion, and record the commit and model revision. Public submission requires the organizer's submission channel and the team's decision to publish.

## Compact scoring experiment

`model/compact-transcripts` changes the prompt version to `cqa-rubric-v4`. It uses compact turn arrays and elapsed seconds for chronologically ordered call timestamps. The UI, evidence turn numbers, transcript fingerprints, and original source times stay available. For calls with timestamps that cannot be parsed in order, the model receives the source times. The candidate also caps explanations and generation length, uses a small repetition penalty, and clarifies consultation, closing, and paid off-company offers.

This is an experimental branch. The four-record live probe covers the previously timed-out Kazakh chat, the missed English paid advice offer, a Russian farewell-only chat, and the 115-turn call. Local inputs and results are `../dev-compact-probe-input.json` and `../dev-compact-v4-probe.json`. Use the same independently reviewed DEV reference before selecting a competition model. Browser checks on the preceding branch showed the call recording link and confirmed the page fit a 390 px viewport.

## Parallel work plan

1. **Evaluation / `eval/dev-labels`.** Label a stratified subset across language, channel, short/long conversations, N/A, and critical cases. Have two people label independently, adjudicate disagreements, record evidence and freeze a holdout. Store labels locally in the README’s JSON format. Track exact criterion agreement, N/A confusion, critical precision/recall, score MAE and latency. Report denominators and errors.
2. **Model / `model/rubric-calibration`.** Run the baseline with `batch.py score`; compare alternatives on the same frozen DEV holdout. Start by inspecting identity timing, needs vs N/A, consultation partial credit, critical false positives, and Kazakh examples. Add prompt changes only after documenting which mistakes they fix. If the team evaluates a cloud model, decide which data may be sent, then log the model, provider, token usage and per-dialogue cost.
3. **UX / `ui/review`.** Test on another teammate’s browser. Verify evidence jumps, visible N/A and separate critical flags, preserving the original judgment in review, and replacing a criterion from settings. Check voice-recording links and browser storage persistence. Plan shared app state separately if needed.
4. **Control and demo / `ops/demo`.** Rehearse the five-minute flow. Once organizers provide the control group, fetch it into `data/`, save the active rubric, score all 10 on the frozen code and confirm 10 results with zero errors before the demo. Log provider, model and commit. For the organizer’s changed criterion, save it through the UI and score a new run.

### Five-minute defense

1. **0:00–1:00** Load the group and select a dialogue.
2. **1:00–3:00** Run or open the evaluation, jump to an evidence span and show the N/A weight adjustment.
3. **3:00–4:00** File an appeal and save a reviewer decision. Show the original and recomputed total.
4. **4:00–5:00** Replace a criterion in the UI, save and re-score a transcript. Use the checklist hash to distinguish the runs.

### Local runtime from the smoke test

The existing GGUF file is at `../model/qwen3-4b-q4_k_m.gguf` from the checkout (2,497,280,256 bytes). The test used an existing Windows Vulkan `llama-server.exe` in the 2026-10-14 Codex workspace under `work/public_humanizer_review_20261018/runtime/llama_b11719_vulkan/`. Use the README to run with a fresh install or reuse this runtime locally. Test launch used context 16384, one slot, Jinja, GPU layer offload, and Q8_0 KV cache. Test app port was 18767 and model port was 18880. See local `../llama-err.log` and `../app-err.log`. The four-record RU/KZ/EN plus call smoke subset at `../dev-smoke.json` is ready for the next agent to score.

### Resume commands

```powershell
git clone https://github.com/lalob1/cqa-hackathon.git
cd cqa-hackathon
python -m unittest discover -s tests -v
ollama pull qwen3:4b
python app.py
```

For model runtime details, use the [Ollama Chat API](https://docs.ollama.com/api/chat) and [llama.cpp server reference](https://github.com/ggml-org/llama.cpp/tree/master/tools/server). For repository access, use [GitHub’s collaborator instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository).
