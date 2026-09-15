#!/usr/bin/env node
/**
 * render-fallback.mjs — minimal HTML -> PDF renderer.
 *
 * WHY THIS EXISTS: as of v1.31.0 (commit dc5a99c, 2026-08-31 17:15) the
 * upstream auto-update added imports for THREE modules that were never
 * shipped and have never existed in git history:
 *     ./path-resolver.mjs   (getCareerOpsRoot, resolveTrackerPath)
 *     ./theme-style.mjs     (readStyleTokens, injectThemeStyle, readCvSectionOrder)
 *     ./tracker-utils.mjs   (resolvePdfIndexPath, resolveTrackerPath, resolveWorkspaceRoot)
 * Ten scripts import them, so generate-pdf.mjs, scan.mjs, doctor.mjs,
 * merge-tracker.mjs, normalize-statuses.mjs, dedup-tracker.mjs,
 * analyze-patterns.mjs, cv-sync-check.mjs, followup-cadence.mjs and
 * gemini-eval.mjs ALL fail at import with ERR_MODULE_NOT_FOUND.
 *
 * The breakage is invisible until you next build an application: the previous
 * build predates it, and the next application built was the first to hit it.
 *
 * Margins are NOT uniform and this is deliberate, matching the shipped
 * 1-page cover letters and 2-page CVs:
 *   CV            0.6in  (dense two-page document)
 *   cover letter  0.3in  (.page already supplies a 0.3in inset; the house-style
 *                         letter body measures ~10.28in, which overflows Letter
 *                         at a 0.6in margin and silently becomes 2 pages)
 *
 * Usage: node render-fallback.mjs <input.html> <output.pdf> [--letter-margins]
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'url';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node render-fallback.mjs <input.html> <output.pdf> [--letter-margins]');
  process.exit(1);
}
const isLetter = flags.includes('--letter-margins') || /cover-letter/i.test(input);
const m = isLetter ? '0.3in' : '0.6in';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(input).href, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
// The <title> becomes the PDF's /Title metadata, which an ATS or a reviewer can
// see. Letter sources are cloned from earlier applications and have carried the
// PREVIOUS employer's name here (Trustly letter shipped titled "Smartsheet",
// caught 2026-09-15). Force a neutral title; never trust the source's.
await page.evaluate((t) => { document.title = t; },
  isLetter ? 'Joel Goldfoot — Cover Letter' : 'Joel Goldfoot — CV');
await page.pdf({ path: output, format: 'Letter', printBackground: true,
  margin: { top: m, bottom: m, left: m, right: m } });
await browser.close();
console.log(`rendered ${output} (margin ${m})`);
