import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { DiscordServiceState, HubDiscordConfiguration } from "./hub.js";

const notificationStateSchema = z.object({
  version: z.literal(1),
  services: z.record(z.string(), z.enum(["operational", "degraded", "outage", "maintenance"])),
  maintenance: z.record(z.string(), z.enum(["scheduled", "in_progress", "completed", "cancelled"])),
});
export type NotificationState = z.infer<typeof notificationStateSchema>;

export function createNotificationStateStore(path: string) {
  return {
    async load(): Promise<NotificationState> {
      try {
        return notificationStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return { version: 1, services: {}, maintenance: {} };
        }
        throw error;
      }
    },
    async save(value: NotificationState) {
      await mkdir(dirname(path), { recursive: true, mode: 0o750 });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(notificationStateSchema.parse(value))}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, path);
      await chmod(path, 0o600);
    },
  };
}

export async function probeService(options: {
  url: string;
  timeoutMs: number;
  degradedAfterMs: number;
  fetchImplementation?: typeof fetch;
}) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const startedAt = performance.now();
  try {
    const response = await fetchImplementation(options.url, {
      method: "GET",
      headers: { accept: "application/json,text/html;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const state: DiscordServiceState = !response.ok
      ? "outage"
      : latencyMs >= options.degradedAfterMs
        ? "degraded"
        : "operational";
    return { state, latencyMs };
  } catch {
    return { state: "outage" as const, latencyMs: null };
  }
}

export function osloCalendar(now = new Date()) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Oslo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
  return { year: values.year ?? now.getUTCFullYear(), month: values.month ?? 1, day: values.day ?? 1 };
}

export function dueAnnouncements(configuration: HubDiscordConfiguration, now = new Date()) {
  const date = osloCalendar(now);
  return configuration.announcements.filter((announcement) =>
    announcement.enabled &&
    announcement.channelIds.length > 0 &&
    announcement.month === date.month &&
    announcement.day === date.day &&
    announcement.lastSentYear !== date.year
  ).map((announcement) => ({ ...announcement, year: date.year }));
}
