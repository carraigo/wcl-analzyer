// Generates demo/demo-report.json: a made-up raid night in the same shape the
// API returns, so the page can be tried without signing in.
//
//   node tools/make-demo.mjs
//
// Seeded, so the output is identical every run. Names and numbers are invented.

import { writeFileSync } from "node:fs";

let seed = 20261007;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const between = (lo, hi) => lo + rand() * (hi - lo);
const pick = (list) => list[Math.floor(rand() * list.length)];

const players = [
  ["Brewmastah", "Monk", "tank"],
  ["Stonewall", "Warrior", "tank"],
  ["Healsalot", "Priest", "healer"],
  ["Mistyleaf", "Monk", "healer"],
  ["Totemtina", "Shaman", "healer"],
  ["Pewpew", "Hunter", "dps"],
  ["Frostbyte", "Mage", "dps"],
  ["Stabbington", "Rogue", "dps"],
  ["Doomsday", "Warlock", "dps"],
  ["Moonfire", "Druid", "dps"],
].map(([name, subType, role], i) => ({ id: i + 1, name, server: "Demo Realm", type: "Player", subType, role }));

const bosses = [
  { encounterID: 1395, name: "The Stone Guard", wipes: [62, 31], killLen: 290, abilities: ["Jasper Chains", "Cobalt Mine", "Amethyst Pool", "Overload"] },
  { encounterID: 1390, name: "Feng the Accursed", wipes: [71, 44, 38, 12], killLen: 340, abilities: ["Lightning Fists", "Epicenter", "Wildfire Spark", "Arcane Velocity"] },
  { encounterID: 1434, name: "Gara'jal the Spiritbinder", wipes: [80, 55, 47, 33, 21, 9], killLen: 310, abilities: ["Banishment", "Spiritual Grasp", "Shadowy Attack", "Frail Soul"] },
  { encounterID: 1436, name: "The Spirit Kings", wipes: [88, 74, 66, 52, 49], killLen: null, nominalLen: 420, abilities: ["Pillage", "Flanking Orders", "Massive Attacks", "Maddening Shout"] },
];

const abilityIds = new Map();
let nextAbility = 117000;
for (const b of bosses) for (const a of b.abilities) abilityIds.set(a, nextAbility++);
abilityIds.set("Melee", 1);

const fights = [];
const deathEvents = [];
const killTables = {};
let t = 6 * 60_000; // first pull six minutes in
let fightId = 1;

function addDeaths(fight, boss, kill) {
  const dur = fight.endTime - fight.startTime;
  // Wipes: a handful of early deaths then the rest at the end. Kills: 0-2 deaths.
  const count = kill ? Math.floor(between(0, 2.6)) : Math.floor(between(4, 11));
  const victims = [...players].sort(() => rand() - 0.5).slice(0, count);
  victims.forEach((p, i) => {
    const early = i < 3;
    const at = early ? between(0.25, 0.85) * dur : between(0.88, 0.99) * dur;
    const weakDps = p.name === "Stabbington" || p.name === "Moonfire";
    const ability = p.role === "tank" && rand() < 0.5 ? "Melee" : pick(boss.abilities.slice(0, weakDps && early ? 2 : 4));
    deathEvents.push({
      timestamp: Math.round(fight.startTime + at),
      type: "death",
      sourceID: -1,
      targetID: p.id,
      abilityGameID: 0,
      fight: fight.id,
      killerID: 99,
      killingAbilityGameID: abilityIds.get(ability),
    });
  });
}

function table(fight, kind) {
  const secs = (fight.endTime - fight.startTime) / 1000;
  const entries = players
    .filter((p) => (kind === "damage" ? true : p.role === "healer" || rand() < 0.4))
    .map((p) => {
      let perSec;
      if (kind === "damage") perSec = p.role === "dps" ? between(48_000, 72_000) : p.role === "tank" ? between(16_000, 26_000) : between(2_000, 6_000);
      else perSec = p.role === "healer" ? between(38_000, 58_000) : between(1_000, 6_000);
      return { name: p.name, id: p.id, type: p.subType, total: Math.round(perSec * secs) };
    })
    .sort((a, b) => b.total - a.total);
  return { data: { totalTime: fight.endTime - fight.startTime, entries } };
}

// A few trash fights between bosses, to prove they're ignored.
function trash(name, len) {
  fights.push({ id: fightId++, encounterID: 0, name, difficulty: null, kill: null, startTime: t, endTime: t + len * 1000, bossPercentage: null, fightPercentage: null, size: null });
  t += len * 1000 + 90_000;
}

for (const boss of bosses) {
  trash(`${boss.name.split(" ").pop()} trash`, Math.round(between(40, 90)));
  const pulls = [...boss.wipes.map((pct) => ({ pct })), ...(boss.killLen ? [{ pct: 0, kill: true }] : [])];
  for (const pull of pulls) {
    const len = pull.kill ? boss.killLen : Math.round((boss.killLen ?? boss.nominalLen) * (1 - pull.pct / 100) * between(0.95, 1.1) + 25);
    const fight = {
      id: fightId++,
      encounterID: boss.encounterID,
      name: boss.name,
      difficulty: 3,
      kill: Boolean(pull.kill),
      startTime: t,
      endTime: t + len * 1000,
      bossPercentage: pull.pct,
      fightPercentage: pull.pct,
      size: 10,
    };
    fights.push(fight);
    addDeaths(fight, boss, fight.kill);
    if (fight.kill) killTables[fight.id] = { damage: table(fight, "damage"), healing: table(fight, "healing") };
    t = fight.endTime + Math.round(between(70, 160)) * 1000;
  }
}

const start = Date.UTC(2026, 9, 6, 23, 0, 0);
const bundle = {
  format: "wcl-report-bundle/1",
  site: "classic",
  fetchedAt: "2026-10-07T12:00:00.000Z",
  demo: true,
  report: {
    code: "DemoReport000000",
    title: "Demo: Mogu'shan Vaults (made-up data)",
    startTime: start,
    endTime: start + t,
    owner: { name: "Raidleader" },
    guild: { name: "Demo Guild", server: { name: "Demo Realm", slug: "demo-realm", region: { slug: "us" } } },
    zone: { id: 1008, name: "Mogu'shan Vaults" },
    fights,
    masterData: {
      actors: players.map(({ role, ...a }) => a),
      abilities: [...abilityIds].map(([name, gameID]) => ({ gameID, name })),
    },
  },
  deathEvents: deathEvents.sort((a, b) => a.timestamp - b.timestamp),
  killTables,
};

writeFileSync(new URL("../demo/demo-report.json", import.meta.url), JSON.stringify(bundle, null, 1) + "\n");
console.log(`wrote demo/demo-report.json: ${fights.length} fights, ${deathEvents.length} deaths`);
