// Extract step: pulls one report out of the Warcraft Logs v2 GraphQL API and
// returns it as a single raw "bundle" object. Nothing here interprets the data;
// that's transform.js's job. The same bundle shape is what "Save raw JSON"
// downloads and what demo/demo-report.json contains.
//
// Schema reference: https://www.warcraftlogs.com/v2-api-docs/warcraft/
// Report times are epoch ms; fight and event times are ms since report start.

import { siteOrigin } from "./report-url.js";
import { avoidableAbilityIds } from "./avoidable.js";

export const REPORT_QUERY = `
query Report($code: String!) {
  reportData {
    report(code: $code) {
      code title startTime endTime
      owner { name }
      guild { name server { name slug region { slug } } }
      zone { id name }
      fights {
        id encounterID name difficulty kill startTime endTime
        bossPercentage fightPercentage size friendlyPlayers
      }
      masterData {
        actors(type: "Player") { id name server type subType }
        abilities { gameID name }
      }
    }
  }
}`;

// Friendly-side events of one type across the given fights, one page at a time.
export const EVENTS_QUERY = `
query Events($code: String!, $fightIDs: [Int], $startTime: Float, $endTime: Float,
             $dataType: EventDataType, $filterExpression: String) {
  reportData {
    report(code: $code) {
      events(fightIDs: $fightIDs, startTime: $startTime, endTime: $endTime,
             dataType: $dataType, hostilityType: Friendlies,
             filterExpression: $filterExpression, limit: 10000) {
        data
        nextPageTimestamp
      }
    }
  }
}`;

// One aliased table pair per kill, so a single request covers several kills.
export function killTablesQuery(fightIds) {
  const parts = fightIds.map(
    (id) => `
      dmg_${id}: table(dataType: DamageDone, fightIDs: [${id}])
      heal_${id}: table(dataType: Healing, fightIDs: [${id}])`,
  );
  return `query KillTables($code: String!) {
  reportData { report(code: $code) {${parts.join("")}
  } }
}`;
}

// One aliased Buffs table per player: the auras that player had during the pulls.
export function buffTablesQuery(playerIds) {
  const parts = playerIds.map(
    (id) => `
      buffs_${id}: table(dataType: Buffs, sourceID: ${id}, fightIDs: $fightIDs)`,
  );
  return `query BuffTables($code: String!, $fightIDs: [Int]) {
  reportData { report(code: $code) {${parts.join("")}
  } }
}`;
}

export class AuthError extends Error {}

export async function graphql({ site, token, query, variables }) {
  const path = token.kind === "client" ? "/api/v2/client" : "/api/v2/user";
  let res;
  try {
    res = await fetch(`${siteOrigin(site)}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error(`Network error talking to Warcraft Logs: ${err.message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError("Your Warcraft Logs sign-in has expired or was rejected. Sign in again.");
  }
  if (res.status === 429) throw new Error("Warcraft Logs rate limit reached. Try again in a few minutes.");
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new Error(`Warcraft Logs API error (HTTP ${res.status}).`);
  if (json.errors?.length) throw new Error(`Warcraft Logs API: ${json.errors.map((e) => e.message).join("; ")}`);
  return json.data;
}

const KILLS_PER_REQUEST = 6;
const PLAYERS_PER_REQUEST = 10;
const MAX_PAGES = 30;

async function fetchEvents({ site, token, code, fightIDs, endTime, dataType, filterExpression, label, onProgress }) {
  const out = [];
  let start = 0;
  for (let page = 1; start !== null && page <= MAX_PAGES; page++) {
    onProgress(`Fetching ${label}${page > 1 ? ` (page ${page})` : ""}…`);
    const data = await graphql({
      site,
      token,
      query: EVENTS_QUERY,
      variables: { code, fightIDs, startTime: start, endTime, dataType, filterExpression },
    });
    const events = data.reportData.report.events;
    out.push(...(events.data ?? []));
    start = events.nextPageTimestamp ?? null;
  }
  return out;
}

export async function fetchReportBundle({ site, code, token, onProgress = () => {} }) {
  onProgress("Fetching report and fights…");
  const head = await graphql({ site, token, query: REPORT_QUERY, variables: { code } });
  const report = head?.reportData?.report;
  if (!report) throw new Error("Report not found. Check the code, and that the report isn't private.");

  const pulls = (report.fights ?? []).filter((f) => f.encounterID > 0);
  const pullIds = pulls.map((f) => f.id);
  const bundle = {
    format: "wcl-report-bundle/2",
    site,
    fetchedAt: new Date().toISOString(),
    report,
    deathEvents: [],
    damageTakenEvents: [],
    interruptEvents: [],
    dispelEvents: [],
    killTables: {},
    buffTables: {},
  };
  if (!pullIds.length) return bundle;

  const common = { site, token, code, fightIDs: pullIds, endTime: report.endTime - report.startTime, onProgress };
  bundle.deathEvents = await fetchEvents({ ...common, dataType: "Deaths", label: "deaths" });
  bundle.interruptEvents = await fetchEvents({ ...common, dataType: "Interrupts", label: "interrupts" });
  bundle.dispelEvents = await fetchEvents({ ...common, dataType: "Dispels", label: "dispels" });

  // Avoidable damage: only the abilities on our list for the bosses in this report.
  const avoidIds = avoidableAbilityIds(
    new Set(pulls.map((f) => f.name)),
    report.masterData?.abilities ?? [],
  );
  if (avoidIds.length) {
    bundle.damageTakenEvents = await fetchEvents({
      ...common,
      dataType: "DamageTaken",
      filterExpression: `ability.id in (${avoidIds.join(",")})`,
      label: "avoidable damage",
    });
  }

  // Damage and healing tables for kills only (wipes would cost a lot of API points).
  const killIds = pulls.filter((f) => f.kill).map((f) => f.id);
  for (let i = 0; i < killIds.length; i += KILLS_PER_REQUEST) {
    const chunk = killIds.slice(i, i + KILLS_PER_REQUEST);
    onProgress(`Fetching damage and healing for kills (${i + chunk.length}/${killIds.length})…`);
    const data = await graphql({ site, token, query: killTablesQuery(chunk), variables: { code } });
    const r = data.reportData.report;
    for (const id of chunk) bundle.killTables[id] = { damage: r[`dmg_${id}`], healing: r[`heal_${id}`] };
  }

  // Buffs per player across all boss pulls, for flask, food and potion checks.
  const inPulls = new Set(pulls.flatMap((f) => f.friendlyPlayers ?? []));
  const playerIds = (report.masterData?.actors ?? [])
    .filter((a) => a.type === "Player" && (inPulls.size === 0 || inPulls.has(a.id)))
    .map((a) => a.id);
  for (let i = 0; i < playerIds.length; i += PLAYERS_PER_REQUEST) {
    const chunk = playerIds.slice(i, i + PLAYERS_PER_REQUEST);
    onProgress(`Fetching buffs (${i + chunk.length}/${playerIds.length} players)…`);
    const data = await graphql({ site, token, query: buffTablesQuery(chunk), variables: { code, fightIDs: pullIds } });
    const r = data.reportData.report;
    for (const id of chunk) bundle.buffTables[id] = r[`buffs_${id}`];
  }

  return bundle;
}
