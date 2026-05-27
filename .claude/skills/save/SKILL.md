---
name: save
description: Commit the user's current work with a clean message and push directly to `main`. Use when the user types `/save` or says things like "save this", "save my work", "back this up", "commit this", or "snapshot this". This repo is a solo templates repo — pushes land straight on `main`, no PR detour. If the working tree contains multiple unrelated changes, list them in plain English and ask the user which to bundle before committing. Always narrate each git step plainly as it happens, since the user is learning by watching.
---

# /save — commit + push to main

The user's primary way of saving work. **They don't know git well and are learning by watching**, so explain each step in plain English as you run it. Use `git xyz` (in backticks) when naming a command so it's visually distinct.

This is a **solo templates repo**. Pushes go straight to `main` — no PR review, no save branches, no GitHub clicks.

## Repo facts

- Remote: `origin` → `github.com/mrankin-blip/Kubicle_MG_Templates`
- Default branch: `main`
- Token is embedded in the remote URL — don't nag about it.
- `gh` CLI is **not** installed — don't try to use it.
- The user often runs inside a Claude Code worktree (e.g. on a `claude/*` branch). That's fine — `/save` pushes current HEAD to remote `main` regardless of the local branch name.

## The flow

### 1. See what's changed

Run `git status --short` and `git diff --stat`.

- **No changes?** Tell the user: "Nothing to save — no files have changed since your last save." Stop.
- **Changes?** Continue.

### 2. Coherent or messy?

Look at the changed files and group them into logical units. A "unit" is changes that belong to one story — e.g. all files for one template, or one skill being edited.

It's **messy** when the changes span unrelated things, e.g.:
- A skill edit + a brand new template + a tweak to an old template
- Changes in `.claude/skills/` and `New_Templates/` and `README.md` all at once

It's **coherent** when everything ties to one thing, e.g.:
- All files in one template directory
- One skill file edited

**If coherent → skip to step 3.**

**If messy → default to separate commits per group.** Don't ask first — just list the groups in plain English (so the user can see what's about to happen) and start working through them one at a time, each as its own commit + push to `main`. Order: cleanup commits (e.g. `.gitignore`, deleted junk files) first, then config (`.claude/`), then template/feature work in alphabetical order.

Example narration:

> Looks like a few separate things here. Saving each as its own commit:
>
> 1. **.gitignore + .DS_Store cleanup**
> 2. **`.claude/` config**
> 3. **`scenes/Carousel5TilesV1/`**
> 4. **`scenes/Flywheel4PetalsV1/`**
> 5. ...
>
> **Save 1 of N** — staging .gitignore cleanup... committing... pushed `a1b2c3d` to `main`.
>
> ...

**Only stop and ask** if you spot something risky in the messy state:
- Sensitive-looking filename (`.env`, `*secret*`, `*credential*`, `*token*`, `*.pem`, `*.p12`, `*.key`) → stop, ask before staging it.
- A group spans clearly unrelated *and* destructive-looking work (e.g. mass file deletion mixed with new features) → flag it before continuing.
- The user explicitly said "save everything as one commit" earlier in the conversation → respect that, do one big commit.

Otherwise: separate commits per group, no question prompt. The user can always interrupt mid-loop if they want a different grouping.

### 3. Stage what's being saved

- Saving everything: `git add -A`
- Saving a subset: `git add <paths>`

Explain: "`git add` is how I tell git which files to include in this save."

⚠️ **Safety check before committing:** scan staged paths for anything that smells sensitive — `.env`, `*secret*`, `*credential*`, `*token*`, `*.pem`, `*.p12`, `*.key`. If any are present, **stop and ask** before continuing. Don't commit them silently.

### 4. Write a clean commit message

Look at `git diff --cached --stat` and `git diff --cached` (capped — don't dump huge diffs into context). Write a one-line message:

- Imperative mood: "Add", "Update", "Fix", "Remove" (not "Added"/"Updating").
- Under 70 chars.
- Describes *what changed and why*, not *how*.

If the change is large or covers a few related things, add a short body with a couple of bullet points.

Run:

```
git commit -m "<message>"
```

Use a heredoc if there's a body. Explain: "`git commit` records this snapshot locally with a description. It hasn't gone to GitHub yet — that's the next step."

### 5. Push to main

```
git push origin HEAD:main
```

Explain: "`git push origin HEAD:main` uploads the commit to GitHub's `main` branch. `HEAD:main` means 'take whichever commit I'm currently sitting on and push it to the remote `main`'. The remote `main` is the live, shared version on GitHub."

**If the push is rejected as non-fast-forward** (remote `main` has moved since you last pulled): don't force-push. Run `git fetch origin main` to see what's there, show the user the divergence, and let them decide whether to rebase or merge.

**If the push is denied by Claude Code's permission system** with a message about "default branch": the `Bash(git push:*)` allow rule is missing from `.claude/settings.local.json`. Tell the user and stop — don't try to work around it.

### 6. Confirm

Show the new commit SHA and a one-line confirmation:

> ✅ Pushed `a1b2c3d` to `main`. Your work is live on GitHub.

Done. No URLs to click.

## Edge cases

- **Pre-commit hook fails** — don't `--no-verify`. Show the user what failed and ask how to fix.
- **Detached HEAD or weird git state** — stop, explain plainly, ask. Don't try to "fix" it autonomously.
- **No remote configured** — `/save` only works with a GitHub remote. Tell the user.
- **Sensitive file in staged set** — stop, ask before including.
- **Push rejected (non-fast-forward)** — don't force. Fetch, show divergence, let user decide.
- **User wants to undo a save** — that's a separate workflow (revert with a new commit, or `git reset` if not yet pushed). Don't bake undo into `/save`.

## What NOT to do

- ❌ Don't force-push under any circumstances unless the user explicitly asks.
- ❌ Don't skip hooks (`--no-verify`).
- ❌ Don't silently include sensitive files.
- ❌ Don't be terse — narrate each step so the user learns what's happening.
- ❌ Don't bundle "messy" working trees into one commit by default — split them into per-group commits (see step 2).
- ❌ Don't create `save/...` branches or PRs — pushes go straight to `main` in this repo.

## Example: clean run

> User: `/save`
>
> Claude:
> Checking what's changed... (`git status --short`)
> You've changed 3 files, all in `New_Templates/podcast-intro/`. That looks like one coherent change.
>
> Staging them... (`git add -A`)
> Committing with the message "Add podcast intro template"... (`git commit -m "..."`)
> Saved locally as commit `a1b2c3d`. Now pushing to `main` on GitHub... (`git push origin HEAD:main`)
>
> ✅ Pushed `a1b2c3d` to `main`. Your work is live on GitHub.

## Example: messy run (auto-split, no prompt)

> User: `/save`
>
> Claude:
> Checking what's changed... (`git status --short`)
>
> A few separate things here — saving each as its own commit, pushed to `main` in order:
>
> 1. **`.claude/` config**
> 2. **New podcast intro template** — `New_Templates/podcast-intro/`
> 3. **README tweak** — `README.md`
>
> **Save 1 of 3** — staging `.claude/`... committing as "Add Claude Code project config"... pushed `a1b2c3d` to `main`.
>
> **Save 2 of 3** — staging the new template... committing as "Add podcast intro template"... pushed `e4f5g6h` to `main`.
>
> **Save 3 of 3** — staging the README... committing as "Update README with new template entry"... pushed `i7j8k9l` to `main`.
>
> ✅ All three commits live on `main`.
