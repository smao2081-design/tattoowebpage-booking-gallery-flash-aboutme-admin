#!/bin/bash
set -euo pipefail
# Prevent Elastic Beanstalk from running `npm install` on the instance by
# temporarily renaming package.json before EB's prebuild phase.
if [ -f package.json ]; then
  if [ ! -f package.json.ebskip ]; then
    mv package.json package.json.ebskip || true
    echo "package.json moved to package.json.ebskip to skip on-instance npm install"
  else
    echo "package.json.ebskip already exists — leaving as-is"
  fi
fi
