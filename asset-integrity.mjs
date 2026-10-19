/**
 * asset-integrity.mjs — validate embedded data: URIs before a PDF is rendered.
 *
 * WHY THIS EXISTS: a corrupt base64 data: URI renders as a BROKEN-IMAGE ICON
 * plus its alt text, and every check upstream of it passes. The base64 is one
 * unreadable line so a diff looks plausible, Chromium renders the page without
 * erroring, and the page count is unchanged. Nothing fails.
 *
 * On 2026-09-16 a CV authored from templates/cv-template.html lost 225
 * characters out of the LinkedIn QR's base64. That file was copied forward to
 * TRM Labs the same day and to Xapo Bank on 09-23, so all three built
 * applications carried a broken-image icon beside Joel's name. It was caught on
 * 2026-09-27 only because Joel opened the PDF before sending it.
 *
 * The twelve CVs built between 2026-06-15 and 2026-09-11 all carry a
 * byte-identical, valid QR, so templates/cv-template.html is the canonical
 * source to restore from.
 *
 * Wired into BOTH build paths, because they do not share one:
 *   make-application.mjs  (renders via generate-pdf.mjs)
 *   render-fallback.mjs   (the standalone renderer, LOCAL-PATCHES.md §2)
 */

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Returns an array of human-readable problems. Empty array means clean.
 * Walks every PNG chunk and verifies its CRC, so a single flipped byte in the
 * middle of the stream is caught, not just a length break.
 */
export function checkEmbeddedAssets(html) {
  const problems = [];
  const uris = [...html.matchAll(/src="data:image\/png;base64,([^"]+)"/g)];
  uris.forEach(([, b64], i) => {
    const label = `embedded PNG #${i + 1}`;
    if (b64.length % 4 !== 0) {
      problems.push(`${label}: base64 length ${b64.length} is not a multiple of 4 (characters lost)`);
      return;
    }
    const buf = Buffer.from(b64, 'base64');
    if (buf.subarray(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') {
      problems.push(`${label}: missing PNG signature`);
      return;
    }
    let pos = 8, sawEnd = false;
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
      if (pos + 12 + len > buf.length) {
        problems.push(`${label}: chunk ${type} overruns the buffer (truncated)`);
        return;
      }
      if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) {
        problems.push(`${label}: CRC mismatch in chunk ${type} (bytes mangled)`);
        return;
      }
      pos += 12 + len;
      if (type === 'IEND') { sawEnd = true; break; }
    }
    if (!sawEnd) problems.push(`${label}: no IEND chunk`);
  });
  return problems;
}

/** Fails closed. Call before rendering. */
export function assertEmbeddedAssetsValid(src, html) {
  const problems = checkEmbeddedAssets(html);
  if (!problems.length) return;
  console.error(`REFUSED: corrupt embedded asset in ${src}`);
  problems.forEach(p => console.error('  - ' + p));
  console.error('A corrupt data: URI renders as a broken-image icon with its alt text showing.');
  console.error('Restore it from templates/cv-template.html, which holds the canonical QR.');
  process.exit(2);
}
