// Transform step: raw API bundle in, analysis model out.
//
// Pure functions only (no DOM, no network) so they run unchanged under
// `node --test`. Every number the page shows is computed here.

import { isAvoidable } from "./avoidable.js";

const DIFFICULTY = { 1: "LFR", 2: "Flex", 3: "Normal", 4: "Heroic", 5: "Mythic" };

export function difficultyLabel(difficulty, size) {
  const name = DIFFICULTY[difficulty] ?? (difficulty ? `Difficulty ${difficulty}` : "");
  return [size ? `${size}-man` : "", name].filter(Boolean).join(" ");
}

// WCL reports boss health remaining as 0-100. Very old data used 0-10000.
export function normalisePercent(value) {
  if (value === null || value === undefined) return null;
  return value > 100 ? value / 100 : value;
}

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

// Accepts the JSON a `table(...)` field returns, with or without the outer `data`.
function tableEntries(table) {
  const entries = table?.data?.entries ?? table?.entries ?? [];
  return entries.filter((e) => e.type !== "Pet" && e.type !== "NPC");
}

function tableTotalTime(table) {
  return table?.data?.totalTime ?? table?.totalTime ?? null;
}

export function buildPulls(fights) {
  const perBoss = new Map();
  return fights
    .filter((f) => f.encounterID > 0)
    .sort((a, b) => a.startTime - b.startTime)
    .map((f) => {
      const bossKey = `${f.encounterID}:${f.difficulty ?? ""}:${f.size ?? ""}`;
      const pullNo = (perBoss.get(bossKey) ?? 0) + 1;
      perBoss.set(bossKey, pullNo);
      const kill = Boolean(f.kill);
      return {
        id: f.id,
        bossKey,
        encounterID: f.encounterID,
        boss: f.name,
        difficulty: difficultyLabel(f.difficulty, f.size),
        pullNo,
        kill,
        startTime: f.startTime,
        endTime: f.endTime,
        durationMs: f.endTime - f.startTime,
        players: f.friendlyPlayers ?? null,
        // Health left on the boss when the pull ended (0 on a kill).
        bossPct: kill ? 0 : normalisePercent(f.bossPercentage ?? f.fightPercentage),
      };
    });
}

export function summariseBosses(pulls) {
  const groups = new Map();
  for (const p of pulls) {
    if (!groups.has(p.bossKey)) groups.set(p.bossKey, []);
    groups.get(p.bossKey).push(p);
  }
  return [...groups.values()].map((list) => {
    const kills = list.filter((p) => p.kill);
    const wipes = list.filter((p) => !p.kill);
    const firstKill = kills[0] ?? null;
    const wipePcts = wipes.map((p) => p.bossPct).filter((v) => v !== null);
    return {
      bossKey: list[0].bossKey,
      boss: list[0].boss,
      difficulty: list[0].difficulty,
      pulls: list.length,
      kills: kills.length,
      wipes: wipes.length,
      killed: kills.length > 0,
      bestWipePct: wipePcts.length ? Math.min(...wipePcts) : null,
      pullsToKill: firstKill ? firstKill.pullNo : null,
      killDurationMs: firstKill ? firstKill.durationMs : null,
      timeSpentMs: sum(list.map((p) => p.durationMs)),
      wipeTimeMs: sum(wipes.map((p) => p.durationMs)),
      firstPullAt: list[0].startTime,
    };
  });
}

export function buildDeaths(deathEvents, pulls, players, abilities) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const abilityName = new Map(abilities.map((a) => [a.gameID, a.name]));

  const deaths = [];
  for (const ev of deathEvents) {
    if (ev.type && ev.type !== "death") continue;
    const player = playerById.get(ev.targetID);
    if (!player) continue; // pets, NPCs
    const pull =
      pulls.find((p) => p.id === ev.fight) ??
      pulls.find((p) => ev.timestamp >= p.startTime && ev.timestamp <= p.endTime);
    if (!pull) continue;
    const abilityId = ev.killingAbilityGameID ?? ev.abilityGameID ?? 0;
    deaths.push({
      pullId: pull.id,
      boss: pull.boss,
      pullNo: pull.pullNo,
      kill: pull.kill,
      player: player.name,
      cls: player.cls,
      atMs: ev.timestamp - pull.startTime,
      ability: abilityName.get(abilityId) || (abilityId ? `Ability ${abilityId}` : "Unknown"),
    });
  }
  deaths.sort((a, b) => a.pullId - b.pullId || a.atMs - b.atMs);

  // Order within each pull: 1 = first to die.
  let lastPull = null;
  let n = 0;
  for (const d of deaths) {
    n = d.pullId === lastPull ? n + 1 : 1;
    lastPull = d.pullId;
    d.order = n;
  }
  return deaths;
}

