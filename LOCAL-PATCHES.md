# Local patches to system-layer files — RE-APPLY AFTER ANY `update-system.mjs apply`

**Read this before and after running a career-ops system update.**

`DATA_CONTRACT.md` splits this repo into a User Layer (never auto-updated) and a System Layer (auto-updatable). The patches below live in **System Layer** files, which means **`node update-system.mjs apply` will overwrite them and silently revert the behaviour.** This file is not on the update list, so it survives to tell you what to put back.

---

## 1. `generate-pdf.mjs` — dated filenames, so a rebuild cannot destroy a sent document

**Added 2026-08-28, on Joel's instruction. Do not drop this on an update.**

### What it does
At the write step, the script now writes **two** files instead of one:
- `Joel Goldfoot - Resume - {Company} - {YYYY-MM-DD}.pdf` — **the record. Never overwritten.**
- `Joel Goldfoot - Resume - {Company}.pdf` — the stable working name, latest build. Callers, modes and templates keep working unchanged.

Same-day rebuilds do not pile up: an identical rebuild reuses the existing dated file, and a genuinely changed rebuild gets ` (2)`, ` (3)`, so both versions survive. "Identical" is a content fingerprint that normalises out `/CreationDate`, `/ModDate` and the trailer `/ID`, because Chromium randomises those on every render and a raw byte comparison could never match.

Implementation: `pdfFingerprint()` and `reserveDatedPath()` near the top of the file, called from the write step in `generatePDF()`.

### Why — this already cost the record, and it is unrecoverable
The script used to write only the caller-supplied path, which is a fixed name per company. Every rebuild overwrote, in place, the exact document a company had already received.

> **Vanta was applied 2026-07-18. The Vanta resume on disk is dated 2026-08-02**, because a rebuild that day overwrote it. **The resume Vanta actually received no longer exists anywhere.** That was the pipeline's highest-scored role (4.5/5, $365–513K).

The same collision is why the OpenAI application of 2026-08-23 has two candidate builds and no way to establish which one was uploaded.

### How to tell if it has been reverted
`python3 ../career-2026/scripts/check_artifacts.py` checks for it every run and prints a loud warning if the guard is gone. Or grep directly:

```bash
grep -c reserveDatedPath /Users/goldfoot/Documents/Projects/career-ops/generate-pdf.mjs
```

`0` means the patch is gone and every rebuild is destroying evidence again.

### Related, and deliberately NOT patched
`generate-latex.mjs` has the same shape and is not currently in Joel's build path. If it ever becomes the primary CV builder, give it the same treatment.

---

## Known upstream test failures — NOT caused by these patches

`node test-all.mjs` reports **164 passed, 2 failed** both with and without the patch above. Both failures are upstream or configuration, not regressions:

1. **`merge-tracker.mjs crashed`** — not a crash. The script refuses to run because `data/applications.md` carries a DEPRECATED / STALE banner, which is **correct and deliberate**: the live tracker is `career-2026/data/tracker.md` and this fork is the CV/PDF toolchain only. The upstream test asserts the script exits 0, so it will fail forever in this fork. **The test is stale, not the code.** Not fixed here because `test-all.mjs` is itself system-layer and any fix would be overwritten.
2. **`Dashboard build failed`** — `dashboard/` is a Go project (`main.go`, `go.mod`) and the toolchain is not set up locally. Unrelated to the CV pipeline.
