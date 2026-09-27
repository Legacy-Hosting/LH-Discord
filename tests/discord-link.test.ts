import assert from "node:assert/strict";
import { test } from "node:test";
import { createDiscordLinkRequester } from "../src/discord-link.js";

const token = "s".repeat(32);
const ticket = "t".repeat(43);

test("Discord link requests use the internal contract and accept only the SSO origin", async () => {
  let requestBody = "";
  const request = createDiscordLinkRequester({
    ssoUrl: "https://auth.legacyhosting.xyz",
    internalToken: token,
    fetchImplementation: async (input, init) => {
      assert.equal(String(input), "https://auth.legacyhosting.xyz/internal/discord/link-tickets");
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
      requestBody = String(init?.body);
      return Response.json({
        data: {
          linkUrl: `https://auth.legacyhosting.xyz/discord/link#ticket=${ticket}`,
          expiresIn: 600,
        },
      }, { status: 201 });
    },
  });
  const result = await request({
    discordUserId: "92345678901234567",
    discordGuildId: "82345678901234567",
  });
  assert.deepEqual(JSON.parse(requestBody), {
    discordUserId: "92345678901234567",
    discordGuildId: "82345678901234567",
  });
  assert.equal(result.linkUrl, `https://auth.legacyhosting.xyz/discord/link#ticket=${ticket}`);
});

test("Discord link requests reject an unexpected origin or path", async () => {
  const request = createDiscordLinkRequester({
    ssoUrl: "https://auth.legacyhosting.xyz",
    internalToken: token,
    fetchImplementation: async () => Response.json({
      data: {
        linkUrl: `https://attacker.example/discord/link#ticket=${ticket}`,
        expiresIn: 600,
      },
    }),
  });
  await assert.rejects(
    request({ discordUserId: "92345678901234567", discordGuildId: "82345678901234567" }),
    /invalid Discord connection URL/,
  );
});

test("production link requests require HTTPS", () => {
  assert.throws(() => createDiscordLinkRequester({
    ssoUrl: "http://auth.legacyhosting.xyz",
    internalToken: token,
    production: true,
  }), /must use HTTPS/);
});
