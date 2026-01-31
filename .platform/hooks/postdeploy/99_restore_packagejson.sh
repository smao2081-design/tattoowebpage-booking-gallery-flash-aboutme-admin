#!/bin/bash
set -euo pipefail
# Restore package.json after deployment so the repo tree on the instance is consistent.
if [ -f package.json.ebskip ]; then
  mv -f package.json.ebskip package.json || true
  echo "package.json restored from package.json.ebskip"
else
  echo "package.json.ebskip not found — nothing to restore"
fi
