import { z } from "zod";

const discordLinkResponse = z.object({
  data: z.object({
    linkUrl: z.url(),
    expiresIn: z.number().int().positive().max(600),
  }),
});

export type DiscordLinkRequest = {
  discordUserId: string;
  discordGuildId: string;
};

export function createDiscordLinkRequester(options: {
  ssoUrl: string;
  internalToken: string;
  fetchImplementation?: typeof fetch;
  production?: boolean;
}) {
  const base = new URL(options.ssoUrl);
  if (options.production && base.protocol !== "https:") {
    throw new Error("LH_SSO_URL must use HTTPS in production");
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return async (payload: DiscordLinkRequest) => {
    const response = await fetchImplementation(
      new URL("/internal/discord/link-tickets", base),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.internalToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) {
      throw new Error(`LH-SSO Discord link request failed with status ${response.status}`);
    }
    const parsed = discordLinkResponse.parse(await response.json());
    const link = new URL(parsed.data.linkUrl);
    const fragment = new URLSearchParams(link.hash.slice(1));
    if (
      link.origin !== base.origin || link.pathname !== "/discord/link" || link.search ||
      !/^[A-Za-z0-9_-]{43}$/.test(fragment.get("ticket") ?? "")
    ) {
      throw new Error("LH-SSO returned an invalid Discord connection URL");
    }
    return parsed.data;
  };
}
