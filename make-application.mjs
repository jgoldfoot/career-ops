#!/usr/bin/env node
/**
 * make-application.mjs — build a complete, sendable application in one command.
 *
 * USER-LAYER FILE. It is deliberately NOT one of the filenames in
 * update-system.mjs's SYSTEM_PATHS, so `update-system.mjs apply` cannot
 * overwrite it. That placement is the whole point: the equivalent logic used
 * to live as a hand-patch inside generate-pdf.mjs (LOCAL-PATCHES.md §1), and
 * the v1.31.0 update silently wiped it. Logic that must survive updates does
 * not belong in a system-layer file.
 *
 * Usage:
 *   node make-application.mjs --company "Acme" \
 *     --cv output/src/cv-acme-2026-01-01.html \
 *     --letter output/src/cover-letter-acme-2026-01-01.html
 *
 * Produces:
 *   output/Joel Goldfoot - Resume.pdf          <- attach this (NEUTRAL name)
 *   output/Joel Goldfoot - Cover Letter.pdf    <- attach this (NEUTRAL name)
 *   output/archive/{Company}/... - {Company} - {YYYY-MM-DD}.pdf   <- the record
 *
 * Two invariants it enforces, both learned the hard way:
 *   1. NEUTRAL top-level names. Joel renames files before submitting so the
 *      employer cannot tell a document was tailored to them; building them
 *      neutrally removes that manual step.
 *   2. AN ARCHIVED DOCUMENT IS NEVER OVERWRITTEN. A same-day rebuild that
 *      differs gets " (2)", " (3)". A byte-identical rebuild reuses the
 *      existing file. Fingerprints ignore /CreationDate, /ModDate and the
 *      trailer /ID, which Chromium randomises on every render, so an
 *      unchanged document is correctly recognised as unchanged.
 *
 * Page counts are asserted, not hoped for: CV <= 2 pages, cover letter == 1.
 */
import { execFileSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'output');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}
const company = arg('company');
const cvSrc = arg('cv');
const letterSrc = arg('letter');
const today = arg('date') || new Date().toISOString().slice(0, 10);

if (!company || (!cvSrc && !letterSrc)) {
  console.error('usage: node make-application.mjs --company "Name" [--cv <html>] [--letter <html>] [--date YYYY-MM-DD]');
  process.exit(1);
}

/** Content fingerprint that ignores the fields Chromium randomises per render. */
function fingerprint(path) {
  let b = readFileSync(path).toString('latin1');
  b = b.replace(/\/CreationDate\s*\([^)]*\)/g, '')
       .replace(/\/ModDate\s*\([^)]*\)/g, '')
       .replace(/\/ID\s*\[[^\]]*\]/g, '');
  return createHash('sha256').update(b, 'latin1').digest('hex');
}

function pageCount(path) {
  const d = readFileSync(path).toString('latin1');
  const counts = [...d.matchAll(/\/Count\s+(\d+)/g)].map(m => +m[1]);
  return counts.length ? Math.max(...counts) : 0;
}

/** Never overwrite an archived document: pick the next free " (n)" instead. */
function reserveArchivePath(dir, base, ext, freshPath) {
  let candidate = join(dir, `${base}${ext}`);
  let n = 1;
  while (existsSync(candidate)) {
    if (fingerprint(candidate) === fingerprint(freshPath)) return { path: candidate, reused: true };
    n += 1;
    candidate = join(dir, `${base} (${n})${ext}`);
  }
  return { path: candidate, reused: false };
}

// ── Capability-claim guard (wired here 2026-09-16) ───────────────────────────
// Same rule as render-fallback.mjs: a build may not invent a first-person
// fluency/expertise claim to satisfy a JD. This script renders through
// generate-pdf.mjs, which BYPASSED the fallback renderer's guard, so both
// 2026-09-16 builds ran unguarded until this was added. Fails closed.
const CLAIM = /\b(expert[- ]level|expert[- ]fluent|fluent in|fluency in|proficient in|proficiency in)\b/i;
const FIRST_PERSON = /\b(I|I'm|I've|I'd|my|me)\b/;
function assertNoUnapprovedClaims(src) {
  const claimsFile = join(ROOT, 'config', 'approved-claims.txt');
  const approved = existsSync(claimsFile)
    ? readFileSync(claimsFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    : [];
  const body = readFileSync(src, 'utf8').split(/<body[^>]*>/i)[1] || '';
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const offending = text.split(/(?<=[.!?])\s+/).map(t => t.trim())
    .filter(t => CLAIM.test(t) && FIRST_PERSON.test(t) && !approved.includes(t));
  if (offending.length) {
    console.error('REFUSED: unapproved capability claim(s) in ' + src + ':');
    offending.forEach(t => console.error('  - ' + t));
    console.error('If Joel confirms a claim is true, add the exact sentence to config/approved-claims.txt.');
    process.exit(2);
  }
}

function build({ src, sendName, archiveLabel, maxPages, exactPages }) {
  assertNoUnapprovedClaims(src);
  const sendPath = join(OUT, `${sendName}.pdf`);
  execFileSync('node', [join(ROOT, 'generate-pdf.mjs'), src, sendPath, '--format=letter'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });

  const pages = pageCount(sendPath);
  if (exactPages != null && pages !== exactPages) {
    throw new Error(`${sendName}: expected exactly ${exactPages} page(s), got ${pages}. ` +
      `For a cover letter this usually means :root { --page-margin: 0.3in } is missing from the HTML.`);
  }
  if (maxPages != null && pages > maxPages) {
    throw new Error(`${sendName}: ${pages} pages exceeds the ${maxPages}-page budget. Trim the source.`);
  }

  const dir = join(OUT, 'archive', company);
  mkdirSync(dir, { recursive: true });
  const { path: archivePath, reused } = reserveArchivePath(
    dir, `${archiveLabel} - ${company} - ${today}`, '.pdf', sendPath);
  if (!reused) copyFileSync(sendPath, archivePath);

  console.log(`  ${sendName}.pdf  (${pages}p)  ->  archive/${company}/${archivePath.split('/').pop()}${reused ? '  [identical, reused]' : ''}`);
}

console.log(`Building application: ${company} (${today})`);
if (cvSrc) build({ src: cvSrc, sendName: 'Joel Goldfoot - Resume', archiveLabel: 'Joel Goldfoot - Resume', maxPages: 2 });
if (letterSrc) build({ src: letterSrc, sendName: 'Joel Goldfoot - Cover Letter', archiveLabel: 'Joel Goldfoot - Cover Letter', exactPages: 1 });
console.log(`\nAttach from ${OUT}/ :\n  Joel Goldfoot - Resume.pdf\n  Joel Goldfoot - Cover Letter.pdf`);
console.log(`These hold the ${company} content.`);
