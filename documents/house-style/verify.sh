#!/usr/bin/env bash
# Verify the CV house style survived the last update. See RESTORE.md.
set -u
cd "$(dirname "$0")/../.." || exit 2
fail=0
for pair in "templates/cv-template.html:documents/house-style/cv-template.html" \
            "modes/pdf.md:documents/house-style/pdf.md"; do
  live="${pair%%:*}"; canon="${pair##*:}"
  if [ ! -f "$live" ]; then echo "MISSING: $live"; fail=1; continue; fi
  if ! diff -q "$live" "$canon" >/dev/null 2>&1; then
    echo "DRIFT: $live differs from the canonical house style ($canon)"
    fail=1
  fi
done
if ! grep -q '"qrcode"' package.json 2>/dev/null; then
  echo "DRIFT: package.json is missing the qrcode dependency (QR generation needs it)"
  fail=1
fi
if [ "$fail" -eq 0 ]; then
  echo "OK: CV house style intact (monochrome + QR)."
else
  echo ""
  echo "The update overwrote the house style. Restore:"
  echo "  cp documents/house-style/cv-template.html templates/cv-template.html"
  echo "  cp documents/house-style/pdf.md modes/pdf.md"
  echo "If this drift was an INTENTIONAL house-style change, copy the live files"
  echo "into documents/house-style/ instead. See documents/house-style/RESTORE.md."
fi
exit "$fail"
