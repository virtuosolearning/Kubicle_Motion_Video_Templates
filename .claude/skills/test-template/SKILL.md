---
name: test-template
description: Render a Remotion .tsx scene to three MP4 test files at varying durations (6s / 10s / 15s) so the user can spot-check animation pacing at short, normal, and long lengths. Use when the user invokes /test-template, asks to "test a template", "make test renders" of a video template, or render a template to MP4. The bench (a Remotion project with node_modules) AND the test-render outputs both live under ~/.cache/claude-remotion-bench/ — nothing lands in the user's repo.
---

# /test-template

Render a video template to **three MP4 files of different durations** so the user can spot-check animation pacing.

## Input

A **Remotion `.tsx` scene** — a folder under `scenes/` containing `<Name>.tsx` plus the asset subfolders the scene resolves via `staticFile(...)` (e.g. `Template-Specific-Assets/`, `icons/`, `fonts/`), or a direct path to the `.tsx` file. Example: `scenes/Topic1Subtopics6/` or `scenes/Topic1Subtopics6/Topic1Subtopics6.tsx`.

The component takes its data via props matching its exported zod schema; sample data should be inferred from schema constraints + any in-file authoring notes.

If the user invoked `/test-template` without a path, list the folders under `scenes/` and ask them which template.

## Output

Three MP4s under `~/.cache/claude-remotion-bench/test-renders/<template-name>/`:

- `test-6s.mp4` — short
- `test-10s.mp4` — default
- `test-15s.mp4` — long

**Nothing** lands in the user's repo — not the bench, not `node_modules`, not the test renders. Report the absolute output paths back to the user so they can `open` them. If the user explicitly asks for the renders inside their repo, override the default — but the default is always `~/.cache/claude-remotion-bench/test-renders/<template-name>/`.

## Where things live

- **Bench** (shared, persistent): `~/.cache/claude-remotion-bench/`
  - `package.json`, `tsconfig.json`, `remotion.config.ts`
  - `src/index.ts`, `src/Root.tsx` — Composition with a `durationSeconds` prop
  - `src/Scene.tsx` — overwritten on each invocation with the active template's scene (or a wrapper that imports the user's `.tsx` and supplies sample props)
  - `src/icons.ts` — optional companion file for inlined SVGs
  - `public/` — overwritten on each invocation with the active template's assets, mirroring whatever `staticFile(...)` paths the scene uses
  - `node_modules/` — installed once, reused
  - `test-renders/<template-name>/` — the three MP4 outputs (and only the MP4s) for the most recent run of each template
- **Bench template** (read-only, source of truth): `~/.claude/skills/test-template/bench-template/`
  - Used to bootstrap the bench on first run.

## Steps

### 1. Ensure the bench is set up

```bash
BENCH=~/.cache/claude-remotion-bench
TEMPLATE_DIR=~/.claude/skills/test-template/bench-template

if [ ! -f "$BENCH/package.json" ]; then
  mkdir -p "$BENCH/src" "$BENCH/public"
  cp "$TEMPLATE_DIR/package.json" "$TEMPLATE_DIR/tsconfig.json" "$TEMPLATE_DIR/remotion.config.ts" "$BENCH/"
  cp "$TEMPLATE_DIR/src/index.ts" "$TEMPLATE_DIR/src/Root.tsx" "$BENCH/src/"
fi

if [ ! -d "$BENCH/node_modules" ]; then
  (cd "$BENCH" && npm install)
fi
```

### 2. Get a `Scene` into `$BENCH/src/Scene.tsx`

The `.tsx` in `scenes/<TemplateName>/` is the source of truth — don't re-port it.

