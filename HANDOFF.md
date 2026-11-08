# CQA Hackathon — agent and team handoff

## Current integration: durable review workflow (2026-11-08)

Use branch [`fix/dev-review-workflow`](https://github.com/lalob1/cqa-hackathon/tree/fix/dev-review-workflow). It includes the current team carousel through `d53c114`, merged with the supplied backend-only implementation and fixes. Earlier sections below describe previous checkpoints and should be read in that context.

- Runs, original model judgments, rubric/transcript snapshots, appeals and append-only reviewer decisions are persisted in SQLite. The frontend uses the API for imports and reviews, restores server history and supports original/final critical, pending and open-appeal filters. Latest means last server insertion, selected before filtering.
- Final V11 live workflow passed on a new synthetic dialogue: score 100, source evidence, saved appeal about the explanation, reviewer confirmation of N/A, recalculation at 100, and reload at revision 2. The original model text is retained separately. The 10-result final batch reimport created no duplicates; two failed attempts remain explicit errors and do not replace earlier successful results.
- Stale writes return 409, refresh the server state and preserve an unsent draft for explicit resubmission. Duplicate imports retain the same run and decisions. A different conversation under an existing ID rejects the whole batch.
- Default prompt is `cqa-rubric-v11-evidence-gates`. Full compact transcripts, constrained JSON, limited thinking and targeted repair of invalid criteria are retained. The evidence gate applies only to unchanged standard rules; it cannot prove all semantic claims. No conversation IDs or reference answers are embedded in production code.
- The 12-case V11 calibration review has four chats per language and 96 provisional assistant reference judgments, frozen before opening V4 outputs. This is neither independent human Ground Truth nor a held-out test. New successful results: 10/12. Processing failures are kept separately, not assigned a numeric zero.
- On the same 10 successful pairs, total MAE against that provisional reference is 8.371 (historical V4) versus 4.954 (V11). This is retrospective and changes multiple components; it does not isolate a causal prompt effect. See [DEV_REVIEW_SUMMARY.md](DEV_REVIEW_SUMMARY.md) for coverage, criterion counts and limitations.
- All successful candidate explanations and citations were reviewed; exact V9 matches explicitly reuse the earlier review. Residual generic text, wrong N/A and unsupported reasons remain, especially in KZ. Matching scores must not be presented as proof that explanations are correct. Full transcripts, labels and the per-criterion semantic audit stay in the separate local DEV review package, outside Git.
- 92 unittest tests passed; JavaScript syntax passed. Browser checks include real local inference, evidence, durable appeals/recalculation, changing the rubric, revision conflicts, duplicate/invalid/error imports and the merged 320/390 px layout. Detailed current checks are at the top of [UI_CHECKS.md](UI_CHECKS.md). Live inference uses llama.cpp; Ollama and physical phones were not tested here.
- `results/dev/results.json` is the unchanged historical 65-record V4 export. No new PROD data were provided and no organizer submission was made. Do not present the 12-case review as a complete 65-record rescore.

Run `python app.py`; configure the local provider using [WORKFLOW_UPDATE_RU.md](WORKFLOW_UPDATE_RU.md). The default SQLite path is `data/cqa.sqlite3` (`CQA_DB` overrides it). Thinking can take several minutes on this laptop; record quality and latency together. API details are in [API_FOR_FRONTEND.md](API_FOR_FRONTEND.md).

Updated 2026-11-08 (Asia/Qyzylorda). This handoff covers the CQA Desk interface, model calibration, the DEV export, and control-run preparation for the Freedom Broker Data Challenge.

## Repository and access

- Team repository [lalob1/cqa-hackathon](https://github.com/lalob1/cqa-hackathon), private while the team builds. GitHub lists `toxxxapts`, `zhaziiaa14`, and `Ain-gl` as active collaborators. Use `fix/dev-review-workflow` for the current integrated frontend and SQLite backend. The earlier [PR #3](https://github.com/lalob1/cqa-hackathon/pull/3) tracks the preceding UI and model work.
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
| `ChatExport_2026-11-07/messages.html` and `CQA_Student_Guide_Appendix_Results.pdf` | Organizer Q&A and mandatory JSON 1.0 submission format. The export has 134 entries and ends at 22:48 Asia/Qyzylorda on November 7. The signed API and chat export stay local. |
| User’s top-50 criteria | Accuracy against organizer labels on 10 unseen transcripts comes first. Other considerations are useful features, usability, live analysis and diversity of architectures. The materials give no official score-distance formula or label file. |

DEV retrieval was verified from the signed organizer endpoint. It returned **65 records, 60 chats and 5 calls**. Languages were **35 RU, 15 KZ and 15 EN**. A fresh fetch of the supplied `group_id=DEV` endpoint matched the user’s attachment exactly after parsing. Transcripts have 11–115 turns and use `client`, `operator`, `bot`, and `system`. The browser keeps timestamp strings as provided. On the original machine, the correctly decoded response is `../dev-utf8.json` and the latest verification copy is `../dev-live-verified.json` relative to the checkout. The signed link is in `../dev-url.txt`. Store copies in an ignored `data/` directory if needed. Share organizer materials only through the team’s approved data channel. Raw data, signed URLs, audio, weights and runtime logs stay outside Git.

## Deliverables

| Path | Contents and interface |
| --- | --- |
| [README.md](README.md) | Setup for Ollama or llama.cpp, architecture diagram, DEV and control commands, label format, and demo steps. |
| [rubric.json](rubric.json) | Default Russian rubric. Each criterion has an ID, label, section, type, rule, weight, and optional N/A condition. Scales list numeric levels and anchors. |
| [engine.py](engine.py) | Validate imports and rubrics, call the model with the current checklist and numbered turns, validate each answer and evidence range, calculate the final score, and add provenance. Both adapters are local. |
| [app.py](app.py) | Standard-library loopback HTTP server. `GET /api/config`, `POST /api/import`, `/api/import-results`, `/api/rubric`, `/api/score` and `/api/recalculate`. |
| [web/index.html](web/index.html), [web/app.js](web/app.js), [web/style.css](web/style.css) | Browser workspace with import, filters, transcript and audio link, rubric editing and export, criterion scores, evidence links, per-dialogue run history, and appeal review. |
| [web/presentation.js](web/presentation.js) | Native word reveal, shared navigation bubble, paper-carousel browsing and pointer reflection, separate from scoring and review. |
| [web/brand-orbit.js](web/brand-orbit.js) | The approved 3D F and eleven true 3D currency coins behind the app. Orbit guides and trails are invisible. Drag and keyboard pulse remain. Pauses during the welcome screen and while hidden. |
| [web/f-mark.svg](web/f-mark.svg), [web/f-model.json](web/f-model.json), [web/f-model.glb](web/f-model.glb) | Vector source and 334-triangle extruded, beveled F shield. The JSON and GLB carry matching geometry. |
| [web/coin-models.json](web/coin-models.json) | Meshes for tenge, dollar and euro coins: thickness, beveled/reeded rims, and raised symbols on both faces. Individual GLB exports are alongside this file. |
| [tools/build_f_model.py](tools/build_f_model.py), [tools/build_coin_models.py](tools/build_coin_models.py) | Dependency-free Python model builders. The coin builder also deterministically rebuilds the F through its shared helper import. Tracked model assets require no build to run the app. |
| [web/welcome.js](web/welcome.js) | Interactive green ASCII F built from the approved 3D model, brief hover scatter-and-return, keyboard pulse, and a full-viewport dissolve overlay. |
| [web/brand-ascii.js](web/brand-ascii.js) | Larger deep-blue animated ASCII Democrats wordmark at top left, replacing CQA Desk and the duplicate right-side team label. |
| [web/ascii-titles.js](web/ascii-titles.js) | Shared bright-blue ASCII renderer for Аудит диалогов and Диалоги, with dense glyphs, light sweeps, hover illumination and responsive word wrapping. |
| [batch.py](batch.py) | `fetch`, `score`, `compare`, `export`. Batches can require an exact input count and resume a matching checkpoint. Output records judgments, input and rubric hashes, provider, model, prompt, duration, token counts, and errors. Comparison reports criterion agreement, false and missed N/A, missing IDs, and total MAE. Export validates and writes the organizer format. |
| [examples/synthetic.json](examples/synthetic.json) | Three invented dialogues, one per language, with no customer data and no precomputed scores. |
| [examples/consultation-cases.json](examples/consultation-cases.json) | Four invented dialogues for the consultation applicability regression. The expected levels are documented below and stay outside the model input. |
| [results/dev/results.json](results/dev/results.json) | Organizer JSON 1.0 export for registered team `Democrats`, with all 65 DEV IDs and 520 judgments from Qwen V4. |
| [tests/test_cqa.py](tests/test_cqa.py) | Thirteen checks covering rubric math, evidence, resume and lock behavior, expected input counts, checkpoint import validation, and organizer export. |
| [HANDOFF.md](HANDOFF.md) | This record of decisions, status, verification, and next work. |

## Interactive crown checkpoint

Before the requested app simplification, the crown version is preserved on [checkpoint/crown-layout-2026-11-08](https://github.com/lalob1/cqa-hackathon/tree/checkpoint/crown-layout-2026-11-08), commit `f5465b9`. It adds `web/crown.js`: native projected ribbon geometry, a binary sphere, tree nodes, drag rotation, pointer parallax, and click/keyboard root pulses. Its initial placement is in the hero plus an oversized background echo. The user requested moving it into the lowest background layer during the next redesign. Canvas rendering is capped at 30 fps and DPR 1.5 and pauses in hidden tabs. The equation and root updates are illustrative graphics, separate from dialogue scoring. A Chrome smoke check exercised dragging, keyboard activation and the eight-criterion editor without a JavaScript error.

## Design sketch and decisions

```text
[Upload JSON] [Examples] [Checklist editor]
    Dialogues          Transcript              Result
    ID / language      numbered turns          AI and final scores
    list and search    audio link for calls    criterion / evidence / appeal
```

The model sees the configured rubrics and transcript, including bot and system events as context. It does not receive the conversation ID, prior judgments or labels. The code assigns points and flags from the answers. It uses exact fractional arithmetic before rounding totals and normalizes to 100 over applicable positive weight, including when an edited rubric has a different total configured weight. Sections show their earned points and maximum after redistribution. A saved run retains its own rubric so later edits do not change it. Each review decision records the final answer and reason separately.

The user supplied six Freedom app screenshots and asked for fewer visible words and cells while preserving the challenge workflow. The current UI keeps the blue palette and three views: **Диалоги**, **Оценка**, and **Чек-лист**, now represented by animated icon-only navigation with accessible names and one sliding indicator. The latest dialogue view is a curved carousel of blue-glass paper cards, with previews, language-only metadata, scores, search, and all/unscored/AI-critical filters. Primary import stays visible; batch import and synthetic examples are in **⋯**. Clicking any visible paper opens that dialogue's detail page. On desktop it shows chat bubbles beside the assessment. On phones, **Переписка / Оценка** switches between them and the main navigation is fixed at the bottom. Criterion reasons, evidence and appeals expand on demand. Run hashes and section totals are in **О запуске**. The original AI and final totals remain distinct. No bank products, payment functions, or chat composer were added from the references.

The user approved the simplified blue layout and crown background at commit `651eda9`, preserved on `checkpoint/blue-app-2026-11-08`, before requesting the F-and-coins experiment. The current `web/brand-orbit.js` background renders actual extruded 3D F and coin geometry, with GLB assets and a vector loading fallback. Eleven coins stamped with ₸, $ and € orbit with depth ordering; all orbit paths and trails are invisible. The F gently floats, turns and breathes, with a light sweep over the shield. Pointer movement and background dragging affect orientation; click/Enter sends a wave and briefly increases coin speed. The scene stays at the bottom right in the lowest layer beneath the app, visible through its glass surfaces. The crown/equation, animation stop control and numbered section labels are absent. Page fade, ASCII headings, word-print reveal and separate profile/headset/quality icon loops remain active.

Qwen3-4B Q4_K_M is the initial local model candidate. The engine requests schema-constrained JSON, retries an invalid judgment once, and reports an error if it still cannot validate it. Bounds validation ensures referenced turns exist. Human review still needs to check whether a cited passage supports the decision. Current calls are scored from transcripts. Audio is a playback link. The demo uses browser-local storage for data, rubrics, runs and appeals. Team collaboration here is shared source code through GitHub. App state lives in each browser profile.

## Simplified app verification

The user approved this layout before requesting the F-and-coins experiment. The approved crown background and grouped app are preserved on [checkpoint/blue-app-2026-11-08](https://github.com/lalob1/cqa-hackathon/tree/checkpoint/blue-app-2026-11-08). [UI_CHECKS.md](UI_CHECKS.md) records the requirement checks: 13 passing Python tests, all 65 DEV imports, a 115-turn call, evidence jumps, an appeal from 93.75 to 81.25, a live edited-rubric run with eight judgments in 130.713 seconds, history after reload, and 15 view/width combinations between 320 and 1440 px without horizontal overflow or browser JavaScript errors.

## F-and-coins experiment verification

- Chrome verified the supplied SVG loaded, and captured 90 F render transforms in three seconds. Translation and rotation changed, confirming that the F itself moves. The native background kept rendering under reduced-motion emulation, as the user had explicitly requested continuous animation.
- Background drag and keyboard activation ran; the Enter action produced the expanding pulse. Fifteen view/width combinations (320, 390, 768, 1024 and 1440 px) fit without horizontal overflow. No browser JavaScript errors occurred.
- A three-second local Chrome sample measured script time at about 5% of one core, compared with approximately 15% in the earlier crown sample. This is one local observation rather than a low-end-device benchmark. No new runtime dependency was added.
- The current outputs include desktop and mobile PNG previews, `CQA_F_Mark.svg`, a six-second `CQA_F_Coins_Motion.gif` screen capture, `CQA_Blue_App_Checkpoint.png`, `CQA_Blue_Chat_Checkpoint.png`, and the refreshed standalone `CQA_AGENT_HANDOFF.md`. The GIF is a preview capture; the site renders continuously and never loads it as an animation asset.

## Extruded 3D F checkpoint

The user approved the 3D F before requesting true 3D coins. This state is preserved on `checkpoint/3d-f-2026-11-08`. The F is a 334-triangle, 20,068-byte GLB with a thick shield, beveled edges and a raised letter. `web/f-model.json` supplies the same geometry to the native projected-mesh renderer; `tools/build_f_model.py` rebuilds both exports from `web/f-mark.svg`. The browser applies perspective, back-face culling, depth sorting, surface normals and lighting. It permits full background drag rotation and retains gentle automatic float and turn. A Chrome check verified 118 surfaces, 0.225 model-depth span, changing projected caps, drag, keyboard pulse, five viewport widths and zero JavaScript errors. A three-second local sample measured about 5% script time on one core. The GLB header, six materials and unit normals were independently checked.

## True 3D coin checkpoint

Before the user requested hiding their paths, the approved 3D coins are saved on `checkpoint/3d-coins-with-orbits-2026-11-08`. `tools/build_coin_models.py` builds three beveled, reeded cylinder meshes with raised symbols on both faces: tenge (500 triangles, 29,960-byte GLB), dollar (1,012 triangles, 53,232-byte GLB), and euro (908 triangles, 48,764-byte GLB). The native renderer loads `web/coin-models.json`; the reusable exports are `web/coin-tenge.glb`, `web/coin-dollar.glb`, and `web/coin-euro.glb`. The F model bytes remain identical to its approved checkpoint. A Chrome check verified both symbol faces, depth spans of 0.386–0.392, continuous painted mesh surfaces, drag and keyboard pulse, five viewport widths, and zero JavaScript errors. The local three-second sample painted 68 scene frames and reported about 8% script time on one core; this is not a low-end-device benchmark. Fully covered coin meshes are skipped behind opaque app cards.

## Cleaner dialogue list and invisible paths

The user approved hiding the coin orbit lines. The current renderer draws neither orbit guides nor coin trails; orbital positions and 3D rotation remain active. The user then requested removing list clutter. The dialogue heading has no count, aggregate scored/AI-error totals are removed, upload is a 44 px icon with an accessible file-input label, healthy scores have no Оценён caption, and row/transcript metadata contains only RU, KZ or EN. Critical warnings and the critical-only filter remain. Chrome verified native file upload, an unchanged 93.75 score, language-only metadata, square upload controls at 320/390/1440 px, no horizontal overflow, and no JavaScript errors. This state is preserved on `checkpoint/clean-dialogues-2026-11-08` before the startup-screen experiment.

## Current startup screen and branding

Every visit opens the welcome screen, including a first visit that seeds the three synthetic examples. The green F is rendered from visible ASCII characters using the approved 3D geometry. The startup title and entry caption are visually removed; a 56 px arrow-only button has an accessible name and opens the existing app. The top-left brand is a larger, deep-blue animated ASCII **Democrats** wordmark. The duplicate team name on the right is removed; the model status remains.

The final hover behavior is a brief outward scatter followed by a direct return to each character's live position, taking about 0.75–0.855 seconds. Keep this behavior; the later request reverted the longer particle-orbit experiments. Drag still tilts the F, and clicking or pressing Enter produces a light pulse.

Entry brightens and disperses the ASCII mark for 1,250 ms on a dedicated canvas fixed to the entire viewport at z-index 100. The release uses staggered character timing, a gentler drift and extra fine glyph particles. The overlay preserves the F's original screen position and lets characters travel beyond the logo widget. It is removed when the dialogue view opens; the app then fades/slides into view over 540 ms. The coin background pauses on startup and resumes after entry. The ASCII hero pauses after leaving startup. Both scenes pause in hidden tabs; the compact header wordmark remains animated whenever visible.

Chrome verified changing ASCII output, hover character release and complete return, the icon-only entry control, keyboard operation, an overlay matching the full 1440×960 viewport, particles outside the original logo bounds, overlay cleanup, and successful entry. First-visit examples and existing browser data survived the flow. Startup fit 320, 390, 768, 1024 and 1440 px; the arrow stayed above the fold. No browser JavaScript errors occurred.

Current deliverables in the original workspace's `outputs/` directory:
- `CQA_Welcome_Preview.png`, `CQA_Welcome_Mobile.png`, `CQA_Welcome_Hover.png`, `CQA_Welcome_Transition.png`: current startup, scatter and full-screen transition.
- `CQA_ASCII_Welcome.gif`: five-second browser capture of the current startup and entry, using three synthetic examples.
- `CQA_Desk_Preview.png`: current clean dialogue list and 3D background.
- `CQA_3D_Models.zip`: F and the three reusable self-contained GLB coin models, with their README.
- `CQA_AGENT_HANDOFF.md` and `CQA_UI_Checks.md`: standalone handoff and checks.
Earlier crown, blue-app and 2D F previews are historical checkpoints. In particular, `CQA_F_Coins_Motion.gif` is the earlier 2D preview rather than the current 3D/startup implementation.

## Component motion and blue text

The interface copy now uses a subtle blue tint (`#d5e6ff`), with a slightly stronger blue heading (`#b8d7ff`). Green ASCII art and semantic status colors retain their purpose. Navigation has three raised animated icon tiles: speech-bubble motion for Диалоги, a drawing checkmark for Оценка, and staggered checks for Чек-лист. Dialogue tiles, the upload arrow, filter chips, editor fields, criterion details and the import menu have hover, press or reveal motion. The user requested continuous motion; no stop-animation control is present. Chrome found seven running infinite nav animations, verified the checklist reveal and slower entry, and checked all three app views at 320, 390, 681, 768, 1024 and 1440 px without horizontal overflow or JavaScript errors.

## Prominent ASCII headings

The user requested more visible, hero-style treatment for **Аудит диалогов** and **Диалоги**, including ASCII lettering. Both app headings now use dense, brighter blue glyphs with a restrained blue glow. The main title has a larger display area and a softly lit underline. At narrow widths it renders on two lines. The dialogue section heading is larger and stays on the same row as the upload control, including at 320 px. The approved startup screen still shows only the green ASCII F and arrow.

The shared renderer in `web/ascii-titles.js` uses one 24 fps loop, caps DPR at 1.5 and pauses when headings are hidden or the tab is hidden. It keeps stable letter silhouettes while characters shuffle and a light sweep moves through them. Pointer movement adds local illumination. Accessible heading names and plain-text fallbacks are retained. The main title no longer uses the earlier word-print wrapper; the quality heading still does.

Chrome verified both headings had visible bright-blue pixels, changing animation output, exactly one accessible heading for each name, no rendering behind startup, and same-row upload alignment at 320, 390, 681, 768, 1024 and 1440 px. No horizontal overflow or JavaScript errors occurred. The two console advisories came from the QA pixel-readback probes.

## Sliding navigation and dialogue glass

The selected navigation background is one persistent `.nav-selection` element beneath the three primary buttons. It travels and resizes between **Диалоги**, **Оценка**, and **Чек-лист** over 420 ms with an ease-out curve. Rapid taps begin from the bubble's current interpolated position. View changes, including opening a dialogue from the list, update the same indicator. Resize and font readiness snap its geometry to the active button so it stays aligned when navigation moves to the bottom on phones. The indicator is decorative; button labels, focus and aria-current remain intact. Hover does not create a competing second bubble.

The dialogue list, search field and filter chips now have blue liquid-glass styling: translucent gradient surfaces, frosted backdrop blur, luminous edge highlights and restrained inset reflections. The list uses a 20 px blur and 135% saturation. CSS provides opaque fallbacks where backdrop filters are unavailable. The transparent dialogue list is excluded from opaque-card coin culling, so the moving F and coins remain visible through its glass.

Chrome observed the same bubble element at intermediate positions on all three routes, verified rapid retargeting and keyboard activation, checked programmatic navigation from a dialogue row, and confirmed final alignment at 320, 390, 680, 681, 768, 1024 and 1440 px. The two breakpoint sides were included because navigation moves from the header to the bottom bar. Search still filtered by language. There were no JavaScript errors or horizontal overflows. Desktop, mobile and checklist/review previews were refreshed.

## Frontend after the SQLite update

The compact toolbar combines search, one five-option review filter, and the import controls. The paper carousel and icon navigation remain. Cards and detail pages read the same latest saved run, with separate original and final flags. Reimporting an older score preserves server history order. An unavailable history endpoint leaves the cached workspace accessible, reports the error on startup, and supports a retry through the menu. The normal preview at `http://127.0.0.1:18770/` was restarted against the new API. See [UI_CHECKS.md](UI_CHECKS.md) for current verification.

## Verification and limits

### Curved paper dialogue browser

The grouped list was checkpointed at `checkpoint/blue-glass-polish-2026-11-08` (`edcf7a6`) before this experiment. The new reference-inspired browser arranges portrait blue-glass papers on an arc, with the ASCII **Диалоги** heading centered beneath it. Each paper keeps its real conversation ID, first-client preview, language and saved score/critical warning. Clicking a center or side paper opens the existing full detail view; the back control preserves the chosen paper.

Use the mouse wheel over the papers, horizontal mouse/touch drag, previous/next controls, or keyboard arrows/Home/End to browse. Clicking a pagination dot selects a paper. Wheel gestures are throttled, drag release suppresses accidental clicks, and only the current paper is in the keyboard tab sequence. At most seven papers and seven dots are visible for larger collections. Search/import/filter changes rebuild the carousel through `cqa:records-change`; no transcript content or scoring logic is changed. The three main navigation captions are visually hidden; animated icons, native title tooltips, accessible names, focus and the sliding bubble remain.

Chrome verified wheel/keyboard/mouse-swipe browsing, direct side-paper opening, return selection, language/empty/pending/critical filters, normal transcript and score imports, the preserved 93.75 total, eight criteria and evidence jumps. Native touch emulation confirmed a swipe changes the paper without opening it. The controller ignores the old paper's bubbling lost-capture event when touch capture transfers to the deck. A 78-record synthetic collection reached its last paper correctly with bounded visibility/pagination. All three views and the navigation indicator fit 320, 390, 680, 681, 900, 1024 and 1440 px without horizontal overflow or JavaScript errors. The checks made zero live scoring calls.

The blue-glass polish adds consistent gradients/rims to navigation, primary and secondary controls, reading panels and checklist fields. Pointer-local list reflection is throttled to one scheduled frame and resets on leave/view change; it does not create an idle render loop. Chrome verified reflection cleanup, empty search, the import menu, keyboard field focus, phone review tabs and all three views at seven widths (320–1440 px), without overflow or JavaScript errors. The previous shared-bubble checks also passed. [DESIGN.md](DESIGN.md) records the visual system. [ANSPHARE_SKILLS.md](ANSPHARE_SKILLS.md) records the requested downloads and sign-in requirement; these files have not yet been installed.

- Run `python -m unittest discover -s tests -v` and `node --check web/app.js`. Both passed with thirteen automated tests. The API and browser accepted all 65 DEV records.
- The original Chrome smoke test used Qwen3-4B Q4_K_M through llama.cpp Vulkan build 11719. A fresh synthetic RU chat returned all eight judgments in about 38 seconds. The evidence link highlighted the referenced turn. A test appeal preserved the 100.00 original and changed the final to 92.31. The rubric editor saved an added criterion, and both scores survived reload. See the later V4 run below for full DEV scoring and long-call performance. Ollama itself was untested in this environment.
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

Control scoring requires the organizer's 10 transcripts or the assigned control group. The organizer holds the Ground Truth for judging. The commands are in [README.md](README.md#контрольный-запуск). Before the code freeze, run the full control batch, verify the ten original IDs and an empty error list, rehearse the five-minute flow with the replacement criterion, and record the commit and model revision. Public submission requires the organizer's submission channel and the team's decision to publish.

A ten-chat synthetic rehearsal used the same live Qwen V4 and the release scorer and exporter. It completed in **2 min 27 s**, produced **10 rows and 80 criterion judgments with zero errors**, and preserved every ID and evidence turn bound. Resuming the run reused all ten scores. The rehearsal stayed under the local `../control-rehearsal/` directory. Its short test conversations establish that the run and export work. Official timing and accuracy depend on the organizer's transcripts.

## Compact scoring experiment

`model/compact-transcripts` changes the prompt version to `cqa-rubric-v4`. It uses compact turn arrays and elapsed seconds for chronologically ordered call timestamps. The UI, evidence turn numbers, transcript fingerprints, and original source times stay available. For calls with timestamps that cannot be parsed in order, the model receives the source times. The candidate also caps explanations and generation length, uses a small repetition penalty, and clarifies consultation, closing, and paid off-company offers.

The four-record live probe completed with valid results for the previously timed-out Kazakh chat, the missed English paid advice offer, a Russian farewell-only chat, and the 115-turn call. The English paid offer was flagged. Local inputs and results are `../dev-compact-probe-input.json` and `../dev-compact-v4-probe.json`.

### Verified V4 DEV run

- Qwen3-4B Q4_K_M processed all **65/65** records from the supplied attachment, including **60 chats and five calls**, with no failures. Verification matched the dataset hash, checked the stored rubric and transcript hashes, and recalculated all totals from the 520 judgments. The median response time was **10.87 s**, the maximum was **34.15 s**, and the 115-turn call completed in **10.35 s** in the full run.
- Runtime on the original laptop was llama.cpp Vulkan build 11719 on the RTX 3050 Laptop GPU with 4 GB VRAM. The run used `-c 12288 -np 1 --jinja -ngl 99 -fa on -ctk q8_0 -ctv q8_0`. The failed CUDA V3 call and the successful Vulkan V4 call differ in both runtime and prompt. The tokenizer comparison above isolates the reduction in prompt input size.
- Isolated Chrome verified live replacement of one criterion, a fresh V4 run, an evidence jump to the cited operator turn, and an appeal that changed the synthetic total from **100.00 to 93.75**. The prior rubric remained accessible in history. Both scores survived reload. The browser imported all **65** CLI results, then restored them after reload. It also showed the recording link for an imported call and fit the workspace into a 390 px viewport.
- In the redesigned CQA Desk, the synthetic RU example scored **93.75** live. Its consultation evidence highlighted turns **2–4** and matched the turn strip. Verified the scoring animation and reduced-motion behavior in Chromium, checked 1,280 px desktop and 390/358 px mobile widths, and imported the full DEV checkpoint. The critical-only filter listed **4** cases, and the count survived reload.
- Chromium verified the one-time page fade, autoplay, the three role animations, and the header score against an imported evaluation. Consultation evidence highlighted the same three turns in the transcript and turn strip. The layout fit widths from 320 to 1,440 px.
- Chromium verified the heading print on entry and mouse hover, a single accessible title, a cyan comet moving across the backdrop, and matching scores and evidence highlights after importing the synthetic rehearsal. The blue workspace fit desktop and phone widths.
- On 12 DEV chats with provisional assistant judgments, total-score MAE was **8.62/100**. Exact agreement was **11/12** for identity, **11/12** for critical flags, **7/12** for consultation, **6/12** for needs, and **5/12** for closing. The reviewed Kazakh account disclosure was missed in both the identity and critical judgments. On the five overlapping records, V3 MAE was **6.45** and V4 MAE was **8.03**. V4 improved critical flag agreement from **4/5 to 5/5** on that subset and completed the full workload. Ground Truth accuracy awaits organizer labels.
- The full results and aggregate checks are local at `../dev-full-v4.json` and `../dev-full-v4-audit.json`. The two provisional reference sets and rationale files are `../dev-review-six-labels.json`, `../dev-review-six-notes.md`, `../dev-safety-six-labels.json`, and `../dev-safety-six-notes.md`.

### TwIL-8B comparison

The official balanced Q4_K_M artifact from revision `58d49f0d9909e62f9c2fb09e99fc5c76f3f2d630` was downloaded and verified against SHA-256 `17bda82d2608ca61b6aca48394f212349ef1515d0d9a2e6edee06619152faa0e`. The file is 4.98 GiB. On this 4 GB GPU the model ran in llama.cpp Vulkan build 11719 with 19 layers offloaded and an 8,192-token context. The publisher identifies English and reports high-effort reasoning benchmarks. The local test used the same V4 checklist, constrained output, and thinking-disabled setting for both models. The weights are available under the publisher's non-commercial research and education terms. [Model card](https://huggingface.co/webAI-Official/TwIL-8B) · [License](https://huggingface.co/webAI-Official/TwIL-8B/raw/58d49f0d9909e62f9c2fb09e99fc5c76f3f2d630/LICENSE.md)

| Consultation case | Expected | Qwen3-4B V4 | TwIL-8B balanced |
| --- | ---: | ---: | ---: |
| RU tariff question answered | 20 | 15 | 20 |
| RU greeting only before disconnect | N/A | 5 | N/A |
| KZ password request unanswered | 0 | 5 | 10 |
| EN statement request answered | 20 | 20 | 20 |

Both produced four valid runs. TwIL matched **3/4** consultation levels versus Qwen's **1/4**, with median response time **159.40 s** versus **9.85 s** on the laptop. Keep the Qwen configuration as the current 65-record verified submission workflow. The four synthetic cases provide a reason to investigate TwIL further on adjudicated data. Local paired outputs are `../qwen-v4-consultation-pair.json` and `../twil-v4-consultation-pair.json`.

## Organizer Q&A and submission

- `Democrats` is the registered team name supplied by the user. The appendix requires `results/dev/results.json` for **60 chats and five calls** and `results/prod/results.json` for **10 control chats**. Each uses schema version `1.0` with the source conversation IDs, the organizer's eight criterion IDs, true/false/null or the numeric scale level, rationale, original 1-based evidence turns, total, and separate critical flag. A failed transcript retains its ID with an explicit error. Appendix pp. 1–3 and Q&A message **#3042**.
- The organizer says the same API will provide PROD when released and keeps the Ground Truth. Control is chats only. Criterion answers are compared, with broader review of plausibility, workflow, usability, and architecture. The selection formula is private. Q&A messages **#2319**, **#2966**, **#2978**, **#2981**, and **#3004**.
- The organizer confirmed N/A for needs when the customer already provided enough information, including context given to the bot. The interpretation for simultaneous identification and confidentiality failures was left to the team. The checklist text remains the reference for closure. The call contact replies allow transcript-based adaptation, while the appendix lists only true/false for `contact`. The current DEV export follows the appendix's binary contact type. Q&A messages **#2814**, **#2978**, **#3024**, **#3075**, and **#3106**.
- The call audio is an additional review source. Speech recognition and acoustic scoring are optional, and the admin specified no call hold-time norm. Hosting is optional. The demo must be interactive and the selection submission goes through Git. Q&A messages **#2729**, **#2815**, **#2826**, **#2838**, **#2968**, **#2991**, **#3106**, and **#3114**.
- The appendix places the PROD release one hour before code freeze and requires the results to be pushed to the open repository by that cutoff. The supplied export includes neither the actual PROD group value nor the final channel for sending the team name and repository URL. Q&A messages **#3026**, **#3031**, and **#3042**.
- The new `batch.py export` command verifies the complete checkpoint against the source dataset and default rubric, then writes the appropriate results file. The DEV file for `Democrats` passed an independent schema, ID, value type, evidence range and critical flag check with zero error rows. The output contains criterion rationales and turn numbers. The raw chat export, transcripts, audio links and signed credentials remain local. The UI filter **Ошибки ИИ** lists cases flagged in their latest AI run for the live demo.

## Parallel work plan

The low-spec laptop can handle browser QA, independent rubric review, and appeal testing. Run `python app.py` with Python 3.10+ and import the matching transcript file and internal scoring checkpoint in that order. Live inference and the official control export can run on the team's verified Qwen machine. In isolated Chromium with the model disconnected, ten synthetic evaluations imported, an evidence jump worked, and a reviewer decision changed the final score from **93.75 to 81.25**. The original stayed at **93.75**, the decision survived reload, and the browser made zero scoring requests.

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

The latest local preview is at `http://127.0.0.1:18770/` on the original machine. It uses the Qwen runner at port 18880 with context 12288, one slot, Vulkan offload and Q8_0 KV cache. Both were left running for review. The official DEV export was generated from `../dev-full-v4.json`. The control run needs the actual 10 transcripts or the assigned control group.

On 8 November, the running model timed out during a synthetic check. Restarting the idle service with the same weights and settings restored a valid eight-criterion result for `sample-ru` in **53.48 s**, including all evidence bounds. This check used a warm model and was slower than the earlier rehearsal. Use the documented control timeout and watch the per-dialogue checkpoint when the real set arrives. The timing summary is local in `../release-scorer-smoke.json`.

### Resume commands

```powershell
git clone https://github.com/lalob1/cqa-hackathon.git
cd cqa-hackathon
git switch model/compact-transcripts
python -m unittest discover -s tests -v
ollama pull qwen3:4b
python app.py
```

For model runtime details, use the [Ollama Chat API](https://docs.ollama.com/api/chat) and [llama.cpp server reference](https://github.com/ggml-org/llama.cpp/tree/master/tools/server). For repository access, use [GitHub’s collaborator instructions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository).
