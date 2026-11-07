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