export function summariseDeaths(deaths, players) {
  const clsByName = new Map(players.map((p) => [p.name, p.cls]));
  const total = countBy(deaths, (d) => d.player);
  const first = countBy(
    deaths.filter((d) => d.order === 1),
    (d) => d.player,
  );
  const byPlayer = [...total.entries()]
    .map(([name, count]) => ({ name, cls: clsByName.get(name), deaths: count, firstDeaths: first.get(name) ?? 0 }))
    .sort((a, b) => b.deaths - a.deaths || b.firstDeaths - a.firstDeaths || a.name.localeCompare(b.name));

  // What killed people early: only the first three deaths of each pull, since
  // anything after that is usually the wipe snowballing.
  const early = deaths.filter((d) => d.order <= 3);
  const byAbility = [...countBy(early, (d) => d.ability).entries()]
    .map(([ability, count]) => ({ ability, count }))
    .sort((a, b) => b.count - a.count || a.ability.localeCompare(b.ability));

  return { byPlayer, byAbility, earlyDeathCount: early.length };
}

function rankTable(table, fallbackMs, players) {
  const ms = tableTotalTime(table) || fallbackMs;
  const clsByName = new Map(players.map((p) => [p.name, p.cls]));
  return tableEntries(table)
    .map((e) => ({
      name: e.name,
      cls: e.type || clsByName.get(e.name) || "",
      total: e.total ?? 0,
      perSecond: ms > 0 ? (e.total ?? 0) / (ms / 1000) : 0,
    }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function buildKills(pulls, killTables, players) {
  return pulls
    .filter((p) => p.kill && killTables?.[p.id])
    .map((p) => {
      const t = killTables[p.id];
      const damage = rankTable(t.damage, p.durationMs, players);
      const healing = rankTable(t.healing, p.durationMs, players);
      return {
        pullId: p.id,
        boss: p.boss,
        difficulty: p.difficulty,
        durationMs: p.durationMs,
        damage,
        healing,
        raidDps: sum(damage.map((d) => d.perSecond)),
        raidHps: sum(healing.map((d) => d.perSecond)),
      };
    });
}

// ---- avoidable damage, interrupts, dispels ----

function pullFor(ev, pulls) {
  return (
    pulls.find((p) => p.id === ev.fight) ??
    pulls.find((p) => ev.timestamp >= p.startTime && ev.timestamp <= p.endTime) ??
    null
  );
}

// One row per avoidable hit on a player. Hits from abilities not on that
// boss's list are dropped, even if the API returned them.
export function buildAvoidableHits(events, pulls, players, abilities) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const abilityName = new Map(abilities.map((a) => [a.gameID, a.name]));
  const rows = [];
  for (const ev of events) {
    if (ev.type && ev.type !== "damage") continue;
    const player = playerById.get(ev.targetID);
    const pull = player && pullFor(ev, pulls);
    if (!pull) continue;
    const ability = abilityName.get(ev.abilityGameID);
    if (!ability || !isAvoidable(pull.boss, ability)) continue;
    rows.push({
      pullId: pull.id,
      bossKey: pull.bossKey,
      player: player.name,
      cls: player.cls,
      ability,
      amount: (ev.amount ?? 0) + (ev.absorbed ?? 0),
    });
  }
  return rows;
}

export function summariseAvoidable(rows, roster) {
  const byPlayer = new Map(roster.map((p) => [p.name, { name: p.name, cls: p.cls, total: 0, hits: 0, abilities: new Map() }]));
  const byAbility = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player)) byPlayer.set(r.player, { name: r.player, cls: r.cls, total: 0, hits: 0, abilities: new Map() });
    const p = byPlayer.get(r.player);
    p.total += r.amount;
    p.hits += 1;
    p.abilities.set(r.ability, (p.abilities.get(r.ability) ?? 0) + r.amount);

    if (!byAbility.has(r.ability)) byAbility.set(r.ability, { ability: r.ability, total: 0, hits: 0, players: new Map() });
    const a = byAbility.get(r.ability);
    a.total += r.amount;
    a.hits += 1;
    a.players.set(r.player, (a.players.get(r.player) ?? 0) + 1);
  }
  const topOf = (map) => [...map.entries()].sort((x, y) => y[1] - x[1]);
  return {
    total: sum(rows.map((r) => r.amount)),
    hits: rows.length,
    byPlayer: [...byPlayer.values()]
      .map((p) => ({ name: p.name, cls: p.cls, total: p.total, hits: p.hits, top: topOf(p.abilities).slice(0, 3) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    byAbility: [...byAbility.values()]
      .map((a) => ({ ability: a.ability, total: a.total, hits: a.hits, worst: topOf(a.players).slice(0, 3) }))
      .sort((a, b) => b.total - a.total),
  };
}

// Interrupts and dispels share a shape: who did it, and to which spell or aura.
export function buildActions(events, type, pulls, players, abilities) {
  const playerById = new Map(players.map((p) => [p.id, p]));
  const abilityName = new Map(abilities.map((a) => [a.gameID, a.name]));
  const rows = [];
  for (const ev of events) {
    if (ev.type && ev.type !== type) continue;
    const player = playerById.get(ev.sourceID);
    const pull = player && pullFor(ev, pulls);
    if (!pull) continue;
    const id = ev.extraAbilityGameID ?? ev.abilityGameID;
    rows.push({
      pullId: pull.id,
      bossKey: pull.bossKey,
      player: player.name,
      cls: player.cls,
      spell: abilityName.get(id) || (id ? `Spell ${id}` : "Unknown"),
    });
  }
  return rows;
}

export function summariseActions(rows, roster) {
  const byPlayer = new Map(roster.map((p) => [p.name, { name: p.name, cls: p.cls, count: 0, spells: new Map() }]));
  const bySpell = new Map();
  for (const r of rows) {
    if (!byPlayer.has(r.player)) byPlayer.set(r.player, { name: r.player, cls: r.cls, count: 0, spells: new Map() });
    const p = byPlayer.get(r.player);
    p.count += 1;
    p.spells.set(r.spell, (p.spells.get(r.spell) ?? 0) + 1);
    if (!bySpell.has(r.spell)) bySpell.set(r.spell, { spell: r.spell, count: 0, players: new Map() });
    const s = bySpell.get(r.spell);
    s.count += 1;
    s.players.set(r.player, (s.players.get(r.player) ?? 0) + 1);
  }
  const topOf = (map) => [...map.entries()].sort((x, y) => y[1] - x[1]);
  return {
    total: rows.length,
    byPlayer: [...byPlayer.values()]
      .map((p) => ({ name: p.name, cls: p.cls, count: p.count, top: topOf(p.spells).slice(0, 3) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    bySpell: [...bySpell.values()]
      .map((s) => ({ spell: s.spell, count: s.count, top: topOf(s.players).slice(0, 3) }))
      .sort((a, b) => b.count - a.count),
  };
}

// Everything in the "player checks" area, optionally limited to one boss.
export function playerChecks(model, bossKey = null) {
  const keep = (rows) => (bossKey ? rows.filter((r) => r.bossKey === bossKey) : rows);
  return {
    avoidable: summariseAvoidable(keep(model.avoidableHits), model.roster),
    interrupts: summariseActions(keep(model.interrupts), model.roster),
    dispels: summariseActions(keep(model.dispels), model.roster),
  };
}

// ---- consumables ----

const ELIXIRS = new Set([
  "mad hozen elixir", "elixir of weaponry", "elixir of the rapids", "elixir of peace",
  "elixir of perfection", "monk's elixir", "elixir of mirrors", "mantid elixir",
]);
const isFlask = (name) => /^flask of /i.test(name) || ELIXIRS.has(name.toLowerCase());
const isFood = (name) => /^well fed$/i.test(name);
const isPotion = (name) => /^potion of /i.test(name) || /^virmen's bite$/i.test(name);

export const FLASK_OK = 0.9; // flask or elixir up for at least 90% of boss time
export const FOOD_OK = 0.9;
export const POTIONS_OK = 1; // at least one potion per pull on average

function auraList(table) {
  return table?.data?.auras ?? table?.auras ?? [];
}

export function buildConsumables(buffTables, roster, pulls) {
  if (!buffTables || !Object.keys(buffTables).length) return [];
  return roster
    .filter((p) => buffTables[p.id])
    .map((p) => {
      const table = buffTables[p.id];
      const auras = auraList(table);
      const pullsIn = pulls.filter((f) => !f.players || f.players.includes(p.id));
      const time = table?.data?.totalTime ?? table?.totalTime ?? sum(pullsIn.map((f) => f.durationMs));
      const uptime = (match) => {
        const best = Math.max(0, ...auras.filter((a) => match(a.name ?? "")).map((a) => a.totalUptime ?? 0));
        return time > 0 ? Math.min(1, best / time) : 0;
      };
      const potions = auras.filter((a) => isPotion(a.name ?? ""));
      const potionUses = sum(potions.map((a) => a.totalUses ?? 0));
      const flaskNames = auras.filter((a) => isFlask(a.name ?? "")).map((a) => a.name);
      return {
        name: p.name,
        cls: p.cls,
        pulls: pullsIn.length,
        flaskUptime: uptime(isFlask),
        flaskNames,
        foodUptime: uptime(isFood),
        potionUses,
        potionNames: potions.map((a) => a.name),
        potionsPerPull: pullsIn.length ? potionUses / pullsIn.length : 0,
      };
    })
    .map((c) => ({
      ...c,
      issues: [
        c.flaskUptime < FLASK_OK && "flask",
        c.foodUptime < FOOD_OK && "food",
        c.potionsPerPull < POTIONS_OK && "potions",
      ].filter(Boolean),
    }))
    .sort((a, b) => b.issues.length - a.issues.length || a.flaskUptime - b.flaskUptime || a.name.localeCompare(b.name));
}

export function buildModel(bundle) {
  const r = bundle.report;
  const players = (r.masterData?.actors ?? [])
    .filter((a) => a.type === "Player")
    .map((a) => ({ id: a.id, name: a.name, cls: a.subType || "Unknown", server: a.server ?? null }));
  const abilities = r.masterData?.abilities ?? [];

  const pulls = buildPulls(r.fights ?? []);
  const bosses = summariseBosses(pulls);
  const deaths = buildDeaths(bundle.deathEvents ?? [], pulls, players, abilities);
  const deathStats = summariseDeaths(deaths, players);
  const kills = buildKills(pulls, bundle.killTables, players);

  // Only count players who were actually present for a boss pull.
  const inPulls = new Set(pulls.flatMap((p) => p.players ?? []));
  const seen = new Set([...deaths.map((d) => d.player), ...kills.flatMap((k) => [...k.damage, ...k.healing].map((e) => e.name))]);
  const roster = players.filter((p) =>
    inPulls.size ? inPulls.has(p.id) : seen.size === 0 || seen.has(p.name),
  );
  const avoidableHits = buildAvoidableHits(bundle.damageTakenEvents ?? [], pulls, players, abilities);
  const interrupts = buildActions(bundle.interruptEvents ?? [], "interrupt", pulls, players, abilities);
  const dispels = buildActions(bundle.dispelEvents ?? [], "dispel", pulls, players, abilities);
  const consumables = buildConsumables(bundle.buffTables, roster, pulls);
  const composition = [...countBy(roster, (p) => p.cls).entries()]
    .map(([cls, count]) => ({ cls, count }))
    .sort((a, b) => b.count - a.count || a.cls.localeCompare(b.cls));

  const wipes = pulls.filter((p) => !p.kill);
  return {
    meta: {
      site: bundle.site ?? "classic",
      code: r.code,
      title: r.title,
      zone: r.zone?.name ?? null,
      owner: r.owner?.name ?? null,
      guild: r.guild?.name ?? null,
      server: r.guild?.server?.name ?? r.guild?.server?.slug ?? null,
      startTime: r.startTime,
      endTime: r.endTime,
      durationMs: r.endTime - r.startTime,
    },
    totals: {
      pulls: pulls.length,
      kills: pulls.length - wipes.length,
      wipes: wipes.length,
      bossesSeen: bosses.length,
      bossesKilled: bosses.filter((b) => b.killed).length,
      timeInPullsMs: sum(pulls.map((p) => p.durationMs)),
      timeOnWipesMs: sum(wipes.map((p) => p.durationMs)),
      deaths: deaths.length,
      players: roster.length,
    },
    pulls,
    bosses,
    deaths,
    deathStats,
    kills,
    composition,
    roster,
    avoidableHits,
    interrupts,
    dispels,
    consumables,
    has: {
      // Older saved files (format 1) don't have these, so the page can say so.
      avoidable: "damageTakenEvents" in bundle,
      interrupts: "interruptEvents" in bundle,
      dispels: "dispelEvents" in bundle,
      consumables: "buffTables" in bundle,
    },
  };
}

// ---- formatting helpers shared by the page and the CSV export ----

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return "–";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatNumber(n) {
  if (n === null || n === undefined) return "–";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Math.round(n).toLocaleString("en-US");
}

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(","));
  return [head, ...body].join("\n") + "\n";
}

export const PULL_COLUMNS = [
  { label: "fight_id", value: (p) => p.id },
  { label: "boss", value: (p) => p.boss },
  { label: "difficulty", value: (p) => p.difficulty },
  { label: "pull_no", value: (p) => p.pullNo },
  { label: "result", value: (p) => (p.kill ? "kill" : "wipe") },
  { label: "duration_s", value: (p) => Math.round(p.durationMs / 1000) },
  { label: "boss_hp_pct", value: (p) => p.bossPct },
];

export const DEATH_COLUMNS = [
  { label: "fight_id", value: (d) => d.pullId },
  { label: "boss", value: (d) => d.boss },
  { label: "pull_no", value: (d) => d.pullNo },
  { label: "death_order", value: (d) => d.order },
  { label: "player", value: (d) => d.player },
  { label: "class", value: (d) => d.cls },
  { label: "time_into_pull_s", value: (d) => (d.atMs / 1000).toFixed(1) },
  { label: "killing_ability", value: (d) => d.ability },
];
