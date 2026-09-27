import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStaffRoles } from "../src/roles.js";

test("staff access is resolved by immutable Discord role IDs", () => {
  const roles = resolveStaffRoles(["100", "400"], {
    founder: "100",
    support: "400",
    sales: "500",
  });

  assert.deepEqual(roles, ["founder", "support"]);
});

test("customer and product roles cannot become staff roles", () => {
  const roles = resolveStaffRoles(["premium-customer", "game-hosting"], {
    founder: "100",
    support: "400",
  });

  assert.deepEqual(roles, []);
});
