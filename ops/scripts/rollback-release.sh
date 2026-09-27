#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root" >&2
  exit 1
fi
base=/opt/legacy-hosting/discord
if [[ ! -L $base/current || ! -L $base/previous ]]; then
  echo "Both current and previous Discord releases are required" >&2
  exit 1
fi
current=$(readlink -f "$base/current")
previous=$(readlink -f "$base/previous")
for release in "$current" "$previous"; do
  if [[ $release != "$base/releases/"* || ! -d $release ]]; then
    echo "Discord release symlink points outside $base/releases" >&2
    exit 1
  fi
done

ln -sfn "$previous" "$base/current"
ln -sfn "$current" "$base/previous"
pm2 delete lh-discord >/dev/null 2>&1 || true
pm2 start "$previous/ecosystem.config.cjs" --update-env
pm2 save
basename "$previous" > "$base/current-release"
"$previous/ops/scripts/verify-release.sh"
echo "LH-Discord rolled back to $(basename "$previous")."
