// Extract step: pulls one report out of the Warcraft Logs v2 GraphQL API and
// returns it as a single raw "bundle" object. Nothing here interprets the data;
// that's transform.js's job. The same bundle shape is what "Save raw JSON"
// downloads and what demo/demo-report.json contains.
//
// Schema reference: https://www.warcraftlogs.com/v2-api-docs/warcraft/
// Report times are epoch ms; fight and event times are ms since report start.

import { siteOrigin } from "./report-url.js";

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
        bossPercentage fightPercentage size
      }
      masterData {
        actors(type: "Player") { id name server type subType }
        abilities { gameID name }
      }
    }
  }
}`;

export const DEATHS_QUERY = `
query Deaths($code: String!, $fightIDs: [Int], $startTime: Float, $endTime: Float) {
  reportData {
    report(code: $code) {
      events(fightIDs: $fightIDs, startTime: $startTime, endTime: $endTime,
             dataType: Deaths, hostilityType: Friendlies, limit: 10000) {
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

export async function fetchReportBundle({ site, code, token, onProgress = () => {} }) {
  onProgress("Fetching report and fights…");
  const head = await graphql({ site, token, query: REPORT_QUERY, variables: { code } });
  const report = head?.reportData?.report;
  if (!report) throw new Error("Report not found. Check the code, and that the report isn't private.");

  const pulls = (report.fights ?? []).filter((f) => f.encounterID > 0);
  const pullIds = pulls.map((f) => f.id);

  // Deaths across every boss pull, following the API's paging.
  const deathEvents = [];
  if (pullIds.length) {
    let start = 0;
    const end = report.endTime - report.startTime;
    for (let page = 1; start !== null && page <= 20; page++) {
      onProgress(`Fetching deaths (page ${page})…`);
      const data = await graphql({
        site,
        token,
        query: DEATHS_QUERY,
        variables: { code, fightIDs: pullIds, startTime: start, endTime: end },
      });
      const events = data.reportData.report.events;
      deathEvents.push(...(events.data ?? []));
      start = events.nextPageTimestamp ?? null;
    }
  }

  // Damage and healing tables for kills only (wipes would cost a lot of API points).
  const killTables = {};
  const killIds = pulls.filter((f) => f.kill).map((f) => f.id);
  for (let i = 0; i < killIds.length; i += KILLS_PER_REQUEST) {
    const chunk = killIds.slice(i, i + KILLS_PER_REQUEST);
    onProgress(`Fetching damage and healing for kills (${i + chunk.length}/${killIds.length})…`);
    const data = await graphql({ site, token, query: killTablesQuery(chunk), variables: { code } });
    const r = data.reportData.report;
    for (const id of chunk) killTables[id] = { damage: r[`dmg_${id}`], healing: r[`heal_${id}`] };
  }

  return {
    format: "wcl-report-bundle/1",
    site,
    fetchedAt: new Date().toISOString(),
    report,
    deathEvents,
    killTables,
  };
}
