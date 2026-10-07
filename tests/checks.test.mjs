import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildModel, buildPulls, buildAvoidableHits, summariseAvoidable, buildActions, summariseActions,
  buildConsumables, playerChecks,
} from "../js/transform.js";
import { isAvoidable, avoidableAbilityIds } from "../js/avoidable.js";
import { buffTablesQuery } from "../js/api.js";

const demo = JSON.parse(readFileSync(new URL("../demo/demo-report.json", import.meta.url)));

const players = [
  { id: 1, name: "Ann", cls: "Mage" },
  { id: 2, name: "Bob", cls: "Priest" },
  { id: 3, name: "Cal", cls: "Rogue" },
];
const abilities = [
  { gameID: 10, name: "Lightning Fists" },
  { gameID: 11, name: "Epicenter" },
  { gameID: 12, name: "Amethyst Pool" },
  { gameID: 20, name: "Shadow Bolt" },
  { gameID: 30, name: "Frail Soul" },
];
const pulls = buildPulls([
  { id: 1, encounterID: 1390, name: "Feng the Accursed", difficulty: 3, size: 10, kill: false, startTime: 0, endTime: 100_000, bossPercentage: 40, friendlyPlayers: [1, 2, 3] },
  { id: 2, encounterID: 1395, name: "The Stone Guard", difficulty: 3, size: 10, kill: true, startTime: 200_000, endTime: 300_000, bossPercentage: 0, friendlyPlayers: [1, 2] },
]);

test("avoidable list matches names case-insensitively, per boss", () => {
  assert.equal(isAvoidable("feng the accursed", "lightning fists"), true);
  assert.equal(isAvoidable("The Stone Guard", "Lightning Fists"), false);
  assert.equal(isAvoidable("Not A Boss", "Epicenter"), false);
  assert.deepEqual(avoidableAbilityIds(new Set(["Feng the Accursed"]), abilities), [10, 11]);
});

test("avoidable hits: only listed abilities on the right boss, absorbs included", () => {
  const events = [
    { timestamp: 5000, type: "damage", targetID: 1, abilityGameID: 10, fight: 1, amount: 100, absorbed: 50 },
    { timestamp: 6000, type: "damage", targetID: 1, abilityGameID: 11, fight: 1, amount: 200 },
    { timestamp: 7000, type: "damage", targetID: 3, abilityGameID: 10, fight: 1, amount: 400 },
    { timestamp: 8000, type: "damage", targetID: 2, abilityGameID: 10, fight: 2, amount: 999 }, // Fists isn't a Stone Guard ability
    { timestamp: 9000, type: "damage", targetID: 99, abilityGameID: 10, fight: 1, amount: 999 }, // not a player
    { timestamp: 9500, type: "absorbed", targetID: 1, abilityGameID: 10, fight: 1, amount: 999 },
  ];
  const rows = buildAvoidableHits(events, pulls, players, abilities);
  assert.equal(rows.length, 3);
  const s = summariseAvoidable(rows, players);
  assert.equal(s.total, 750);
  assert.deepEqual(s.byPlayer.map((p) => [p.name, p.total, p.hits]), [["Cal", 400, 1], ["Ann", 350, 2], ["Bob", 0, 0]]);
  assert.deepEqual(s.byAbility[0], { ability: "Lightning Fists", total: 550, hits: 2, worst: [["Ann", 1], ["Cal", 1]] });
});

test("interrupts and dispels count per player and per spell, zeros kept", () => {
  const kicks = buildActions(
    [
      { timestamp: 1000, type: "interrupt", sourceID: 3, abilityGameID: 99, extraAbilityGameID: 20, fight: 1 },
      { timestamp: 2000, type: "interrupt", sourceID: 3, extraAbilityGameID: 20, fight: 1 },
      { timestamp: 3000, type: "interrupt", sourceID: 1, extraAbilityGameID: 20 }, // matched by time
      { timestamp: 4000, type: "dispel", sourceID: 2, extraAbilityGameID: 30, fight: 1 }, // wrong type
    ],
    "interrupt", pulls, players, abilities,
  );
  const s = summariseActions(kicks, players);
  assert.equal(s.total, 3);
  assert.deepEqual(s.byPlayer.map((p) => [p.name, p.count]), [["Cal", 2], ["Ann", 1], ["Bob", 0]]);
  assert.deepEqual(s.bySpell, [{ spell: "Shadow Bolt", count: 3, top: [["Cal", 2], ["Ann", 1]] }]);
});

test("consumables: uptime against boss time, potions per pull, issues flagged", () => {
  const buffTables = {
    1: { data: { totalTime: 200_000, auras: [
      { name: "Flask of the Warm Sun", totalUptime: 200_000, totalUses: 1 },
      { name: "Well Fed", totalUptime: 120_000, totalUses: 1 },
      { name: "Potion of the Jade Serpent", totalUptime: 50_000, totalUses: 4 },
    ] } },
    2: { data: { totalTime: 200_000, auras: [{ name: "Mad Hozen Elixir", totalUptime: 190_000, totalUses: 1 }, { name: "Well Fed", totalUptime: 200_000 }] } },
  };
  const c = buildConsumables(buffTables, players, pulls);
  assert.equal(c.length, 2); // Cal has no table
  const ann = c.find((x) => x.name === "Ann");
  assert.equal(ann.flaskUptime, 1);
  assert.equal(ann.foodUptime, 0.6);
  assert.equal(ann.potionsPerPull, 2);
  assert.deepEqual(ann.issues, ["food"]);
  const bob = c.find((x) => x.name === "Bob");
  assert.equal(bob.flaskUptime, 0.95);
  assert.equal(bob.pulls, 2);
  assert.deepEqual(bob.issues, ["potions"]);
});

test("demo report: checks and per-boss filter", () => {
  const m = buildModel(demo);
  assert.ok(m.has.avoidable && m.has.consumables);
  const all = playerChecks(m);
  assert.ok(all.avoidable.hits > 0 && all.interrupts.total > 0 && all.dispels.total > 0);
  const perBoss = m.bosses.map((b) => playerChecks(m, b.bossKey));
  assert.equal(perBoss.reduce((n, c) => n + c.interrupts.total, 0), all.interrupts.total);
  assert.equal(perBoss.reduce((n, c) => n + c.avoidable.total, 0), all.avoidable.total);
  assert.equal(m.consumables.length, 10);
  assert.ok(m.consumables[0].issues.length > 0, "worst player listed first");
});

test("older saved files without the new data still load", () => {
  const { damageTakenEvents, interruptEvents, dispelEvents, buffTables, ...old } = demo;
  const m = buildModel(old);
  assert.equal(m.has.avoidable, false);
  assert.equal(playerChecks(m).interrupts.total, 0);
  assert.deepEqual(m.consumables, []);
});

test("buff tables query aliases each player", () => {
  assert.match(buffTablesQuery([4, 7]), /buffs_7: table\(dataType: Buffs, sourceID: 7, fightIDs: \$fightIDs\)/);
});
