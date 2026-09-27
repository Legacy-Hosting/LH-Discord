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

marker_existed=false
marker_value=
if [[ -f $base/current-release ]]; then
  marker_existed=true
  marker_value=$(cat "$base/current-release")
fi
rollback_on_error() {
  failure=$?
  trap - ERR
  ln -sfn "$current" "$base/current"
  ln -sfn "$previous" "$base/previous"
  if [[ $marker_existed == true ]]; then
    printf '%s\n' "$marker_value" > "$base/current-release"
  else
    rm -f -- "$base/current-release"
  fi
  pm2 delete lh-discord >/dev/null 2>&1 || true
  pm2 start "$current/ecosystem.config.cjs" --update-env >/dev/null 2>&1 || true
  pm2 save >/dev/null 2>&1 || true
  exit "$failure"
}
trap rollback_on_error ERR
ln -sfn "$previous" "$base/current"
ln -sfn "$current" "$base/previous"
pm2 delete lh-discord >/dev/null 2>&1 || true
pm2 start "$previous/ecosystem.config.cjs" --update-env
pm2 save
basename "$previous" > "$base/current-release"
"$previous/ops/scripts/verify-release.sh"
trap - ERR
echo "LH-Discord rolled back to $(basename "$previous")."
