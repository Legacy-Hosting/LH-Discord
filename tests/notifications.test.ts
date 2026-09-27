import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAnnouncements, probeService } from "../src/notifications.js";
import type { HubDiscordConfiguration } from "../src/hub.js";

test("service probes distinguish direct latency degradation from outages", async () => {
  const operational = await probeService({
    url: "https://api.legacyhosting.xyz/health",
    timeoutMs: 1_000,
    degradedAfterMs: 5_000,
    fetchImplementation: async () => new Response("ok", { status: 200 }),
  });
  assert.equal(operational.state, "operational");

  const outage = await probeService({
    url: "https://api.legacyhosting.xyz/health",
    timeoutMs: 1_000,
    degradedAfterMs: 5_000,
    fetchImplementation: async () => new Response("no", { status: 503 }),
  });
  assert.equal(outage.state, "outage");
});

test("annual announcements use the Oslo calendar and only send once", () => {
  const configuration = {
    announcements: [{
      key: "birthday",
      enabled: true,
      title: "Birthday",
      message: "{years}",
      month: 12,
      day: 13,
      imageUrl: "https://legacyhosting.xyz/assets/icons/Birthday.png",
      channelIds: ["123456789012345678"],
      lastSentYear: 2025,
    }],
  } as HubDiscordConfiguration;
  assert.equal(dueAnnouncements(configuration, new Date("2026-12-13T12:00:00Z")).length, 1);
  configuration.announcements[0]!.lastSentYear = 2026;
  assert.equal(dueAnnouncements(configuration, new Date("2026-12-13T12:00:00Z")).length, 0);
});
