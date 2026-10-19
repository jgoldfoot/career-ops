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

---

## 2. ✅ RESOLVED 2026-09-02 — v1.31.0 INSTALLED ONLY HALF OF ITSELF (kept for the record and the lesson)

**Found while building an application. This is upstream breakage, not a local patch, and it is recorded here because this is the file that survives updates.**

### What is broken

`chore: auto-update system files to v1.31.0` (**dc5a99c, 2026-08-31 17:15**) added imports for three modules that **have never existed in this repo and appear nowhere in git history**:

| Missing module | Symbols imported |
|---|---|
| `path-resolver.mjs` | `getCareerOpsRoot`, `resolveTrackerPath` |
| `theme-style.mjs` | `readStyleTokens`, `injectThemeStyle`, `readCvSectionOrder` |
| `tracker-utils.mjs` | `resolvePdfIndexPath`, `resolveTrackerPath`, `resolveWorkspaceRoot` |

**Ten scripts fail at import with `ERR_MODULE_NOT_FOUND`:** `generate-pdf.mjs`, `scan.mjs`, `doctor.mjs`, `merge-tracker.mjs`, `normalize-statuses.mjs`, `dedup-tracker.mjs`, `analyze-patterns.mjs`, `cv-sync-check.mjs`, `followup-cadence.mjs`, `gemini-eval.mjs`.

### Why it went unnoticed for two days

The last successful build predated the breaking commit by a day and a half; the next application built after it was the one that surfaced the failure. Nothing else in Joel's daily routine touches these scripts, so a dead toolchain looked exactly like a quiet one. Note this is the *second* defect from the same commit: `14dcb10` (five minutes later) restored the CV house style that the same update clobbered.

### The workaround in place

**`render-fallback.mjs`** (new, User-Layer-safe, committed alongside this note) renders HTML to PDF directly through Playwright with the correct per-document margins. It does **not** reimplement the patch-1 dated-filename logic; when using it, copy the dated record file by hand:

```bash
node render-fallback.mjs output/cv-{co}-{date}.html "output/Joel Goldfoot - Resume - {Co}.pdf"
cp "output/Joel Goldfoot - Resume - {Co}.pdf" "output/Joel Goldfoot - Resume - {Co} - {date}.pdf"
```

**Margins are not uniform, and getting this wrong is silent:** the CV renders at `0.6in`, the cover letter at `0.3in`. The house-style letter body measures ~10.28in, which overflows US Letter at a 0.6in margin and turns a one-page letter into two without any error. `render-fallback.mjs` picks the margin from the filename.

### The real fix, which is NOT done

Either roll back to the pre-v1.31.0 versions of the ten scripts, or obtain the three missing modules from upstream. **Do not reimplement `theme-style.mjs` from scratch** — `injectThemeStyle` and `readCvSectionOrder` carry the CV house style and the section-order guard, and this same update has already clobbered that house style once. Reconstructing them by guess would do it again, quietly.


---

### ✅ RESOLUTION (2026-09-02) — the real scope was 33 missing files, not 3

**The diagnosis above understated it.** Chasing the dependency closure rather than the first error showed the update had **failed to install 33 files**, not three:

- 31 `.mjs` modules (`path-resolver`, `theme-style`, `tracker-utils`, `tracker-parse`, `pipeline-lock`, `role-matcher`, `url-key`, `title-keywords`, the `lib/` helpers, three `plugins/` internals, and more)
- 1 data file, `tracker-aliases.json`, which no import-graph scan finds because it is loaded at runtime, not imported

**All three missing modules were listed in `update-system.mjs`'s own `SYSTEM_PATHS`, and all existed upstream.** The updater simply did not copy them and **reported success anyway**. That is the defect: a partial install that exits 0.

**Fixed by** fetching every missing file from `santifer/career-ops@main` (upstream `VERSION` is `1.31.0`, identical to local; no `v1.31.0` tag exists, so `main` is the correct source). Each file was safety-scanned before installation: no network calls, no `child_process`, no env access; the only `rmSync` calls are scoped to lock directories and the script's own temp files.

**Verified:** the dependency closure is complete across 141 modules, and all ten previously-dead scripts import cleanly. `generate-pdf.mjs` renders the CV at 2 pages and the cover letter at 1.

### ⚠️ PATCH 1 WAS SILENTLY WIPED BY THE SAME UPDATE, AND HAS NOT BEEN RE-APPLIED AS A PATCH