1. **Copy the scene** verbatim into `$BENCH/src/<ComponentName>.tsx`. It will have a zod schema export, a meta export, and a top-level component that takes structured props (e.g. `points`, `cards`, `courseTitle`).
2. **Write a thin `$BENCH/src/Scene.tsx` wrapper** that imports the component and supplies sample data conforming to its zod schema:
   ```tsx
   import { Topic1Subtopics6 } from './Topic1Subtopics6';

   export const Scene: React.FC<{ durationSeconds: number }> = () => (
     <Topic1Subtopics6
       mainTitle="Data modelling"
       anchorIcon="edit"
       details={[
         'Define entities and relationships',
         'Choose a normalisation level',
         'Map primary and foreign keys',
         'Validate against business rules',
         'Review with stakeholders',
         'Document the final schema',
       ]}
     />
   );
   ```
   **Make the sample data realistic, not placeholder.** The user uses these renders to judge whether the template actually works for real content — generic "Paste Title One" / "Paste Supporting Detail (1)" strings hide layout bugs (different lengths overflow differently, ascenders/descenders only show with real words, parallel phrasing reveals tone mismatches). Pick a plausible topic for the template's shape and write content a real author might write:
   - Use varied lengths within the field's max — short, medium, long.
   - Use real words with mixed case and punctuation, not Lorem Ipsum.
   - Pick a topic that fits the template's structure (e.g. a 6-step process for a 6-row pill list, four parallel concepts for four circles).
   - Read the scene's `authoringNotes` in its `*Meta` export — it tells you what good copy looks like for that specific template. Mirror that style.

   Sample data must also respect schema length/`min`/`max`/regex constraints. For icon IDs and similar string fields, use the names of asset files actually present in the template folder (step 3 will copy them into `public/`).
3. **Don't modify the user's `.tsx`.** Wrappers go in the bench, not in their repo.

### 3. Copy assets into `$BENCH/public/`

Wipe and repopulate `public/` so leftover files from a previous template don't get served. Assets are colocated under the scene folder in arbitrary subfolders that match the `staticFile(...)` paths the scene uses — e.g. `Template-Specific-Assets/`, `icons/`, `fonts/`:

```bash
rm -rf "$BENCH/public"
mkdir -p "$BENCH/public"
# Copy every asset subfolder the scene references. Inspect the .tsx for
# staticFile(...) calls to know which subfolders to copy.
cp -R "scenes/<TemplateName>/Template-Specific-Assets" "$BENCH/public/" 2>/dev/null || true
cp -R "scenes/<TemplateName>/icons"  "$BENCH/public/" 2>/dev/null || true
cp -R "scenes/<TemplateName>/fonts"  "$BENCH/public/" 2>/dev/null || true
```

Asset paths in `public/` MUST mirror the `staticFile(...)` paths in the scene. If `staticFile('icons/edit.svg')` is called, the file must land at `$BENCH/public/icons/edit.svg`.

If a referenced asset (e.g. a font file) isn't available locally, proceed anyway — most scenes catch font-load failures and fall back to system fonts. Note the missing asset in the report so the user can supply it for production rendering.

### 4. Render the three MP4s

```bash
OUT_DIR="$HOME/.cache/claude-remotion-bench/test-renders/<template-name>"
mkdir -p "$OUT_DIR"
cd "$BENCH"

for SECS in 6 10 15; do
  npx remotion render Comp \
    "$OUT_DIR/test-${SECS}s.mp4" \
    --props="{\"durationSeconds\":$SECS}" \
    --concurrency=2 --log=warn
done
```

`<template-name>` is a slug derived from the input (folder name or `.tsx` filename, stripped of spaces). Renders are roughly 30 seconds per video on a modern Mac and can run sequentially or in parallel via `run_in_background`. If a render fails because of a TypeScript compile error in the wrapper or ported scene, fix the error and re-render the affected duration — the bench is already warm.

### 5. Confirm and open

List the three MP4s, confirm sizes are non-zero. Don't delete the bench (`node_modules` is cached for next time) and don't delete `test-renders/` (the user may want to revisit prior runs). Then open the output folder in Finder so the user can play the files immediately:

```bash
open "$OUT_DIR"
```

### 6. Schedule overnight cleanup

Test renders accumulate ~3–5 MB per template. To stop unbounded growth without cutting into same-day usability, ensure a recurring nightly cleanup task is scheduled. The task fires at **02:00 local every night** and wipes `~/.cache/claude-remotion-bench/test-renders/*` (contents only — the directory itself stays).

**Idempotent setup.** Don't create a duplicate every run — check first:

