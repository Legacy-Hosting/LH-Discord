#!/usr/bin/env bash
set -Eeuo pipefail

base=/opt/legacy-hosting/discord
test -L "$base/current"
test -f "$base/current-release"
pm2 describe lh-discord >/dev/null
current_release=$(readlink -f "$base/current")
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
