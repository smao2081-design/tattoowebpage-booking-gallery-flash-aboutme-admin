#!/bin/bash
set -euo pipefail
cd /var/app/staging || cd /var/app/current || exit 1
export NPM_CONFIG_PRODUCTION=false
npm ci --include=dev --no-audit --progress=false
npm run build