`dc5a99c` overwrote `generate-pdf.mjs`, deleting the dated-filename logic in §1 (`pdfFingerprint`, `reserveDatedPath`). **This file exists precisely to prevent that, and it still happened, because nothing enforces reading it.**

**It was not re-applied to `generate-pdf.mjs`.** Re-patching a system-layer file guarantees a third wipe on the next update. The logic now lives in **`make-application.mjs`**, a USER-LAYER script at the repo root whose filename is not in `SYSTEM_PATHS`, so the updater cannot touch it:

```bash
node make-application.mjs --company "Acme" \
  --cv output/src/cv-acme-YYYY-MM-DD.html \
  --letter output/src/cover-letter-acme-YYYY-MM-DD.html
```

It renders through `generate-pdf.mjs`, writes the **neutrally named** sendable pair to `output/`, copies date-and-company-stamped records into `output/archive/{Company}/`, **refuses to overwrite an archived document** (identical rebuild reuses the file; a changed one gets ` (2)`), and **asserts page counts** (CV ≤ 2, letter exactly 1).

**The cover letter's 0.3in margin is no longer a flag.** It is declared as `:root { --page-margin: 0.3in }` in the letter HTML, which `generate-pdf.mjs` reads for its `@page` rule. The margin now travels with the document instead of depending on the caller remembering it.

**THE GENERAL LESSON, which is the reason this section is long: logic that must survive updates does not belong in a system-layer file.** A note saying "re-apply this after every update" is not a mechanism. `LOCAL-PATCHES.md` §1 was correct, prominent, and ignored.

---

## 3. `asset-integrity.mjs` — a corrupt embedded QR shipped three applications (added 2026-09-27)

**NEW FILE, plus two call sites.** `asset-integrity.mjs` is local-layer and has no upstream counterpart, so an update will not wipe it — but the two one-line call sites are in system-layer files and **will** be wiped. Re-apply them after any `update-system.mjs apply`:

- `make-application.mjs` — `import { assertEmbeddedAssetsValid } from './asset-integrity.mjs';` plus the call as the second line of `build()`.
- `render-fallback.mjs` — the dynamic import and call immediately before `chromium.launch()`, so it runs *before* the browser starts.

### What happened

A CV authored from `templates/cv-template.html` on **2026-09-16** lost **225 characters** out of the LinkedIn QR's base64 data URI. That file was copied forward to TRM Labs the same day and to Xapo Bank on 09-23. All three built applications rendered a **broken-image icon with the alt text `/in/goldfoot` beside Joel's name**, at the top of page one.

It was caught on **2026-09-27** only because Joel opened the PDF before sending it: *"Good thing I opened this before I sent it."*

### Why nothing upstream caught it, and this is the point

Every existing check passed, because none of them looks at the rendered result:

- the base64 is a single unreadable line, so the corruption is invisible in a diff;
- **Chromium renders a broken data: URI as a placeholder icon and exits 0**;
- the **page count was unchanged** (2pp), so `make-application.mjs`'s page assertion passed;
- the capability-claim guard reads text, not assets.

**A page count is a check that the document is the right SHAPE. It is not a check that the document is CORRECT.** The build pipeline had no assertion about rendered content at all, and a visual defect in the most prominent position on the page walked straight through it.

### The guard

`checkEmbeddedAssets()` walks every embedded PNG chunk by chunk and verifies each CRC, so it catches both a length break and a single flipped byte mid-stream. Fails closed with exit 2 and writes no PDF.

Regression-tested both directions before shipping: the three corrupt originals FAIL on the length check, a synthetic single-byte flip FAILS on the IDAT CRC, and the template plus all fifteen repaired sources PASS.

### Canonical source for the QR

`templates/cv-template.html`. The twelve CVs built between 2026-06-15 and 2026-09-11 all carry a byte-identical, valid copy of it, so it is proven in production. Restore from there, never reconstruct.

### Scope of the repair (2026-09-27)

Three HTML sources, three `to-send/` resumes, three `archive/` resumes, and the top-level `output/Joel Goldfoot - Resume.pdf` (which held the Xapo build). Verified after: every resume PDF now contains exactly **one** image object; a broken one contains two, the second being Chromium's placeholder. That one-vs-two count is a cheap post-render check worth keeping in mind.

**Nothing had been submitted, so no application went out with the defect.**