1. Call `mcp__scheduled-tasks__list_scheduled_tasks`. Look for a task with `taskId` exactly `cleanup-test-renders`.
2. If it exists and is enabled, skip — nothing to do.
3. If it doesn't exist, call `mcp__scheduled-tasks__create_scheduled_task` with:
   - `taskId`: `cleanup-test-renders`
   - `description`: `Wipe ~/.cache/claude-remotion-bench/test-renders/* nightly`
   - `cronExpression`: `0 2 * * *` (daily at 02:00 local time — cron is evaluated in local TZ)
   - `prompt`: see below
   - `notifyOnCompletion`: `false` (don't ping you every night)

**Prompt for the scheduled task** (verbatim — paste into the `prompt` field):

> Wipe the contents of the Remotion test-renders cache. Run exactly this Bash command and report the result:
>
> ```bash
> shopt -s nullglob; cd ~/.cache/claude-remotion-bench/test-renders 2>/dev/null && (set -- *; if [ "$#" -eq 0 ]; then echo "Already empty."; else BEFORE=$(du -sh . | cut -f1); rm -rf -- *; echo "Deleted $# folder(s); freed $BEFORE."; fi) || echo "test-renders/ does not exist; nothing to clean."
> ```
>
> Constraints (do NOT deviate):
>
> - Only touch `~/.cache/claude-remotion-bench/test-renders/`. Never `node_modules`, `src/`, `public/`, or anywhere outside that directory.
> - Don't delete the `test-renders/` directory itself — only its contents.
> - Don't run any other commands. No git, no npm, no edits. This is a one-shot cleanup, not a workflow.
> - Report a single line: either "Deleted N folder(s); freed Xmb." or "Already empty." or "test-renders/ does not exist; nothing to clean."

If `mcp__scheduled-tasks__create_scheduled_task` fails (MCP unavailable, etc.) emit a one-line warning but still report the renders as ready — the cleanup is a nice-to-have, not a blocker.

## Behavioural notes

- **Duration semantics.** The bench's `Composition` uses `calculateMetadata` to set `durationInFrames` from the `durationSeconds` prop. The Scene component itself doesn't need to know the duration — it animates based on `useCurrentFrame()`, and Remotion stops at the configured frame count. So a template with timings hard-coded to "BG 0–2s, sides 1–5.5s" will:
  - At **6s**: finish the slide at 5.5s, hold for 0.5s, then end.
  - At **10s**: finish the slide at 5.5s, hold for 4.5s, then end.
  - At **15s**: finish the slide at 5.5s, hold for 9.5s, then end.
  This is the expected behaviour and is exactly the kind of pacing check the user wants.
- **If a template's animations DO scale with duration**, the scene will have parameterised them (look for `durationSeconds` references in the `.tsx`). The Scene type can take a `{ durationSeconds: number }` prop and the bench's Root will pass it through automatically.
- **Nothing goes in the user's repo.** That includes `node_modules`, `package.json`, `out/`, AND the test-render MP4s themselves. The bench AND the renders both live under `~/.cache/claude-remotion-bench/`. The user has flagged this twice — first about a `remotion-render/` folder, then about test renders being dumped into a `test-renders/` folder under their template. Don't repeat either mistake. Only override the default output path if the user explicitly asks for the renders inside their repo on this specific invocation.
- **If the user wants different durations**, they'll tell you. Don't ask — just render 6 / 10 / 15 by default. They can override per-invocation: `/test-template <path> 4 8 12`.
- **Test renders are ephemeral.** Step 6 schedules a nightly 02:00 wipe of `~/.cache/claude-remotion-bench/test-renders/*`. Renders stay around all day so you can play them, share, compare across templates — but don't expect yesterday's renders in the morning. Re-run `/test-template` if you want them back. The bench itself (`node_modules`, `src/`, `public/`) is preserved.

## When not to use this skill

- The user wants to render to a file other than MP4 (use Remotion CLI directly).
- The user wants the *same* duration as the original — that's just one render, not a "test" job.
- The user wants the scene rendered live in the Remotion preview/browser, not encoded — point them at `npx remotion studio` in the bench.
