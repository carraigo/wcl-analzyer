// Generates demo/demo-report.json: a made-up raid night in the same shape the
// API returns, so the page can be tried without signing in.
//
//   node tools/make-demo.mjs
//
// Seeded, so the output is identical every run. Names and numbers are invented.

import { writeFileSync } from "node:fs";
import { isAvoidable } from "../js/avoidable.js";

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
  { encounterID: 1395, name: "The Stone Guard", wipes: [62, 31], killLen: 290, abilities: ["Jasper Chains", "Cobalt Mine Blast", "Amethyst Pool", "Overload"], kicks: [], cleanses: ["Jasper Chains"] },
  { encounterID: 1390, name: "Feng the Accursed", wipes: [71, 44, 38, 12], killLen: 340, abilities: ["Lightning Fists", "Epicenter", "Wildfire Spark", "Arcane Velocity"], kicks: ["Arcane Shock"], cleanses: ["Wildfire Spark"] },
  { encounterID: 1434, name: "Gara'jal the Spiritbinder", wipes: [80, 55, 47, 33, 21, 9], killLen: 310, abilities: ["Banishment", "Spiritual Grasp", "Shadowy Attack", "Frail Soul"], kicks: ["Shadow Bolt"], cleanses: ["Frail Soul"] },
  { encounterID: 1436, name: "The Spirit Kings", wipes: [88, 74, 66, 52, 49], killLen: null, nominalLen: 420, abilities: ["Pillage", "Annihilate", "Volley", "Maddening Shout"], kicks: ["Maddening Shout"], cleanses: ["Pinned Down"] },
];

const abilityIds = new Map();
let nextAbility = 117000;
for (const b of bosses) for (const a of b.abilities) abilityIds.set(a, nextAbility++);
abilityIds.set("Melee", 1);
for (const b of bosses) for (const a of [...b.kicks, ...b.cleanses]) if (!abilityIds.has(a)) abilityIds.set(a, nextAbility++);
const KICK = { Monk: "Spear Hand Strike", Warrior: "Pummel", Hunter: "Counter Shot", Mage: "Counterspell", Rogue: "Kick", Warlock: "Spell Lock", Druid: "Skull Bash", Shaman: "Wind Shear" };
const CLEANSE = { Priest: "Purify", Monk: "Detox", Shaman: "Purify Spirit", Druid: "Remove Corruption", Mage: "Remove Curse" };
for (const a of [...Object.values(KICK), ...Object.values(CLEANSE)]) if (!abilityIds.has(a)) abilityIds.set(a, nextAbility++);

// How careless each player is with mechanics, and how keen on kicks and cleanses.
const clumsy = { Stabbington: 2.6, Moonfire: 2.1, Pewpew: 1.3, Brewmastah: 1, Stonewall: 0.9 };
const kicker = { Brewmastah: 3, Stonewall: 2.5, Stabbington: 2, Frostbyte: 1.5, Totemtina: 1, Doomsday: 0.6, Pewpew: 0.3 };
const cleanser = { Healsalot: 3, Mistyleaf: 2.5, Totemtina: 1.2, Moonfire: 0.4 };
const weighted = (weights) => {
  const entries = Object.entries(weights);
  let r = rand() * entries.reduce((n, [, w]) => n + w, 0);
  for (const [name, w] of entries) if ((r -= w) <= 0) return players.find((p) => p.name === name);
  return players.find((p) => p.name === entries[0][0]);
};
const damageTakenEvents = [];
const interruptEvents = [];
const dispelEvents = [];

