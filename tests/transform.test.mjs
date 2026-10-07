import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildModel, buildPulls, buildDeaths, summariseBosses, summariseDeaths, normalisePercent,
  difficultyLabel, formatDuration, formatNumber, toCsv, PULL_COLUMNS,
} from "../js/transform.js";

const demo = JSON.parse(readFileSync(new URL("../demo/demo-report.json", import.meta.url)));

const fight = (id, encounterID, kill, startTime, endTime, bossPercentage = null, extra = {}) => ({
  id, encounterID, name: encounterID ? `Boss ${encounterID}` : "Trash", difficulty: 3, size: 10,
  kill, startTime, endTime, bossPercentage, fightPercentage: bossPercentage, ...extra,
});

test("trash fights are dropped and pulls are numbered per boss", () => {
  const pulls = buildPulls([
    fight(1, 0, null, 0, 1000),
    fight(2, 100, false, 2000, 5000, 40),
    fight(3, 200, false, 6000, 7000, 90),
    fight(4, 100, true, 8000, 12000, 0),
  ]);
  assert.deepEqual(pulls.map((p) => [p.id, p.pullNo]), [[2, 1], [3, 1], [4, 2]]);
  assert.equal(pulls[2].bossPct, 0);
  assert.equal(pulls[0].durationMs, 3000);
});

test("same boss on another difficulty counts as a separate boss", () => {
  const pulls = buildPulls([
    fight(1, 100, true, 0, 10, 0),
    fight(2, 100, false, 20, 30, 50, { difficulty: 4 }),
  ]);
  assert.equal(summariseBosses(pulls).length, 2);
});

test("boss summary: pulls to kill, best wipe, time spent", () => {
  const pulls = buildPulls([
    fight(1, 100, false, 0, 60_000, 55.5),
    fight(2, 100, false, 70_000, 160_000, 12.25),
    fight(3, 100, true, 200_000, 500_000, 0),
    fight(4, 100, true, 600_000, 850_000, 0),
  ]);
  const [b] = summariseBosses(pulls);
  assert.equal(b.pulls, 4);
  assert.equal(b.kills, 2);
  assert.equal(b.wipes, 2);
  assert.equal(b.pullsToKill, 3);
  assert.equal(b.bestWipePct, 12.25);
  assert.equal(b.killDurationMs, 300_000);
  assert.equal(b.timeSpentMs, 60_000 + 90_000 + 300_000 + 250_000);
});

test("percent on the old 0-10000 scale is normalised", () => {
  assert.equal(normalisePercent(4550), 45.5);
  assert.equal(normalisePercent(45.5), 45.5);
  assert.equal(normalisePercent(null), null);
});

test("deaths: players only, matched to pulls, ordered, ability named", () => {
  const pulls = buildPulls([fight(5, 100, false, 1000, 9000, 30), fight(6, 100, true, 10_000, 20_000, 0)]);
  const players = [{ id: 1, name: "Ann", cls: "Mage" }, { id: 2, name: "Bob", cls: "Priest" }];
  const events = [
    { timestamp: 8000, type: "death", targetID: 2, fight: 5, killingAbilityGameID: 77 },
    { timestamp: 4000, type: "death", targetID: 1, fight: 5, killingAbilityGameID: 88 },
    { timestamp: 4500, type: "death", targetID: 999, fight: 5 }, // a pet
    { timestamp: 12_000, type: "death", targetID: 1, abilityGameID: 77 }, // no fight id: matched by time
    { timestamp: 500, type: "death", targetID: 1 }, // outside any pull
  ];
  const deaths = buildDeaths(events, pulls, players, [{ gameID: 77, name: "Fire" }, { gameID: 88, name: "Ice" }]);
  assert.deepEqual(
    deaths.map((d) => [d.pullId, d.player, d.order, d.ability, d.atMs]),
    [[5, "Ann", 1, "Ice", 3000], [5, "Bob", 2, "Fire", 7000], [6, "Ann", 1, "Fire", 2000]],
  );

  const stats = summariseDeaths(deaths, players);
  assert.deepEqual(stats.byPlayer[0], { name: "Ann", cls: "Mage", deaths: 2, firstDeaths: 2 });
  assert.deepEqual(stats.byAbility, [{ ability: "Fire", count: 2 }, { ability: "Ice", count: 1 }]);
});

test("demo report builds a complete model", () => {
  const m = buildModel(demo);
  assert.equal(m.totals.pulls, 20);
  assert.equal(m.totals.kills + m.totals.wipes, m.totals.pulls);
  assert.equal(m.totals.bossesSeen, 4);
  assert.equal(m.totals.bossesKilled, 3);
  assert.equal(m.kills.length, 3);
  assert.equal(m.totals.deaths, m.deaths.length);
  assert.equal(m.totals.players, 10);

  // Every kill's damage list is sorted and has positive DPS.
  for (const k of m.kills) {
    assert.ok(k.damage.length > 0);
    for (let i = 1; i < k.damage.length; i++) assert.ok(k.damage[i - 1].total >= k.damage[i].total);
    assert.ok(k.damage.every((d) => d.perSecond > 0));
  }

  // Unkilled boss has no kill stats.
  const spiritKings = m.bosses.find((b) => b.boss === "The Spirit Kings");
  assert.equal(spiritKings.killed, false);
  assert.equal(spiritKings.pullsToKill, null);
});

test("an empty report doesn't throw", () => {
  const m = buildModel({ report: { code: "x", title: "Empty", startTime: 0, endTime: 0, fights: [] } });
  assert.equal(m.totals.pulls, 0);
  assert.deepEqual(m.kills, []);
});

test("formatting helpers", () => {
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_725_000), "1h 02m");
  assert.equal(formatDuration(null), "–");
  assert.equal(formatNumber(1234), "1,234");
  assert.equal(formatNumber(56_789), "56.8k");
  assert.equal(formatNumber(2_500_000), "2.50M");
  assert.equal(difficultyLabel(4, 25), "25-man Heroic");
  assert.equal(difficultyLabel(null, null), "");
});

test("CSV quotes awkward values", () => {
  const pulls = [{ id: 1, boss: 'Gara\'jal, "the" Spiritbinder', difficulty: "10-man Normal", pullNo: 1, kill: false, durationMs: 61_400, bossPct: 9 }];
  const csv = toCsv(pulls, PULL_COLUMNS);
  assert.equal(csv.split("\n")[1], '1,"Gara\'jal, ""the"" Spiritbinder",10-man Normal,1,wipe,61,9');
});
