# Vendored: diagram-design

- Source: https://github.com/cathrynlavery/diagram-design (MIT, Copyright (c) 2025 Cathryn Lavery), `skills/diagram-design/`
- Commit: f6db0decea96de66b901331a0f79a8d4b147ebae (2026-11-17)
- Used by `cli/src/picture.ts`: every card's picture is drawn by an agent following this skill.

## What we kept

`SKILL.md`, the drawing references (types, primitives, layout, style guide, output spec, semantic patterns), `assets/template.html`, `assets/template-dark.html`, the light `example-<type>.html` files, and `scripts/self_check.py` + `scripts/verify_geometry.py`.

Left out: importers (draw.io, Mermaid, Excalidraw, PlantUML), exporters, onboarding, profiles, doctor, motion, the terminal skin and the icon set.

## What we changed

- `references/style-guide.md`: the semantic-role table now holds the Chompyy skin (light and dark), with a note at the top. Contrast checked to WCAG 4.5:1 for every text role.
- `assets/template.html`: the same colors.

Re-sync monthly: diff upstream `skills/diagram-design/` against this folder and re-apply the two changes above.
