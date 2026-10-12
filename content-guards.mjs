/**
 * content-guards.mjs — fail-closed content rules for anything rendered under
 * Joel's byline.
 *
 * ── GUARD 1: BEHAVIORAL-CONTRACT CLAUSE COUNTS ──────────────────────────────
 *
 * **NEVER STATE THE NUMBER OF CLAUSES IN A BEHAVIORAL CONTRACT.** Not a digit,
 * not a spelled-out number, not a range, not "dozens." It does not matter what
 * the count is. A behavioral contract is a living instrument, and a count
 * misrepresents it as a fixed spec. Describe the METHOD (numbered,
 * independently testable, clause-structured specifications), never the number.
 *
 * This is Joel's oldest and most-repeated standing rule and it kept resurfacing
 * anyway. On 2026-09-27 he found it again in cv.md and said: *"Why the fuck does
 * this keep coming up? ... I never want to see the clauses counted. It doesn't
 * matter what the count is."*
 *
 * **IT KEPT COMING BACK BECAUSE THE RULE LIVED IN PROSE WHILE THE SOURCE FILES
 * SAID THE OPPOSITE.** `modes/_profile.md` line 125 instructed, in terms:
 * "Specific numbers always (72-clause contract, $11M ARR, 40-75% benchmark
 * improvement)." The count was also in config/profile.yml four times,
 * article-digest.md, cv.md, and a June build. Every session read those files,
 * and the profile won unless the session happened to remember the rule. All of
 * it was purged 2026-09-27; this guard is what stops it returning, because a
 * purge is a state and a guard is a mechanism.
 *
 * Wired into BOTH render paths, which do not share one:
 *   make-application.mjs  (renders via generate-pdf.mjs)
 *   render-fallback.mjs   (the standalone renderer, LOCAL-PATCHES.md §2)
 */

const NUM_WORD =
  '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|' +
  'fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|' +
  'fifty|sixty|seventy|eighty|ninety|hundred)(?:[- ](?:one|two|three|four|five|' +
  'six|seven|eight|nine))?';

const VAGUE = '(?:dozens?|scores?|hundreds?|handful|several|numerous|many)';

const CLAUSE_COUNT_PATTERNS = [
  // "72-clause", "72 clause", "72 clauses"
  { re: /\b\d+[-\s]clauses?\b/gi, why: 'a numeric clause count' },
  // "seventy-two clauses", "twelve-clause"
  { re: new RegExp(`\\b${NUM_WORD}[-\\s]clauses?\\b`, 'gi'), why: 'a spelled-out clause count' },
  // "dozens of clauses", "a handful of clauses"
  { re: new RegExp(`\\b${VAGUE}\\s+(?:of\\s+)?clauses?\\b`, 'gi'), why: 'an approximate clause count' },
  // "clauses: 72", "clauses (72)", "clauses across 7 domains"
  { re: /\bclauses?\b[^.!?]{0,24}?\b\d+\b/gi, why: 'a clause count stated after the noun' },
  // the phrase itself
  { re: /\bclause[-\s]counts?\b/gi, why: 'an explicit reference to counting clauses' },
];

/** Strip HTML to visible text so guard comments in the source never trip it. */
export function visibleText(html) {
  let body = html.split(/<body[^>]*>/i)[1] ?? html;
  body = body.replace(/<!--[\s\S]*?-->/g, ' ');
  body = body.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  body = body.replace(/<[^>]+>/g, ' ');
  return body
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ');
}

/** Returns [{match, why}] for every clause count found. Empty means clean. */
export function findClauseCounts(text) {
  const hits = [];
  for (const { re, why } of CLAUSE_COUNT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ match: m[0].trim(), why });
  }
  // de-duplicate on the matched string
  const seen = new Set();
  return hits.filter(h => !seen.has(h.match.toLowerCase()) && seen.add(h.match.toLowerCase()));
}

/**
 * ── GUARD 2: CONTINENT COUNTS ──────────────────────────────────────────────
 *
 * **NEVER STATE A CONTINENT COUNT.** The org is in the U.S., India and China.
 * That is THREE COUNTRIES and TWO CONTINENTS, and materials have claimed
 * "three continents" and "four continents" for months. The correct framings are
 * "three countries" or Joel's own site wording, "a globally distributed design
 * org." A count is arithmetic anyone can check against the location list in the
 * same document, which is exactly what an automated consistency pass does.
 *
 * **HE ALREADY FIXED THIS ONCE AND IT DID NOT PROPAGATE.** goldfoot.com commit
 * ae87993, "Item 2b: replace 'two continents' with 'globally distributed'",
 * plus a locked site rule of no city list. The site had the arithmetic RIGHT
 * and still went vaguer. career-ops never inherited any of it: config/profile.yml
 * said "4 continents (US, India, China)" and every build since said "three
 * continents", including a CV submitted to PointClickCare on 2026-09-27.
 * Purged repo-wide 2026-09-27. This guard is the mechanism; the purge was only
 * a state.
 */
