import assert from "node:assert/strict";
import { test } from "node:test";
import { dueAnnouncements, isServiceUnderMaintenance, probeService } from "../src/notifications.js";
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

test("maintenance suppresses status notifications for every affected service only during its window", () => {
  const configuration = {
    maintenance: [{
      id: "maintenance-1",
      targetKeys: ["api", "sso"],
      impact: "major",
      title: "Platform maintenance",
      message: "Updating shared infrastructure.",
      scheduledFor: "2026-09-27T20:00:00.000Z",
      scheduledUntil: "2026-09-27T21:00:00.000Z",
      status: "in_progress",
    }],
  } as HubDiscordConfiguration;
  const during = Date.parse("2026-09-27T20:30:00.000Z");
  assert.equal(isServiceUnderMaintenance(configuration, "api", during), true);
  assert.equal(isServiceUnderMaintenance(configuration, "sso", during), true);
  assert.equal(isServiceUnderMaintenance(configuration, "panel", during), false);
  assert.equal(isServiceUnderMaintenance(configuration, "api", Date.parse("2026-09-27T21:00:00.000Z")), false);
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
