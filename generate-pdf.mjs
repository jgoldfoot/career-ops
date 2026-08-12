#!/usr/bin/env node

/**
 * generate-pdf.mjs — HTML → PDF via Playwright
 *
 * Usage:
 *   node career-ops/generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]
 *
 * Requires: @playwright/test (or playwright) installed.
 * Uses Chromium headless to render the HTML and produce a clean, ATS-parseable PDF.
 */

import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { crc32 } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure output directory exists (fresh setup)
mkdirSync(resolve(__dirname, 'output'), { recursive: true });

/**
 * Normalize text for ATS compatibility by converting problematic Unicode.
 *
 * ATS parsers and legacy systems often fail on em-dashes, smart quotes,
 * zero-width characters, and non-breaking spaces. These cause mojibake,
 * parsing errors, or display issues. See issue #1.
 *
 * Only touches body text — preserves CSS, JS, tag attributes, and URLs.
 * Returns { html, replacements } so the caller can log what was changed.
 */
function normalizeTextForATS(html) {
  const replacements = {};
  const bump = (key, n) => { replacements[key] = (replacements[key] || 0) + n; };

  const masks = [];
  const masked = html.replace(
    /<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `\u0000MASK${masks.length}\u0000`;
      masks.push(match);
      return token;
    }
  );

  let out = '';
  let i = 0;
  while (i < masked.length) {
    const lt = masked.indexOf('<', i);
    if (lt === -1) { out += sanitizeText(masked.slice(i)); break; }
    out += sanitizeText(masked.slice(i, lt));
    const gt = masked.indexOf('>', lt);
    if (gt === -1) { out += masked.slice(lt); break; }
    out += masked.slice(lt, gt + 1);
    i = gt + 1;
  }

  const restored = out.replace(/\u0000MASK(\d+)\u0000/g, (_, n) => masks[Number(n)]);
  return { html: restored, replacements };

  function sanitizeText(text) {
    if (!text) return text;
    let t = text;
    t = t.replace(/\u2014/g, () => { bump('em-dash', 1); return '-'; });
    t = t.replace(/\u2013/g, () => { bump('en-dash', 1); return '-'; });
    t = t.replace(/[\u201C\u201D\u201E\u201F]/g, () => { bump('smart-double-quote', 1); return '"'; });
    t = t.replace(/[\u2018\u2019\u201A\u201B]/g, () => { bump('smart-single-quote', 1); return "'"; });
    t = t.replace(/\u2026/g, () => { bump('ellipsis', 1); return '...'; });
    t = t.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, () => { bump('zero-width', 1); return ''; });
    t = t.replace(/\u00A0/g, () => { bump('nbsp', 1); return ' '; });
    // Arrows often stripped by PDF text extractors \u2014 replace with ASCII for ATS safety.
    // Consume surrounding whitespace to avoid double-spacing in output.
    t = t.replace(/\s*\u2192\s*/g, () => { bump('right-arrow', 1); return ' to '; });
    t = t.replace(/\s*\u2190\s*/g, () => { bump('left-arrow', 1); return ' from '; });
    t = t.replace(/\s*[\u2191\u2193]\s*/g, () => { bump('vert-arrow', 1); return ' '; });
    // Middle dot and bullet glyphs garble in some extractors \u2014 replace with pipe.
    t = t.replace(/\s*\u00B7\s*/g, () => { bump('middot', 1); return ' | '; });
    t = t.replace(/\s*\u2022\s*/g, () => { bump('bullet', 1); return ' | '; });
    // Currency symbols sometimes stripped by font-subsetted PDFs \u2014 spell out
    // the unambiguous ones. \u00A5 is intentionally NOT converted: it maps to both
    // Japanese Yen (JPY) and Chinese Yuan (CNY), so any spelled-out code would be
    // wrong for half of users \u2014 better to leave the glyph than emit bad data.
    t = t.replace(/\u20AC/g, () => { bump('euro', 1); return 'EUR '; });
    t = t.replace(/\u00A3/g, () => { bump('pound', 1); return 'GBP '; });
    return t;
  }
}

/**
 * Verify every inline `data:image/png;base64,...` in the HTML is an intact PNG.
 *
 * Why this exists: on 2026-08-12 a CV variant was built by copying the QR-code
 * data URI from a previous CV, and a handful of base64 characters were mangled
 * in the copy. The blob still decoded, still reported 300x300, and Chromium
 * still rendered it — but only the top half, because the IDAT zlib stream was
 * damaged partway through. It reached a generated resume PDF and was caught by
 * eye, not by the tooling.
 *
 * Every PNG chunk carries a CRC32 of its own contents, so partial corruption is
 * detectable exactly and with no false positives. Browsers deliberately ignore
 * these CRCs and render what they can; a document about to be sent to an
 * employer should not.
 */
