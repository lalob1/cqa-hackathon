# Democrats interface

## Direction

A blue, retro-terminal audit workspace with an interactive green ASCII F at entry, animated ASCII branding, and physical depth in the background. Keep the approved identity while simplifying the evaluation workflow. Use Russian interface copy, with RU/KZ/EN transcript support.

## Visual system

- Background: navy `#081327`, a quiet 36 px grid, blue illumination at the upper right.
- Copy: `#d5e6ff`, muted `#a8bed9`, accent `#9ed8ff`. Keep scores legible over motion.
- Surfaces: opaque `#172f4e` / `#102744` for long-form reading and editing. Dialogue browsing uses translucent blue glass, 20 px backdrop blur, and a luminous thin rim.
- Corners: 24 px cards, 12–18 px controls, pill filters. Every primary action has a 44 px minimum target.
- Typography: retain the existing Segoe UI body and monospace metadata for continuity; display identity is rendered as ASCII with accessible text names and fallbacks.
- Motion: 420 ms shared navigation indicator, 180–220 ms control transitions, 1,250 ms full-viewport entry dissolve. Preserve the accepted brief hover scatter and direct return of the F's glyphs.

## Interaction

Primary views are Диалоги, Оценка, and Чек-лист. Phone navigation sits at the bottom. Phone review separates Переписка and Оценка; desktop shows transcript and assessment together. Preserve imports, editable criteria, N/A, independent critical flags, evidence jumps, original/final totals, appeals and run history.

Hover effects support the content. The dialogue glass reflects a mouse-local light using one scheduled frame per pointer update; it has no idle frame loop. Decorative layers never receive pointer events. Visible keyboard focus remains available throughout.

## Constraints

No frontend dependencies, remote fonts, or media downloads at runtime. Pause canvas rendering on hidden views/tabs and cap resolution. Never add animation toggles, headline counts, redundant score labels, numbered sections, or bank marketing copy that the user removed.

Skill sources and pending installation are documented in [ANSPHARE_SKILLS.md](ANSPHARE_SKILLS.md).
