# Legacy Hosting Discord

Discord integration for Legacy Hosting. It runs as a separate PM2 process on the Panel server and synchronizes staff access to `LH-SSO` by immutable Discord role IDs.

Discord is an input to staff provisioning, not the final authorization source. `LH-SSO` stores the effective staff roles and every protected service validates SSO-issued claims. Customer, product, notification, booster, bot, member, and muted roles never grant Hub access.

Enable the Discord `Server Members Intent`, copy `.env.example` to a protected `.env`, build, and run `pm2 startOrReload ecosystem.config.cjs --update-env`.
