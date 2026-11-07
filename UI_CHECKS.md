# Approved blue app checkpoint

Verified 2026-11-08. Saved before the F-and-coins background experiment on branch [checkpoint/blue-app-2026-11-08](https://github.com/lalob1/cqa-hackathon/tree/checkpoint/blue-app-2026-11-08). The earlier hero-crown version is on [checkpoint/crown-layout-2026-11-08](https://github.com/lalob1/cqa-hackathon/tree/checkpoint/crown-layout-2026-11-08), commit `f5465b9`.

The user approved a simpler app inspired by the supplied Freedom mobile screenshots: one grouped dialogue list, rounded blue surfaces, chat bubbles, three navigation destinations, and details revealed when needed. The crown and equation occupy the lowest background layer. The references informed hierarchy and spacing; banking products, payments, advertisements and a message composer were not added.

| Requirement | Verification |
| --- | --- |
| Import RU/KZ/EN transcripts and original IDs | Imported all 65 DEV records alongside 13 synthetic records. Language search returned only matching rows. |
| Calls and source timestamps | The 115-turn call retained all 115 turns. Its HTTPS recording link remained accessible. Audio playback itself was not tested. |
| Default eight criteria, weights, scales, N/A, separate critical flag | Eight rows and N/A answers displayed; score calculation remains covered by backend tests. The AI-critical filter returned five rows in the combined synthetic/DEV review. |
| Edit and apply the checklist | Changed one rule and its weight in the UI; a real local Qwen run returned the exact changed rubric and eight judgments. The model took 130.713 seconds on this run. |
| Evidence | Consultation links highlighted cited transcript turns and matching timeline segments. |
| Appeals and original/final totals | A synthetic appeal changed 93.75 to 81.25 while preserving the original 93.75. |
| History and saved rule versions | Both original and edited-rubric runs remained selectable after reload, including the earlier appeal. The default rubric was restored afterward. |
| Saved batch import | Imported ten synthetic scores and the 65-record DEV checkpoint through the normal API validation. |
| Clear navigation and responsive layout | Dialogue, review and checklist views fit 320, 390, 768, 1024 and 1440 px with no horizontal overflow. Phone chat and score tabs showed the appropriate panel. |
| Animation and interaction | Canvas rendered beneath the app at z-index 0; app content was at 1. Dragging and keyboard activation ran without an error. Page fade, word printing and role-icon loops remained. |
| Runtime checks | 13 Python tests passed; all three JavaScript entry points passed syntax checks; no browser JavaScript errors occurred in either workflow check. |

A three-second Chrome sample measured script execution at about 15% of one core's time for the crown version on this machine. It is capped at 30 fps and DPR 1.5, and pauses while hidden. This is a local observation, not a low-end-device benchmark.

Organizer Ground Truth and the ten official control chats are still unavailable. These checks establish working UI flows, not competition accuracy. Phone checks used Chrome viewport emulation.

## Current F-and-coins experiment

The approved application layout is retained. The crown and equation are replaced with a transparent vector F shield and eleven metallic coins on three inclined orbits. The F has its own float, turn, breathing scale and clipped light sweep. The background stays at z-index 0 and the app at 1. Dragging rotates the orbits; click/Enter produces a wave and a temporary speed increase.

A further Chrome check captured 90 changing F transforms in three seconds, verified keyboard pulse drawing and continuous autoplay, and repeated all three views at the five widths above. No JavaScript errors occurred. A local three-second script-time sample was approximately 5% of one core; no new runtime library was added. The six-second motion GIF is a browser capture for review.

## Current startup, wordmark and cleaned list

The current entry screen has an interactive green ASCII F and an arrow-only entry control. Its visible title and button caption are removed. The header uses a larger animated deep-blue ASCII Democrats wordmark on the left. Hovered characters scatter briefly and return in about 0.75–0.855 seconds. The longer orbit experiments were reverted.

A targeted Chrome check verified character release and return, animated wordmark pixels, keyboard activation, a full-viewport dissolve layer with characters outside the original widget, overlay cleanup, entry to the existing workspace, first-visit examples, and preservation of stored data. The welcome and app backgrounds alternate rather than rendering together. Widths 320, 390, 768, 1024 and 1440 fit; the entry arrow stayed above the fold. No JavaScript errors occurred.

The dialogue heading has no count, scored/AI-error aggregate totals are removed, upload is an accessible 44 px icon, healthy scores have no Оценён caption, and metadata shows only the language. Native upload worked and the 93.75 test score stayed unchanged. Critical warnings and filtering remain.

The F and all three coin types now use actual extruded geometry. Model data, GLB headers and unit normals were checked. The 3D coin browser sample reported about 8% script time on one local core. The current coin paths and trails are invisible.

The final entry dissolve is 1,250 ms, followed by a 540 ms workspace reveal. It uses staggered drift and extra fine particles. A later Chrome check found seven running nav animations, confirmed animated checklist opening and soft-blue copy/heading colors, and verified three app views at 320/390/681/768/1024/1440 px without overflow or JavaScript errors.

## Bright ASCII headings

Аудит диалогов and Диалоги now render in larger, brighter blue ASCII lettering with glow, a moving highlight and stable letter shapes. The main title wraps into two lines on narrow screens. Accessible heading names and a readable text fallback remain.

A targeted Chrome check verified animated blue pixels in both headings, one accessible heading for each title, no title rendering on startup, same-row upload alignment, and no horizontal overflow at 320, 390, 681, 768, 1024 and 1440 px. No JavaScript errors occurred. Pixel readback during QA generated two Chrome performance advisories; normal rendering does not perform those repeated title-canvas readbacks.

## Shared navigation bubble and liquid glass

A single persistent indicator glides between all three primary tabs in 420 ms. Chrome verified intermediate travel, element identity, rapid-click continuity, keyboard selection, programmatic selection after opening a row, and settled alignment at 320, 390, 680, 681, 768, 1024 and 1440 px.

The dialogue list, search and filter chips use translucent blue glass with backdrop blur, bright rims and subtle reflections. The list computed blur(20px) saturate(1.35) and translucent gradient stops at alpha 0.64/0.72. Coin rendering no longer treats the glass list as opaque. Language search worked; no horizontal overflow or JavaScript errors occurred.