const CONTINENT_PATTERNS = [
  { re: /\b\d+\s+continents?\b/gi, why: 'a numeric continent count' },
  { re: new RegExp(`\\b${NUM_WORD}\\s+continents?\\b`, 'gi'), why: 'a spelled-out continent count' },
];

/** Returns [{match, why}] for every continent count found. */
export function findContinentCounts(text) {
  const hits = [];
  for (const { re, why } of CONTINENT_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ match: m[0].trim(), why });
  }
  const seen = new Set();
  return hits.filter(h => !seen.has(h.match.toLowerCase()) && seen.add(h.match.toLowerCase()));
}

/**
 * ── GUARD 3: SELF-DISQUALIFYING CONFESSIONS ────────────────────────────────
 *
 * **NEVER SPEND APPLICATION TEXT ON WHAT JOEL IS NOT.** No "two things I will
 * not overstate," no volunteered missing degree, no "I have not worked in X."
 * A screener reads the letter first; a paragraph of gaps gets him rejected
 * before the resume is opened. The FORM carries facts like education; the
 * letter carries the argument.
 *
 * Joel corrected this on the PointClickCare letter 2026-09-27 (*"Why are you
 * spending an entire paragraph telling them what I am not?"*) and the rule was
 * written only into career-2026/data/education-and-positioning.md, which no
 * build reads. On 2026-10-12 the ServiceNow letter repeated it, copied from a
 * PointClickCare HTML source that still held the rejected draft. Joel: "It
 * sounds VERY AI ... I would be rejected before they even look at my resume."
 */
const CONFESSION_PATTERNS = [
  { re: /\b(?:will|would) not (?:overstate|oversell)\b/gi, why: 'a gaps-confession opener' },
  { re: /\b(?:do not|don't|never) (?:hold|have|earned) an? (?:[\w']+ )?degree\b/gi, why: 'a volunteered missing degree' },
  { re: /\bwithout an? (?:[\w']+ )?degree\b/gi, why: 'a volunteered missing degree' },
  { re: /\bI (?:have not|haven't|have never) worked in\b/gi, why: 'a volunteered domain gap' },
  { re: /\bwhat I (?:hold|offer|bring) instead\b/gi, why: 'a gap-then-compensation pivot' },
  { re: /\bI would rather you know\b/gi, why: 'a pre-emptive confession close' },
];

/** Returns [{match, why}] for every self-disqualifying phrase found. */
export function findConfessions(text) {
  const hits = [];
  for (const { re, why } of CONFESSION_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) hits.push({ match: m[0].trim(), why });
  }
  return hits;
}

/** Fails closed. Call before rendering anything that carries Joel's byline. */
export function assertContentRules(src, rawHtml) {
  const text = visibleText(rawHtml);

  const continents = findContinentCounts(text);
  if (continents.length) {
    console.error(`REFUSED: continent count in ${src}`);
    continents.forEach(h => console.error(`  - "${h.match}"  (${h.why})`));
    console.error('');
    console.error('The org is in the U.S., India and China: THREE COUNTRIES, TWO CONTINENTS.');
    console.error('Write "three countries", or "a globally distributed design org".');
    console.error('A continent count is arithmetic a reader can check against the location');
    console.error('list in the same document.');
    process.exit(3);
  }

  const confessions = findConfessions(text);
  if (confessions.length) {
    console.error(`REFUSED: self-disqualifying text in ${src}`);
    confessions.forEach(h => console.error(`  - "${h.match}"  (${h.why})`));
    console.error('');
    console.error('Never spend application text on what Joel is not. Let the form carry');
    console.error('education; the letter carries the argument. (Joel, 2026-09-27 and 2026-10-12)');
    process.exit(3);
  }

  assertNoClauseCounts(src, rawHtml);
}

export function assertNoClauseCounts(src, rawHtml) {
  const hits = findClauseCounts(visibleText(rawHtml));
  if (!hits.length) return;
  console.error(`REFUSED: behavioral-contract clause count in ${src}`);
  hits.forEach(h => console.error(`  - "${h.match}"  (${h.why})`));
  console.error('');
  console.error('STANDING RULE, NO EXCEPTIONS: never state the number of clauses in a');
  console.error('behavioral contract. Not a digit, not a word, not a range, not "dozens."');
  console.error('It does not matter what the count is. Contracts are living instruments.');
  console.error('Describe the METHOD instead: "numbered, independently testable,');
  console.error('clause-structured specifications governing AI system behavior."');
  process.exit(3);
}
