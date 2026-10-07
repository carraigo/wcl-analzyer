// Turns whatever the user pasted into { site, code }.
//
// Accepts a full report URL (any Warcraft Logs flavour, with or without a
// #fight=... fragment) or a bare report code.

export const SITES = {
  www: "https://www.warcraftlogs.com",
  classic: "https://classic.warcraftlogs.com",
  fresh: "https://fresh.warcraftlogs.com",
  sod: "https://sod.warcraftlogs.com",
  vanilla: "https://vanilla.warcraftlogs.com",
};

const CODE_RE = /^[A-Za-z0-9]{16}$/;

export function parseReportInput(input, defaultSite = "classic") {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("Paste a Warcraft Logs report URL or code.");

  if (CODE_RE.test(text)) return { site: defaultSite, code: text };

  let url;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch {
    throw new Error("That doesn't look like a report URL or code.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "warcraftlogs.com" && !host.endsWith(".warcraftlogs.com")) {
    throw new Error("Only warcraftlogs.com report links are supported.");
  }
  const sub = host === "warcraftlogs.com" ? "www" : host.slice(0, -".warcraftlogs.com".length);
  if (!SITES[sub]) throw new Error(`Unknown Warcraft Logs site "${host}".`);

  const match = url.pathname.match(/\/reports\/([A-Za-z0-9]+)/);
  if (!match || !CODE_RE.test(match[1])) {
    throw new Error("Couldn't find a report code in that URL (expected /reports/<code>).");
  }
  return { site: sub, code: match[1] };
}

export function siteOrigin(site) {
  const origin = SITES[site];
  if (!origin) throw new Error(`Unknown site "${site}".`);
  return origin;
}

export function reportLink(site, code, fightId) {
  const base = `${siteOrigin(site)}/reports/${code}`;
  return fightId ? `${base}#fight=${fightId}` : base;
}