function verifyEmbeddedPNGs(html) {
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const issues = [];
  const re = /data:image\/png;base64,([A-Za-z0-9+/=]+)/g;
  let m;
  let n = 0;

  while ((m = re.exec(html)) !== null) {
    n += 1;
    const label = `inline PNG #${n}`;
    const buf = Buffer.from(m[1], 'base64');

    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
      issues.push(`${label}: not a valid PNG (bad signature)`);
      continue;
    }

    let off = 8;
    let sawIEND = false;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32BE(off);
      const type = buf.subarray(off + 4, off + 8).toString('latin1');
      const dataEnd = off + 8 + len;
      if (dataEnd + 4 > buf.length) {
        issues.push(`${label}: chunk ${type} is truncated`);
        break;
      }
      const stored = buf.readUInt32BE(dataEnd);
      const actual = crc32(buf.subarray(off + 4, dataEnd)) >>> 0;
      if (actual !== stored) {
        issues.push(`${label}: chunk ${type} failed its CRC — the image data is corrupt and will render only partially`);
        break;
      }
      if (type === 'IEND') { sawIEND = true; break; }
      off = dataEnd + 4;
    }
    if (!sawIEND && !issues.some((i) => i.startsWith(label))) {
      issues.push(`${label}: no IEND chunk — the image is truncated`);
    }
  }

  return { count: n, issues };
}

async function generatePDF() {
  const args = process.argv.slice(2);

  // Parse arguments
  let inputPath, outputPath, format = 'a4', allowCorruptImages = false;

  for (const arg of args) {
    if (arg.startsWith('--format=')) {
      format = arg.split('=')[1].toLowerCase();
    } else if (arg === '--allow-corrupt-images') {
      allowCorruptImages = true;
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('Usage: node generate-pdf.mjs <input.html> <output.pdf> [--format=letter|a4]');
    process.exit(1);
  }

  inputPath = resolve(inputPath);
  outputPath = resolve(outputPath);

  // Validate format
  const validFormats = ['a4', 'letter'];
  if (!validFormats.includes(format)) {
    console.error(`Invalid format "${format}". Use: ${validFormats.join(', ')}`);
    process.exit(1);
  }

  console.log(`📄 Input:  ${inputPath}`);
  console.log(`📁 Output: ${outputPath}`);
  console.log(`📏 Format: ${format.toUpperCase()}`);

  // Read HTML to inject font paths as absolute file:// URLs
  let html = await readFile(inputPath, 'utf-8');

  // Resolve font paths relative to career-ops/fonts/
  const fontsDir = resolve(__dirname, 'fonts');
  html = html.replace(
    /url\(['"]?\.\/fonts\//g,
    `url('file://${fontsDir}/`
  );
  // Close any unclosed quotes from the replacement (handles all font formats)
  html = html.replace(
    /file:\/\/([^'")]+)\.(woff2?|ttf|otf)['"]?\)/g,
    `file://$1.$2')`
  );

  // Verify inline images before rendering — a corrupt QR code or logo renders
  // half-drawn and is easy to miss in a generated PDF. See verifyEmbeddedPNGs.
  const imgCheck = verifyEmbeddedPNGs(html);
  if (imgCheck.issues.length > 0) {
    console.error(`❌ Corrupt inline image(s) detected in ${inputPath}:`);
    for (const issue of imgCheck.issues) console.error(`   - ${issue}`);
    if (!allowCorruptImages) {
      console.error('   Refusing to build a document with a broken image.');
      console.error('   Fix the source (re-copy the image data), or pass --allow-corrupt-images to override.');
      process.exit(1);
    }
    console.error('   --allow-corrupt-images set; continuing anyway.');
  } else if (imgCheck.count > 0) {
    console.log(`🔎 Inline images: ${imgCheck.count} verified intact (PNG chunk CRCs OK)`);
  }

  // Normalize text for ATS compatibility (issue #1)
  const normalized = normalizeTextForATS(html);
  html = normalized.html;
  const totalReplacements = Object.values(normalized.replacements).reduce((a, b) => a + b, 0);
  if (totalReplacements > 0) {
    const breakdown = Object.entries(normalized.replacements).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`🧹 ATS normalization: ${totalReplacements} replacements (${breakdown})`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Set content with file base URL for any relative resources
    await page.setContent(html, {
      waitUntil: 'networkidle',
      baseURL: `file://${dirname(inputPath)}/`,
    });

    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: format,
      printBackground: true,
      margin: {
        top: '0.6in',
        right: '0.6in',
        bottom: '0.6in',
        left: '0.6in',
      },
      preferCSSPageSize: false,
    });

    // Write PDF
    const { writeFile } = await import('fs/promises');
    await writeFile(outputPath, pdfBuffer);

    // Count pages (approximate from PDF structure)
    const pdfString = pdfBuffer.toString('latin1');
    const pageCount = (pdfString.match(/\/Type\s*\/Page[^s]/g) || []).length;

    console.log(`✅ PDF generated: ${outputPath}`);
    console.log(`📊 Pages: ${pageCount}`);
    console.log(`📦 Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`);

    return { outputPath, pageCount, size: pdfBuffer.length };
  } finally {
    await browser.close();
  }
}

generatePDF().catch((err) => {
  console.error('❌ PDF generation failed:', err.message);
  process.exit(1);
});
