#!/usr/bin/env bash
set -Eeuo pipefail

base=/opt/legacy-hosting/discord
test -L "$base/current"
test -f "$base/current-release"
test -d /var/lib/legacy-hosting-discord
pm2 describe lh-discord >/dev/null
current_release=$(readlink -f "$base/current")
recorded_release=$(cat "$base/current-release")
if [[ $recorded_release != "$(basename "$current_release")" ]]; then
  echo "Discord current-release marker does not match the current symlink" >&2
  exit 1
fi
if [[ $current_release != "$base/releases/"* ]]; then
  echo "Discord current symlink points outside the release directory" >&2
  exit 1
fi
CURRENT_RELEASE="$current_release" node <<'NODE'
const { execFileSync } = require("node:child_process");
const processInfo = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" }))
  .find((item) => item.name === "lh-discord");
if (processInfo?.pm2_env?.status !== "online") throw new Error("lh-discord is not online");
if (!processInfo.pm2_env.pm_exec_path?.startsWith(`${process.env.CURRENT_RELEASE}/`)) {
  throw new Error(`lh-discord is not running from ${process.env.CURRENT_RELEASE}`);
}
NODE
echo "LH-Discord release verification passed for $(cat "$base/current-release")."