function addPlayerEvents(fight, boss) {
  const dur = fight.endTime - fight.startTime;
  const at = () => Math.round(fight.startTime + between(0.05, 0.95) * dur);
  const avoidable = boss.abilities.filter((a) => isAvoidable(boss.name, a));
  for (const ability of avoidable) {
    for (const p of players) {
      const hits = Math.floor(rand() * (clumsy[p.name] ?? 0.5) * (dur / 90_000));
      for (let i = 0; i < hits; i++) {
        damageTakenEvents.push({ timestamp: at(), type: "damage", sourceID: 99, targetID: p.id, abilityGameID: abilityIds.get(ability), fight: fight.id, hitType: 1, amount: Math.round(between(40_000, 160_000)), absorbed: Math.round(between(0, 20_000)) });
      }
    }
  }
  for (const spell of boss.kicks) {
    for (let i = 0, n = Math.floor(dur / 25_000); i < n; i++) {
      const p = weighted(kicker);
      interruptEvents.push({ timestamp: at(), type: "interrupt", sourceID: p.id, targetID: 99, abilityGameID: abilityIds.get(KICK[p.subType]), extraAbilityGameID: abilityIds.get(spell), fight: fight.id });
    }
  }
  for (const aura of boss.cleanses) {
    for (let i = 0, n = Math.floor(dur / 30_000); i < n; i++) {
      const p = weighted(cleanser);
      dispelEvents.push({ timestamp: at(), type: "dispel", sourceID: p.id, targetID: pick(players).id, abilityGameID: abilityIds.get(CLEANSE[p.subType]), extraAbilityGameID: abilityIds.get(aura), fight: fight.id, isBuff: false });
    }
  }
}

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
      friendlyPlayers: players.map((p) => p.id),
    };
    fights.push(fight);
    addDeaths(fight, boss, fight.kill);
    addPlayerEvents(fight, boss);
    if (fight.kill) killTables[fight.id] = { damage: table(fight, "damage"), healing: table(fight, "healing") };
    t = fight.endTime + Math.round(between(70, 160)) * 1000;
  }
}

// Buffs over all boss pulls: flasks, food and potions, with a few gaps.
const bossTime = fights.filter((f) => f.encounterID).reduce((n, f) => n + (f.endTime - f.startTime), 0);
const pullCount = fights.filter((f) => f.encounterID).length;
const FLASK = { tank: "Flask of the Earth", healer: "Flask of the Warm Sun", dps: "Flask of Spring Blossoms" };
const POTION = { tank: "Potion of the Mountains", healer: "Potion of Focus", dps: "Potion of the Jade Serpent" };
const flaskShare = { Moonfire: 0.55, Stabbington: 0 };
const foodShare = { Pewpew: 0.7, Doomsday: 0.35 };
const potionRate = { Stonewall: 0, Healsalot: 0.2, Pewpew: 1.9, Frostbyte: 1.8, Doomsday: 1.6 };
const buffTables = {};
for (const p of players) {
  const auras = [];
  let aura = 0;
  const add = (name, share, uses) => share > 0 && auras.push({ name, guid: 105000 + aura++, type: 1, totalUptime: Math.round(bossTime * share), totalUses: uses });
  add(p.subType === "Warrior" ? "Flask of Winter's Bite" : FLASK[p.role], flaskShare[p.name] ?? between(0.97, 1), 1);
  add("Well Fed", foodShare[p.name] ?? between(0.95, 1), 1);
  const uses = Math.round(pullCount * (potionRate[p.name] ?? between(1.0, 1.7)));
  if (uses) auras.push({ name: POTION[p.role], guid: 105900 + p.id, type: 1, totalUptime: uses * 25_000, totalUses: uses });
  buffTables[p.id] = { data: { totalTime: bossTime, auras } };
}

const start = Date.UTC(2026, 9, 6, 23, 0, 0);
const bundle = {
  format: "wcl-report-bundle/2",
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
  damageTakenEvents: damageTakenEvents.sort((a, b) => a.timestamp - b.timestamp),
  interruptEvents: interruptEvents.sort((a, b) => a.timestamp - b.timestamp),
  dispelEvents: dispelEvents.sort((a, b) => a.timestamp - b.timestamp),
  killTables,
  buffTables,
};

writeFileSync(new URL("../demo/demo-report.json", import.meta.url), JSON.stringify(bundle, null, 1) + "\n");
console.log(`wrote demo/demo-report.json: ${fights.length} fights, ${deathEvents.length} deaths, ${damageTakenEvents.length} avoidable hits, ${interruptEvents.length} interrupts, ${dispelEvents.length} dispels`);
