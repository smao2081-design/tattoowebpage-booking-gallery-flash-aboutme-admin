#!/bin/bash
set -euo pipefail
# Create and enable a 1GB swapfile to reduce OOM during on-instance installs
SWAPFILE=/var/swapfile
if [ ! -f "$SWAPFILE" ]; then
  if command -v fallocate >/dev/null 2>&1; then
    fallocate -l 1G "$SWAPFILE" || dd if=/dev/zero of="$SWAPFILE" bs=1M count=1024
  else
    dd if=/dev/zero of="$SWAPFILE" bs=1M count=1024
  fi
  chmod 600 "$SWAPFILE"
  /sbin/mkswap "$SWAPFILE" || mkswap "$SWAPFILE"
fi
swapon -p 5 "$SWAPFILE" || true
echo "Swap enabled: $(swapon --show=NAME,SIZE --noheadings || true)"
