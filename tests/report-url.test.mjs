import { test } from "node:test";
import assert from "node:assert/strict";

import { parseReportInput, reportLink } from "../js/report-url.js";
import { base64Url, challengeFor } from "../js/auth.js";
import { killTablesQuery } from "../js/api.js";

test("parses a classic report URL", () => {
  assert.deepEqual(parseReportInput("https://classic.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2"), {
    site: "classic",
    code: "C9vGDNW7p6Aq1Ld2",
  });
});

test("ignores fight fragments, query strings and missing scheme", () => {
  assert.deepEqual(parseReportInput("classic.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2?x=1#fight=12&type=damage-done"), {
    site: "classic",
    code: "C9vGDNW7p6Aq1Ld2",
  });
  assert.equal(parseReportInput("https://www.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2").site, "www");
  assert.equal(parseReportInput("https://warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2").site, "www");
});

test("bare code uses the default site", () => {
  assert.deepEqual(parseReportInput("  C9vGDNW7p6Aq1Ld2 ", "fresh"), { site: "fresh", code: "C9vGDNW7p6Aq1Ld2" });
});

test("rejects other hosts and bad input", () => {
  assert.throws(() => parseReportInput(""), /Paste/);
  assert.throws(() => parseReportInput("https://example.com/reports/C9vGDNW7p6Aq1Ld2"), /warcraftlogs/);
  assert.throws(() => parseReportInput("https://evilwarcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2"), /warcraftlogs/);
  assert.throws(() => parseReportInput("https://classic.warcraftlogs.com/character/eu/x/y"), /report code/);
  assert.throws(() => parseReportInput("https://moon.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2"), /Unknown/);
});

test("report links", () => {
  assert.equal(reportLink("classic", "C9vGDNW7p6Aq1Ld2", 4), "https://classic.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2#fight=4");
});

test("PKCE challenge matches the RFC 7636 example", async () => {
  // RFC 7636 appendix B.
  assert.equal(
    await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  assert.equal(base64Url(new Uint8Array([251, 255])), "-_8");
});

test("kill tables query aliases each fight", () => {
  const q = killTablesQuery([3, 9]);
  assert.match(q, /dmg_3: table\(dataType: DamageDone, fightIDs: \[3\]\)/);
  assert.match(q, /heal_9: table\(dataType: Healing, fightIDs: \[9\]\)/);
});
