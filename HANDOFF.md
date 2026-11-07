# CQA Hackathon — agent and team handoff

Updated 2026-11-07 (Asia/Qyzylorda). This is the first implementation milestone for the Freedom Broker Data Challenge.

## Repository and access

- Team repository [lalob1/cqa-hackathon](https://github.com/lalob1/cqa-hackathon), private while the team builds. Start from `main`. GitHub returned HTTP 201 for the invitation to `toxxxapts`. GitHub grants access after the invitee accepts. Additional teammates need their own invitations.
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
| User’s top-50 criteria | Accuracy against organizer labels on 10 unseen transcripts comes first. Other considerations are useful features, usability, live analysis and diversity of architectures. The materials give no official score-distance formula or label file. |

DEV retrieval was verified from the signed organizer endpoint. It returned **65 records, 60 chats and 5 calls**. Languages were **35 RU, 15 KZ and 15 EN**. Transcripts have 11–115 turns and use `client`, `operator`, `bot`, and `system`. The starter keeps timestamp strings as provided. On the original machine, the correctly decoded response is `../dev-utf8.json` relative to the checkout and the signed link is in `../dev-url.txt`. Store copies in an ignored `data/` directory if needed. Share organizer materials only through the team’s approved data channel. Raw data, signed URLs, audio, weights and runtime logs stay outside Git.

## Deliverables

| Path | Contents and interface |
| --- | --- |
| [README.md](README.md) | Setup for Ollama or llama.cpp, architecture diagram, DEV and control commands, label format, and demo steps. |
| [rubric.json](rubric.json) | Default Russian rubric. Each criterion has an ID, label, section, type, rule, weight, and optional N/A condition. Scales list numeric levels and anchors. |
| [engine.py](engine.py) | Validate imports and rubrics, call the model with the current checklist and numbered turns, validate each answer and evidence range, calculate the final score, and add provenance. Both adapters are local. |
| [app.py](app.py) | Standard-library loopback HTTP server. `GET /api/config`, `POST /api/import`, `/api/rubric`, `/api/score` and `/api/recalculate`. |
| [web/index.html](web/index.html), [web/app.js](web/app.js), [web/style.css](web/style.css) | Browser workspace with import, filters, transcript and audio link, rubric editing and export, criterion scores, evidence links, per-dialogue run history, and appeal review. |
| [batch.py](batch.py) | `fetch`, `score`, `compare`. Each batch writes raw judgments, rubric/input hashes, totals, provider/model, token counts, and per-dialogue errors. Comparison reports criterion agreement, N/A disagreement, missing IDs and total MAE. |
| [examples/synthetic.json](examples/synthetic.json) | Three invented dialogues, one per language, with no customer data and no precomputed scores. |
| [tests/test_cqa.py](tests/test_cqa.py) | Seven checks covering validation, changed rubrics, proportional N/A/scale math, independent flags, review recalculation, evidence bounds and model failure. |
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

- Run `python -m unittest discover -s tests -v` and `node --check web/app.js`. Both passed during development. The API adapter retrieved and validated all 65 DEV records.
- Real model smoke test passed in Chrome with Qwen3-4B Q4_K_M through llama.cpp Vulkan build 11719. One fresh synthetic RU chat returned all eight judgments in about 38 seconds. The evidence link highlighted the referenced turn. A test appeal preserved the 100.00 original and changed the final to 92.31. The rubric editor saved an added criterion, and both scores survived reload. The edited rubric was not re-scored in this smoke test. Ollama, KZ/EN inference, real calls, and the full DEV scoring run still need live verification.
- Observed quality issue to investigate first: the baseline marked consultation N/A even though the customer asked an explicit tariff question in turn 1. It cited the closing turn. Evidence bounds and valid JSON alone did not catch this. Compare a targeted applicability check against the baseline before freezing a model.
- No organizer Ground Truth was available in the attachments or DEV response. There is no challenge accuracy result. The team must label a development set and keep it separate from the 10 unseen controls.
- The attachment checklist covers chat criteria and uses a separate critical flag. Calls use those same transcript-based criteria for now. No voice-tone or diction evaluation has been implemented.
- App storage is browser-local and subject to quota. CLI output is persisted to a local JSON file. The current prototype runs without accounts, as the demo guide specifies.
- The public submission, control run and final commit freeze are future milestones.

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
