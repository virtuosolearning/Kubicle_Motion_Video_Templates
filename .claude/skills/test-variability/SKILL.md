---
name: test-variability
description: Render up to five 15-second variations of a single Remotion scene to stress-test how it copes with different valid prop combinations (varied label lengths, punctuation, icon silhouettes, timing overrides, and graceful-fallback paths). After rendering, write a short inconsistency report flagging dead props, missing assets, or schema/code mismatches found in the scene. Use when the user invokes /test-variability, asks to "test variability", "see how a template handles different content", "make variations" of a template, or stress-test a scene's prop space. Sibling skill to test-template: where test-template makes one duration-swept render, this maps the prop space at 15 s. When invoked across all templates (`/test-variability all`), append a fleet comparison report.
---

# /test-variability

Render **up to five 15-second MP4s** of a single Remotion scene, each driven by a *different* valid prop combination, then produce a short report on any variability gaps or inconsistencies discovered in the scene's schema / asset set / code.

Where `/test-template` answers "does the animation feel right across short / normal / long durations?", this skill answers "does the scene's *layout and fallback behaviour* hold up across the full space of inputs its props claim to support?".

## Input

Same shape as `/test-template`:

- A folder under `scenes/` (e.g. `scenes/BigPoints3V1/`) or a direct path to the `.tsx` file.
- The literal token `all` (or `--all`) → iterate over every folder under `scenes/`. See [Multi-template mode](#multi-template-mode).
- If invoked with no path, list the folders under `scenes/` and ask which template.

Optional extras the user might pass:

- A specific count (e.g. `/test-variability scenes/Foo 3`). Honour it — trim from the bottom of the priority list ([§ The 5 variation slots](#the-5-variation-slots)). If they specify >5, still apply the confirmation step.
- A specific axis to focus on (e.g. "really push the icon variety"). Bias your chosen variations toward that axis.

## Output

For each variation, an MP4 at:

```
~/.cache/claude-remotion-bench/test-renders/<template-name>/variability-<slug>.mp4
```

`<slug>` is a short kebab-case name describing the variation (`baseline`, `content-extremes`, `continuous-sweep`, `shifted-stops`, `icon-fallback`, …). Names should mean something when the user is scrubbing through them in Finder.

After all renders finish:

1. `open` the output folder so the user can play them side by side.
2. **Print an inconsistency report** to the chat (see [§ Inconsistency report](#inconsistency-report)).

For multi-template mode, also print a **fleet comparison report** ([§ Multi-template mode](#multi-template-mode)).

**Nothing goes in the user's repo.** Same rule as test-template.

## The 5 variation slots

This skill targets **5 specific slots**, in priority order. Drop from the bottom if the schema doesn't support an axis, or if the user asked for fewer renders.

| # | Slug | What it tests | When to skip |
|---|---|---|---|
| 1 | `baseline` | The "is it broken at all?" anchor. Mid-length labels, common-domain content, default timings. Mirror the meta's authoringNotes examples. | Never skip. |
| 2 | `content-extremes` | Bundles four axes in one render: short label (≤5 chars or a few-glyph token), mid label, max-length label; one label with punctuation/digits ("24/7 support", "$10/mo", "10×"); three icons with visibly different silhouettes (narrow / tall / detailed). | Skip if the scene has no `points`/list-style prop and no icon input. |
| 3 | `continuous-sweep` | Timing override: disable narrator pauses where the scene supports them (e.g. `barPauseDuration: 0`) and tighten the overall sweep so the animation still finishes inside 15 s. Tests the no-pause feel. | Skip if the scene has no `timings` field, or if its timings schema doesn't include pause-style fields. |
| 4 | `shifted-stops` | Timing override: keep pauses on but reposition them (e.g. `barPauseStops: [20, 80]`). Tests reveal cadence at unusual positions. | Skip if there's no analogous "stops" field. |
| 5 | `icon-fallback` | One slot deliberately set to a non-existent icon id (e.g. `not-a-real-icon`) alongside two valid ones. Verifies graceful empty-column degradation looks acceptable. | Skip if the scene has no icon-id string in its schema, or if its code throws (rather than falls back) on unknown ids — a finding worth reporting either way. |

**Default target: as many of the 5 as the schema supports, capped at 5.** For a richly-parameterised scene like BigPoints3V1, that's all 5. For a scene with no `timings` prop, that's 3 (`baseline`, `content-extremes`, `icon-fallback`). For a scene with neither timings nor icons, that's 2 (`baseline`, `content-extremes` with content-only variation).

**Hard rule: if your proposed count exceeds 5, stop and use `AskUserQuestion`.** Phrase the question with 2–4 concrete trim-downs of *your* proposed list (not abstract advice). Never just "are you sure?".

**Soft rule: 4 is often the right answer.** Drop `icon-fallback` first if the scene's fallback behaviour is obviously safe (graceful degradation already verified visually elsewhere).

## Workflow

### 1. Static analysis of the .tsx — before any rendering

Read the scene file end-to-end. Extract:

- **Schema(s)** — every `z.object`, `z.string().max(N)`, `z.array(...).min(M).max(N)`, `.optional()`, and any sub-schema referenced from the top-level one.
- **Authoring notes** — the `*Meta.authoringNotes` string. Mirror its style. Watch for claims like "available_icons" that hint at a catalogue beyond what's shipped in the folder.
- **`staticFile(...)` references** — list every asset path the scene resolves. You'll need to mirror them under `public/` (see § 3 below) and flag any that don't exist locally.
- **Dead props** — any schema field that doesn't appear to be read by the component, or is overridden unconditionally inside the render (e.g. `pillStarts` in BigPoints3V1 is masked by `PILL_ARRIVAL = COL_ARRIVAL`). Add to the inconsistency report.
- **Icon catalogue** — if the scene takes an `icon` string, the *real* catalogue is `~/Desktop/Templates/Icons/` — a single flat folder of ~13k SVGs named `<category>-<iconname>-<colortheme>.svg` (e.g. `cybersecurity-phishing-dark.svg`, `ai-agent-chatbot-light.svg`). Look up icons by category prefix or icon-name substring. For `content-extremes`, pick 3 visibly-distinct silhouettes from across the catalogue (narrow / tall / detailed) — same theme suffix throughout for visual consistency.

This analysis informs (a) which slots to render, (b) which props each render needs, and (c) what to flag in the inconsistency report.

### 2. Bench setup (shared with test-template)

The bench at `~/.cache/claude-remotion-bench/` is the same one `/test-template` uses. Bootstrap exactly the way that skill does on first run (see `~/.claude/skills/test-template/SKILL.md` § 1).

### 3. Copy scene component and assets — ONCE per template

```bash
BENCH=~/.cache/claude-remotion-bench
SCENE=scenes/<TemplateName>

cp "$SCENE/<TemplateName>.tsx" "$BENCH/src/<TemplateName>.tsx"

rm -rf "$BENCH/public" && mkdir -p "$BENCH/public"
cp -R "$SCENE/Template-Specific-Assets" "$BENCH/public/" 2>/dev/null || true
cp -R "$SCENE/icons"  "$BENCH/public/" 2>/dev/null || true
cp -R "$SCENE/fonts"  "$BENCH/public/" 2>/dev/null || true
```

For `content-extremes`, *also* copy in additional icons from the flat `Icons/` catalogue so the variation can use visually-distinct silhouettes. Pick three icons with deliberately different shapes (narrow, tall, detailed) and matching `-dark`/`-light` theme suffixes. Rename on copy if the scene expects a simpler id (`staticFile('icons/<id>.svg')`) than the catalogue's `<category>-<iconname>-<theme>.svg`:

```bash
cp ~/Desktop/Templates/Icons/business-strategy-trend-dark.svg     "$BENCH/public/icons/trend.svg"
cp ~/Desktop/Templates/Icons/online-education-graduation-dark.svg "$BENCH/public/icons/graduation.svg"
cp ~/Desktop/Templates/Icons/hr-handshake-dark.svg                "$BENCH/public/icons/handshake.svg"
```

Asset paths under `public/` MUST mirror `staticFile(...)` paths in the scene.

### 4. Render each variation sequentially

For each slot you're including, in order:

1. **Rewrite `$BENCH/src/Scene.tsx`** as a thin wrapper supplying *this variation's* props. Include a short comment naming the slot and noting which axes it exercises — future-you reads these.
2. **Render**:
   ```bash
   OUT_DIR="$HOME/.cache/claude-remotion-bench/test-renders/<template-name>"
   mkdir -p "$OUT_DIR"
   cd "$BENCH"
   npx remotion render Comp \
     "$OUT_DIR/variability-<slug>.mp4" \
     --props='{"durationSeconds":15}' \
     --concurrency=2 --log=error
   ```
3. **Confirm** the MP4 is non-zero, then advance to the next slot.

Render sequentially — Remotion is CPU-bound, parallel renders fight each other. Each render ≈ 30 s; 5 variations ≈ 2.5 minutes. Tell the user the total time up front before starting.

If a render fails (TS error, missing icon, schema validation), fix that variation and re-run *only it*. Other variations are independent.

### 5. Open the folder and print the reports

```bash
open "$HOME/.cache/claude-remotion-bench/test-renders/<template-name>"
```

Then print the inconsistency report (always) and, in multi-template mode, the fleet comparison report.

## Inconsistency report

After every run (single or multi-template), print a short markdown report flagging anything the static analysis or the renders surfaced. Keep it tight — 3–8 bullets, not a wall of text. Focus on things the user couldn't see just by playing the MP4s.

Categories to look for:

- **Dead props** — schema field accepted but ignored by the component (cite file:line, e.g. `BigPoints3V1.tsx:408 overrides pillStarts`).
- **Missing assets** — `staticFile(...)` references whose file isn't in the scene folder (font files are the common case). Note whether the scene degrades gracefully.
- **Catalogue mismatches** — authoring notes describe an "available_icons" set that's wider than what ships in the scene folder, leaving callers guessing. Or the opposite: a closed-set field with no enum constraint in the schema.
- **Negative-test surprises** — what happened in `icon-fallback`. Did the gap look acceptable, ugly, or did it throw?
- **Axes I skipped** — list the slots dropped because the schema doesn't expose them, so the user knows the coverage scope.
- **Likely candidates to expose as props** — values hardcoded in the component that look design-level (column count, accent colour) and feel like they should be authorable. Flag with low confidence; the user decides.

Format example:

```
## BigPoints3V1 — variability report

Renders: 5/5 attempted, 5 succeeded.

Findings:
- DEAD PROP: `timings.pillStarts` accepted in schema but overridden by `PILL_ARRIVAL = COL_ARRIVAL` at BigPoints3V1.tsx:408. Either remove from schema or restore the override.
- MISSING ASSET: `staticFile('fonts/Satoshi-Black.woff2')` and `Inter-ExtraBold.woff2` referenced; no `fonts/` folder in the scene. Falls back to system fonts in renders, but production renders will need these files.
- CATALOGUE: authoringNotes mention "available_icons list" but only 3 SVGs ship (`idea`, `money-bag`, `rocket`). Real catalogue is the flat `Icons/` folder (~13k SVGs named `<category>-<iconname>-<theme>.svg`). Consider a schema `enum` if the set is closed.
- FALLBACK: unknown icon id leaves an empty column at expected position — degrades cleanly.
```

## Multi-template mode

Triggered by `/test-variability all` or `/test-variability --all`.

**Cost warning first.** 48 templates × ~5 renders × ~30 s ≈ 2 hours of compute. Before starting, tell the user the estimate and confirm or offer an explicit smaller mode:

- "Analysis only" — static schema analysis across all templates, no renders. Produces just the fleet comparison report. Cheap, < 1 minute.
- "Baseline only" — one render per template (slot 1 only). Mid-cost, ~25 minutes.
- "Full" — the 5-slot run per template. Expensive, ~2 hours.

For any mode beyond analysis-only, render templates sequentially (not in parallel — same CPU reason). Persist progress between renders so a crash partway doesn't lose everything.

After all templates run (or even with analysis-only), print a **fleet comparison report** — a markdown table summarising which axes each template exposes. Suggested columns:

| Template | Array len | Optional fields | `timings` overrides | Icon prop | Graceful fallback |
|---|---|---|---|---|---|
| BigPoints3V1 | fixed 3 | none beyond `timings` | yes (8 fields, 1 dead) | yes | yes |
| KubicleAIChat | 2–4 sections | brand, subline, placeholder | yes (11 fields) | no | n/a |
| … | | | | | |

Plus a short "inconsistencies across templates" section calling out:
- Templates where similar features are exposed differently (e.g. some scenes allow `array.min(M).max(N)`, others lock at `length(N)` — flag templates that *could* be more flexible).
- Templates with dead props (aggregate count + per-template list).
- Templates with missing-asset references.
- Templates that lack authoringNotes or schema descriptions.
- Templates whose schema disagrees with the meta's authoringNotes.

The fleet report is the highest-value deliverable here — it's the thing you can't see by playing MP4s, and it tells the user where the variability surface is uneven across the library.

## Behavioural notes

- **Realistic copy beats placeholder copy.** Lorem ipsum is uniform in a way real copy never is. Use real words, mixed lengths, plausible domain vocabulary. For `content-extremes` specifically, the punctuation/digit token must look like something an author would actually write ("$10/mo", "24/7 support", "10× faster") — not random symbols.
- **Pick distinct icon silhouettes for `content-extremes`.** Narrow horizontal (`arrow-trend-up`), tall vertical (`graduation-cap`), detailed/square (`benefit-hand`). The whole point is to see whether the 404-px slot accommodates them all.
- **Duration variation is NOT this skill's job.** `/test-template` already renders at multiple durations. Render every variation here at 15 s. If the user explicitly asks for non-15s, render at the requested duration but don't sweep duration as an axis.
- **Respect schema constraints strictly.** A variation that fails zod validation is wasted compute. Pre-check string lengths, array sizes, and required fields before writing the wrapper. The one exception is `icon-fallback`, where an *invalid* icon id is the test.
- **The bench is shared with test-template.** Leftover `Scene.tsx` from your last variation is fine to overwrite — both skills replace it.
- **Nothing goes in the user's repo.** The user has flagged this multiple times. No bench files, no `node_modules`, no MP4s, no intermediates inside `scenes/<TemplateName>/`.
- **Reports go in the chat, not on disk.** Don't write `report.md` files anywhere — the user reads the report in-line in your final response. For multi-template runs, the markdown can be longer, but still inline.

## When NOT to use this skill

- The user wants a single render to check pacing → use `/test-template`.
- The user wants to test how the scene behaves at non-default durations → use `/test-template <path> <seconds>`, which sweeps 6/10/15s by default.
- The scene's schema is so constrained that the only variation possible is changing topic words — in that case one `/test-template` render plus the static-analysis pass (and the resulting inconsistency report) is enough. Offer that instead of three near-identical renders.
- The user wants to compare *different templates* against the same content → that's the multi-template fleet report, not a per-template variation run.
