# Legacy Hosting Discord

Discord integration for Legacy Hosting. It runs as a separate PM2 process on the Panel server and synchronizes staff access to `LH-SSO` by immutable Discord role IDs.

Discord is an input to staff provisioning, not the final authorization source. `LH-SSO` stores the effective staff roles and every protected service validates SSO-issued claims. Customer, product, notification, booster, bot, member, and muted roles never grant Hub access.

Enable the Discord `Server Members Intent`. Production uses the protected
`/etc/legacy-hosting/discord.env` file on `ams3-panel-01`; it must have mode
`0600` and use the same distinct `LH_DISCORD_INTERNAL_TOKEN` as LH-SSO.

Tags named `v*` publish immutable archives to `LH-Releases/LH-Discord`,
checksums to `SHA256`, and detached Ed25519 signatures to `SIGNATURES`. A
release fails closed when `RELEASE_SIGNING_PRIVATE_KEY_B64` is unavailable.
Deploy all three files on the Panel host with:

```bash
sudo ops/scripts/deploy-release.sh ARCHIVE CHECKSUM SIGNATURE VERSION
```

The PM2 process reports ready only after Discord authentication and guild
command registration have completed. Deploy failures restore the previous
release automatically; an explicit rollback is available through
`ops/scripts/rollback-release.sh`.

Role synchronization is persisted before each LH-SSO request. Failed requests use bounded exponential retry and survive process restarts; the latest role state replaces older pending state for the same Discord user. After the configured maximum attempts, the entry remains abandoned until `/lh-sync` explicitly retries it. Successes, scheduled retries, and abandoned entries are appended to a protected JSONL audit log without credentials or upstream response bodies.

`/lh-link` gives an eligible staff member a private, ten-minute SSO connection button after their current roles have synchronized successfully. The button opens the SSO-owned passkey confirmation page; the bot never handles SSO credentials. The one-time secret is carried in the URL fragment, validated against the configured SSO origin, and is not written to the queue or audit log. Members without an allowlisted staff role cannot request a link.

Production uses `DISCORD_SYNC_QUEUE_FILE=/var/lib/legacy-hosting-discord/sync-queue.json` and `DISCORD_SYNC_AUDIT_FILE=/var/lib/legacy-hosting-discord/sync-audit.jsonl`. Both files are forced to mode `0600` by the service.
