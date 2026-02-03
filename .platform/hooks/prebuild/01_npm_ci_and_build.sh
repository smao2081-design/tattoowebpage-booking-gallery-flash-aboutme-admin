#!/bin/bash
# No-op prebuild hook: CI produces the production build and packages it.
# Leaving a minimal script here to avoid on-instance builds that can OOM or
# use different Node versions. This will prevent the instance from running
# `npm ci` and `npm run build` during deployment.
exit 0
