# Legacy Hosting Discord

Discord integration for Legacy Hosting. It runs as a separate PM2 process on the Panel server and synchronizes staff access to `LH-SSO` by immutable Discord role IDs.

Discord is an input to staff provisioning, not the final authorization source. `LH-SSO` stores the effective staff roles and every protected service validates SSO-issued claims. Customer, product, notification, booster, bot, member, and muted roles never grant Hub access.

Enable the Discord `Server Members Intent`. Production uses the protected
`/etc/legacy-hosting/discord.env` file on `ams3-panel-01`; it must have mode
`0600` and use the same distinct `LH_DISCORD_INTERNAL_TOKEN` as LH-SSO.

Tags named `v*` publish immutable archives to `LH-Releases/LH-Discord` and
checksums to its `SHA256` directory. Deploy the matching archive and checksum
on the Panel host with:

```bash
sudo ops/scripts/deploy-release.sh ARCHIVE CHECKSUM VERSION
```

The PM2 process reports ready only after Discord authentication and guild
command registration have completed. Deploy failures restore the previous
release automatically; an explicit rollback is available through
`ops/scripts/rollback-release.sh`.
