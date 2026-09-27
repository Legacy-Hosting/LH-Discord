#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 || $# -ne 4 ]]; then
  echo "Usage as root: $0 ARCHIVE CHECKSUM SIGNATURE VERSION" >&2
  exit 2
fi
version=$4
if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]]; then
  echo "Invalid Discord release version" >&2
  exit 1
fi
verifier=/usr/local/lib/legacy-hosting-ops/verify-release-artifact.sh
public_key=/etc/legacy-hosting/release-keys/lh-discord.pub
if [[ ! -x $verifier || ! -r $public_key ]]; then
  echo "Discord release verifier or pinned public key is not installed" >&2
  exit 1
fi
"$verifier" "$public_key" "$1" "$2" "$3"
archive=$(readlink -f "$1")

base=/opt/legacy-hosting/discord
release="$base/releases/$version"
environment_file=/etc/legacy-hosting/discord.env
if [[ -e $release ]]; then
  echo "Discord release already exists: $release" >&2
  exit 1
fi
install -d -m 0755 "$base/releases"
install -d -m 0750 /var/lib/legacy-hosting-discord
staging=$(mktemp -d "$base/releases/.staging-${version}.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
tar -xzf "$archive" --no-same-owner --strip-components=1 -C "$staging"
for path in package.json pnpm-lock.yaml pnpm-workspace.yaml ecosystem.config.cjs \
  dist/src/index.js ops/scripts/validate-production-env.sh; do
  if [[ ! -e $staging/$path ]]; then
    echo "Discord release is missing $path" >&2
    exit 1
  fi
done
"$staging/ops/scripts/validate-production-env.sh" "$environment_file"
ln -s "$environment_file" "$staging/.env"
pnpm --dir "$staging" install --prod --frozen-lockfile
set -a
. "$environment_file"
set +a
curl --fail --silent --show-error --retry 5 --retry-delay 2 \
  --connect-timeout 5 "${LH_SSO_URL%/}/health" >/dev/null
chown -R root:root "$staging"
chmod 0755 "$staging"
mv "$staging" "$release"
trap - EXIT

previous=
if [[ -L $base/current ]]; then
  previous=$(readlink -f "$base/current" 2>/dev/null || true)
  if [[ -n $previous && $previous == "$base/releases/"* && -d $previous ]]; then
    ln -sfn "$previous" "$base/previous"
  else
    echo "Current Discord symlink points outside the release directory" >&2
    exit 1
  fi
elif [[ -e $base/current ]]; then
  echo "$base/current must be a release symlink" >&2
  exit 1
fi
ln -sfn "$release" "$base/current"

rollback_on_error() {
  pm2 delete lh-discord >/dev/null 2>&1 || true
  if [[ -n $previous && -d $previous ]]; then
    ln -sfn "$previous" "$base/current"
    pm2 start "$previous/ecosystem.config.cjs" --update-env || true
  else
    rm -f -- "$base/current"
  fi
}
trap rollback_on_error ERR
pm2 delete lh-discord >/dev/null 2>&1 || true
pm2 start "$release/ecosystem.config.cjs" --update-env
pm2 save
CURRENT_RELEASE="$release" node <<'NODE'
const { execFileSync } = require("node:child_process");
const processInfo = JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" }))
  .find((item) => item.name === "lh-discord");
if (processInfo?.pm2_env?.status !== "online") throw new Error("lh-discord is not online");
if (!processInfo.pm2_env.pm_exec_path?.startsWith(`${process.env.CURRENT_RELEASE}/`)) {
  throw new Error("lh-discord is not running from the selected release");
}
NODE
trap - ERR

printf '%s\n' "$version" > "$base/current-release"
echo "LH-Discord $version deployed and verified."
