# CV house style — canonical copies + restore procedure

**`documents/` is USER layer (`USER_PATHS` in `update-system.mjs`). Nothing here is ever
touched by `node update-system.mjs apply`. These are the authoritative copies.**

## What this protects

Joel's locked CV house style: monochrome ink `#1a1a2e`, one self-hosted font (DM Sans),
no gradient line, no colored accents, QR code embedded as a base64 data URI (ATS-safe,
92px, beside the name block), competencies as a "·"-joined inline list.

Canonical origin commit: **190d962** ("Preserve the monochrome CV house-style redesign").

## The vulnerability — read this before running an update

The house style lives in **`templates/cv-template.html`** and **`modes/pdf.md`**, and
**both are SYSTEM-layer paths that upstream ships.** Two consequences:

1. `update-system.mjs apply` **overwrites both** with upstream's generic template.
2. The updater's preservation logic (`locallyModifiedSystemFiles`) only protects system
   files that are **dirty in the working tree**. Joel's house style is **committed**, so
   it is invisible to that check — **no warning, no `.bak`.**
3. Declaring them in `config/local-paths.txt` **does not work**: the updater explicitly
   refuses to accept a path that `SYSTEM_PATHS` ships ("Declaring it would stop updates
   to it with no other signal"). That route is closed by design.

**Committing the customization — correct hygiene — is exactly what makes it vulnerable.**

*This is not hypothetical. The v1.10.0 → v1.31.0 update on 2026-08-31 clobbered both
files. Caught and restored the same turn. Related: the 2026-08-28 near-miss, when a
resume was nearly sent built from a stale pre-house-style template.*

## After EVERY `update-system.mjs apply`, run this

```bash
bash documents/house-style/verify.sh
```

It exits non-zero and tells you what to do if the house style has been overwritten.

## To restore

```bash
cp documents/house-style/cv-template.html templates/cv-template.html
cp documents/house-style/pdf.md modes/pdf.md
```

Then re-add the `qrcode` dependency to `package.json` if the update dropped it
(`"qrcode": "^1.5.4"` — upstream does not ship it, and the QR generation needs it).

## If you intentionally change the house style

Edit `templates/cv-template.html`, then **copy it back here in the same turn**, or the
next update silently reverts your change to whatever these copies hold.
