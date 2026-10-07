// Presentation: turns the analysis model into HTML. No data logic lives here.

import { formatDuration, formatNumber, playerChecks, FLASK_OK, FOOD_OK, POTIONS_OK } from "./transform.js";
import { AVOIDABLE } from "./avoidable.js";
import { reportLink } from "./report-url.js";

const CLASS_COLORS = {
  DeathKnight: "#C41E3A", "Death Knight": "#C41E3A", Druid: "#FF7C0A", Hunter: "#AAD372",
  Mage: "#3FC7EB", Monk: "#00FF98", Paladin: "#F48CBA", Priest: "#FFFFFF", Rogue: "#FFF468",
  Shaman: "#0070DD", Warlock: "#8788EE", Warrior: "#C69B6D", DemonHunter: "#A330C9", Evoker: "#33937F",
};

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function cls(name, className) {
  const color = CLASS_COLORS[className];
  const style = color ? ` style="--cls:${color}"` : "";
  return `<span class="cls"${style} title="${esc(className)}">${esc(name)}</span>`;
}

const pct = (v) => (v === null || v === undefined ? "–" : `${Number(v).toFixed(1)}%`);

function tile(k, v, s = "") {
  return `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
}

function barList(rows, { value, label, tip, second }) {
  if (!rows.length) return `<p class="muted">Nothing to show.</p>`;
  const max = Math.max(...rows.map(value), 1);
  return `<div class="bars">${rows
    .map((r) => {
      const w = (value(r) / max) * 100;
      return `<div class="bar-row" data-tip="${esc(tip(r))}">
        <span class="name">${label(r)}</span>
        <span class="bar-track">${w > 0 ? `<span class="bar-fill${second ? " second" : ""}" style="width:${w.toFixed(2)}%"></span>` : ""}</span>
        <span class="val">${esc(r._val ?? "")}</span>
      </div>`;
    })
    .join("")}</div>`;
}

function header(model, isDemo) {
  const m = model.meta;
  const date = m.startTime ? new Date(m.startTime).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" }) : "";
  const bits = [m.zone, [m.guild, m.server].filter(Boolean).join(" – "), date, formatDuration(m.durationMs)].filter(Boolean);
  const link = isDemo ? "" : ` · <a href="${esc(reportLink(m.site, m.code))}" target="_blank" rel="noopener">Open on Warcraft Logs</a>`;
  return `<div class="report-head">
    <div>
      <h2>${esc(m.title || m.code)}${isDemo ? `<span class="demo-badge">Demo data</span>` : ""}</h2>
      <div class="sub">${bits.map(esc).join(" · ")}${link}</div>
    </div>
    <div class="actions">
      <button type="button" class="btn" data-download="pulls">Pulls CSV</button>
      <button type="button" class="btn" data-download="deaths">Deaths CSV</button>
      <button type="button" class="btn" data-download="raw">Raw JSON</button>
    </div>
  </div>`;
}

function tiles(model) {
  const t = model.totals;
  const wipeShare = t.timeInPullsMs ? Math.round((t.timeOnWipesMs / t.timeInPullsMs) * 100) : 0;
  const perPull = t.pulls ? (t.deaths / t.pulls).toFixed(1) : "0";
  return `<div class="tiles">
    ${tile("Bosses killed", `${t.bossesKilled} / ${t.bossesSeen}`)}
    ${tile("Pulls", t.pulls, `${t.kills} kills, ${t.wipes} wipes`)}
    ${tile("Time on wipes", formatDuration(t.timeOnWipesMs), `${wipeShare}% of boss time`)}
    ${tile("Deaths", t.deaths, `${perPull} per pull`)}
    ${tile("Raiders", t.players)}
  </div>`;
}

function bossTable(model) {
  const rows = model.bosses
    .map(
      (b) => `<tr>
      <td>${esc(b.boss)}</td>
      <td>${esc(b.difficulty)}</td>
      <td class="num">${b.pulls}</td>
      <td>${b.killed ? `<span class="result-kill">Killed</span>` : `<span class="result-wipe">Not killed</span>`}</td>
      <td class="num">${b.pullsToKill ?? "–"}</td>
      <td class="num">${b.killed ? formatDuration(b.killDurationMs) : "–"}</td>
      <td class="num">${pct(b.bestWipePct)}</td>
      <td class="num">${formatDuration(b.timeSpentMs)}</td>
    </tr>`,
    )
    .join("");
  return `<div class="card">
    <div class="card-head"><div><h2>Bosses</h2><p>Best wipe is the lowest health the boss was left on before a wipe.</p></div></div>
    <div class="table-scroll"><table>
      <thead><tr><th>Boss</th><th>Difficulty</th><th class="num">Pulls</th><th>Result</th><th class="num">Pulls to kill</th><th class="num">Kill time</th><th class="num">Best wipe</th><th class="num">Time spent</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

// One small chart per boss: a bar per pull, height = boss health left (lower is better).
function progressionChart(boss, pulls) {
  const W = 300, H = 140, L = 30, R = 6, T = 8, B = 20;
  const plotW = W - L - R, plotH = H - T - B;
  const n = pulls.length;
  const slot = plotW / n;
  const barW = Math.max(3, Math.min(28, slot - 2));
  const y = (v) => T + plotH - (v / 100) * plotH;

  const grid = [0, 50, 100]
    .map((v) => `<line class="${v === 0 ? "base" : "grid-line"}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${L - 5}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`)
    .join("");

  const labelEvery = n > 12 ? Math.ceil(n / 8) : 1;
  const bars = pulls
    .map((p, i) => {
      const cx = L + slot * i + slot / 2;
      const x = cx - barW / 2;
      const tip = `Pull ${p.pullNo}: ${p.kill ? "Kill" : `Wipe at ${pct(p.bossPct)}`}\n${formatDuration(p.durationMs)} long`;
      const tick = i % labelEvery === 0 || i === n - 1 ? `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${p.pullNo}</text>` : "";
      let mark;
      if (p.kill) {
        mark = `<rect class="kill-mark" x="${x}" y="${y(0) - 4}" width="${barW}" height="4" rx="1"/>
          <text class="kill-label" x="${cx}" y="${y(0) - 8}" text-anchor="middle">✓ Kill</text>`;
      } else {
        const v = p.bossPct ?? 0;
        const h = Math.max(1.5, (v / 100) * plotH);
        mark = `<path class="bar" d="M${x},${y(0)} v${-(h - 3)} q0,-3 3,-3 h${barW - 6} q3,0 3,3 v${h - 3} z"/>`;
      }
      return `<g data-tip="${esc(tip)}"><rect class="hit" x="${L + slot * i}" y="${T}" width="${slot}" height="${plotH}"/>${mark}${tick}</g>`;
    })
    .join("");

  const summary = boss.killed
    ? `Killed on pull ${boss.pullsToKill}${boss.wipes ? `, best wipe ${pct(boss.bestWipePct)}` : ""}`
    : `${boss.pulls} pulls, best ${pct(boss.bestWipePct)}`;
  return `<div class="prog">
    <h3>${esc(boss.boss)}</h3>
    <div class="meta">${esc(summary)}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${boss.boss}: boss health left at the end of each pull. ${summary}.`)}">${grid}${bars}</svg>
  </div>`;
}

function progression(model) {
  const charts = model.bosses.map((b) => progressionChart(b, model.pulls.filter((p) => p.bossKey === b.bossKey))).join("");
  return `<div class="card">
    <div class="card-head">
      <div><h2>Progression</h2><p>Boss health left when each pull ended. Lower is better; the pull number is along the bottom.</p></div>
      <div class="legend"><span><i style="background:var(--series)"></i>Wipe (health left)</span><span><i style="background:var(--good)"></i>Kill</span></div>
    </div>
    <div class="prog-grid">${charts}</div>
  </div>`;
}

function deathsSection(model) {
  const { byPlayer, byAbility } = model.deathStats;
  const players = byPlayer.map((r) => ({ ...r, _val: r.firstDeaths ? `${r.deaths} (${r.firstDeaths} first)` : `${r.deaths}` }));
  const abilities = byAbility.slice(0, 12).map((r) => ({ ...r, _val: r.count }));

  const logRows = model.deaths
    .map(
      (d) => `<tr><td>${esc(d.boss)}</td><td class="num">${d.pullNo}</td><td>${d.kill ? "Kill" : "Wipe"}</td><td class="num">${d.order}</td>
      <td>${cls(d.player, d.cls)}</td><td class="num">${formatDuration(d.atMs)}</td><td>${esc(d.ability)}</td></tr>`,
    )
    .join("");

  return `<div class="grid-2 section-gap">
    <div class="card">
      <div class="card-head"><div><h2>Deaths by player</h2><p>Across all boss pulls. "First" counts pulls where they were the first to die.</p></div></div>
      ${barList(players, {
        value: (r) => r.deaths,
        label: (r) => cls(r.name, r.cls),
        tip: (r) => `${r.name}: ${r.deaths} deaths, first to die in ${r.firstDeaths} pull${r.firstDeaths === 1 ? "" : "s"}`,
      })}
    </div>
    <div class="card">
      <div class="card-head"><div><h2>What killed people early</h2><p>Killing blows among the first three deaths of each pull.</p></div></div>
      ${barList(abilities, {
        value: (r) => r.count,
        label: (r) => esc(r.ability),
        tip: (r) => `${r.ability}: ${r.count} early death${r.count === 1 ? "" : "s"}`,
        second: true,
      })}
    </div>
  </div>
  <div class="card">
    <details class="log">
      <summary>Every death, pull by pull (${model.deaths.length})</summary>
      <div class="table-scroll"><table>
        <thead><tr><th>Boss</th><th class="num">Pull</th><th>Result</th><th class="num">#</th><th>Player</th><th class="num">Time</th><th>Killing blow</th></tr></thead>
        <tbody>${logRows}</tbody>
      </table></div>
    </details>
  </div>`;
}

export function killPanel(kill) {
  if (!kill) return "";
  const dmg = kill.damage.map((r) => ({ ...r, _val: formatNumber(r.perSecond) }));
  const heal = kill.healing.map((r) => ({ ...r, _val: formatNumber(r.perSecond) }));
  const tip = (unit) => (r) => `${r.name} (${r.cls}): ${formatNumber(r.perSecond)} ${unit}\n${formatNumber(r.total)} total`;
  return `<div class="grid-2">
    <div class="card">
      <div class="card-head"><div><h2>Damage per second</h2><p>Raid total ${formatNumber(kill.raidDps)} DPS over ${formatDuration(kill.durationMs)}</p></div></div>
      ${barList(dmg, { value: (r) => r.perSecond, label: (r) => cls(r.name, r.cls), tip: tip("DPS") })}
    </div>
    <div class="card">
      <div class="card-head"><div><h2>Healing per second</h2><p>Raid total ${formatNumber(kill.raidHps)} HPS</p></div></div>
      ${barList(heal, { value: (r) => r.perSecond, label: (r) => cls(r.name, r.cls), tip: tip("HPS"), second: true })}
    </div>
  </div>`;
}

function killsSection(model) {
  if (!model.kills.length) {
    return `<div class="card"><h2>Kills</h2><p class="muted">No boss kills in this report, so there are no damage or healing breakdowns.</p></div>`;
  }
  const options = model.kills
    .map((k, i) => `<option value="${i}">${esc(k.boss)} (${esc(k.difficulty)}, ${formatDuration(k.durationMs)})</option>`)
    .join("");
  return `<div class="card">
    <div class="card-head">
      <div><h2>Kills</h2><p>Damage and healing on each boss kill.</p></div>
      <label class="muted" style="font-size:.85rem">Kill <select id="kill-select" class="inline">${options}</select></label>
    </div>
    <div id="kill-panel">${killPanel(model.kills[0])}</div>
  </div>`;
}

function composition(model) {
  if (!model.composition.length) return "";
  const chips = model.composition.map((c) => `<span class="chip">${cls(`${c.cls} × ${c.count}`, c.cls)}</span>`).join("");
  return `<div class="card"><div class="card-head"><div><h2>Raid composition</h2><p>Players seen in boss pulls.</p></div></div><div class="chips">${chips}</div></div>`;
}

function pullLog(model) {
  const rows = model.pulls
    .map(
      (p) => `<tr><td class="num">${p.id}</td><td>${esc(p.boss)}</td><td class="num">${p.pullNo}</td>
      <td>${p.kill ? `<span class="result-kill">Kill</span>` : `<span class="result-wipe">Wipe</span>`}</td>
      <td class="num">${formatDuration(p.durationMs)}</td><td class="num">${p.kill ? "–" : pct(p.bossPct)}</td>
      <td class="num">${model.deaths.filter((d) => d.pullId === p.id).length}</td></tr>`,
    )
    .join("");
  return `<div class="card">
    <details class="log">
      <summary>All pulls (${model.pulls.length})</summary>
      <div class="table-scroll"><table>
        <thead><tr><th class="num">Fight</th><th>Boss</th><th class="num">Pull</th><th>Result</th><th class="num">Length</th><th class="num">Boss health</th><th class="num">Deaths</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>
  </div>`;
}

// ---- player checks: avoidable damage, interrupts, dispels ----

const notInFile = `<p class="muted">This saved file is from an older version and doesn't include this. Analyze the report again to see it.</p>`;
const topList = (pairs, fmt = (v) => v) => pairs.map(([k, v]) => `${k} (${fmt(v)})`).join(", ");

function avoidableCard(model, checks, bossKey) {
  const a = checks.avoidable;
  let body;
  if (!model.has.avoidable) body = notInFile;
  else if (!a.hits) {
    const listed = bossKey ? model.bosses.find((b) => b.bossKey === bossKey)?.boss : null;
    body = listed && !AVOIDABLE[listed]
      ? `<p class="muted">No avoidable abilities are listed for ${esc(listed)} yet. Add some in <code>js/avoidable.js</code>.</p>`
      : `<p class="muted">No avoidable damage taken. Nice.</p>`;
  } else {
    const rows = a.byPlayer.map((r) => ({ ...r, _val: r.hits ? `${formatNumber(r.total)} · ${r.hits} hit${r.hits === 1 ? "" : "s"}` : "0" }));
    const abilityRows = a.byAbility
      .map((r) => `<tr><td>${esc(r.ability)}</td><td class="num">${r.hits}</td><td class="num">${formatNumber(r.total)}</td><td class="wrap">${esc(topList(r.worst))}</td></tr>`)
      .join("");
    body = `${barList(rows, {
      value: (r) => r.total,
      label: (r) => cls(r.name, r.cls),
      tip: (r) => (r.hits ? `${r.name}: ${formatNumber(r.total)} avoidable damage in ${r.hits} hits\n${topList(r.top, formatNumber)}` : `${r.name}: no avoidable damage`),
    })}
    <details class="log"><summary>By ability</summary><div class="table-scroll"><table>
      <thead><tr><th>Ability</th><th class="num">Hits</th><th class="num">Damage</th><th>Hit most (times)</th></tr></thead>
      <tbody>${abilityRows}</tbody></table></div></details>`;
  }
  return `<div class="card">
    <div class="card-head"><div><h2>Avoidable damage</h2><p>Damage taken from mechanics you're meant to dodge, including absorbed damage. The ability list is in <code>js/avoidable.js</code>.</p></div></div>
    ${body}
  </div>`;
}

function actionCard(title, blurb, summary, has, noun, spellHeading) {
  let body;
  if (!has) body = notInFile;
  else if (!summary.total) body = `<p class="muted">No ${noun} on these pulls.</p>`;
  else {
    const rows = summary.byPlayer.map((r) => ({ ...r, _val: r.count }));
    const spellRows = summary.bySpell
      .map((r) => `<tr><td>${esc(r.spell)}</td><td class="num">${r.count}</td><td class="wrap">${esc(topList(r.top))}</td></tr>`)
      .join("");
    body = `${barList(rows, {
      value: (r) => r.count,
      label: (r) => cls(r.name, r.cls),
      tip: (r) => (r.count ? `${r.name}: ${r.count} ${noun}\n${topList(r.top)}` : `${r.name}: none`),
      second: true,
    })}
    <details class="log"><summary>${esc(spellHeading)}</summary><div class="table-scroll"><table>
      <thead><tr><th>${esc(spellHeading.replace(/^By /, "").replace(/^./, (c) => c.toUpperCase()))}</th><th class="num">Count</th><th>Done most by</th></tr></thead>
      <tbody>${spellRows}</tbody></table></div></details>`;
  }
  return `<div class="card"><div class="card-head"><div><h2>${esc(title)}</h2><p>${esc(blurb)}</p></div></div>${body}</div>`;
}

export function checksPanel(model, bossKey = null) {
  const checks = playerChecks(model, bossKey);
  return `${avoidableCard(model, checks, bossKey)}
  <div class="grid-2 section-gap">
    ${actionCard("Interrupts", "Enemy casts interrupted, per player.", checks.interrupts, model.has.interrupts, "interrupts", "By spell interrupted")}
    ${actionCard("Dispels", "Debuffs and buffs dispelled, per player.", checks.dispels, model.has.dispels, "dispels", "By aura dispelled")}
  </div>`;
}

function checksSection(model) {
  const options = model.bosses
    .map((b) => `<option value="${esc(b.bossKey)}">${esc(b.boss)}${model.bosses.filter((x) => x.boss === b.boss).length > 1 ? ` (${esc(b.difficulty)})` : ""}</option>`)
    .join("");
  return `<div class="section-bar">
      <div><h2>Player checks</h2><p class="muted">Across every boss pull, wipes included.</p></div>
      <label class="muted">Boss <select id="boss-filter" class="inline"><option value="">All bosses</option>${options}</select></label>
    </div>
    <div id="checks-panel">${checksPanel(model)}</div>`;
}

// ---- consumables ----

function statusCell(ok, text, label) {
  return `<td class="num"><span class="status ${ok ? "ok" : "bad"}" title="${esc(label)}">${ok ? "✓" : "⚠"} ${esc(text)}</span></td>`;
}

function consumablesSection(model) {
  let body;
  if (!model.has.consumables) body = notInFile;
  else if (!model.consumables.length) body = `<p class="muted">No buff data for this report.</p>`;
  else {
    const pct0 = (v) => `${Math.round(v * 100)}%`;
    const rows = model.consumables
      .map(
        (c) => `<tr>
        <td>${cls(c.name, c.cls)}</td>
        ${statusCell(c.flaskUptime >= FLASK_OK, pct0(c.flaskUptime), c.flaskNames.join(", ") || "No flask or elixir")}
        ${statusCell(c.foodUptime >= FOOD_OK, pct0(c.foodUptime), "Well Fed uptime")}
        ${statusCell(c.potionsPerPull >= POTIONS_OK, `${c.potionUses} (${c.potionsPerPull.toFixed(1)}/pull)`, c.potionNames.join(", ") || "No potions")}
        <td class="num">${c.pulls}</td>
      </tr>`,
      )
      .join("");
    const flagged = model.consumables.filter((c) => c.issues.length).length;
    body = `<p class="summary-line">${flagged ? `${flagged} of ${model.consumables.length} players missed something.` : "Everyone was flasked, fed and potting."}</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Player</th><th class="num">Flask / elixir</th><th class="num">Food</th><th class="num">Potions</th><th class="num">Pulls</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }
  return `<div class="card">
    <div class="card-head"><div><h2>Consumables</h2><p>Whole night, all bosses. Share of boss time with a flask or elixir and Well Fed, and potions used. Flagged below ${Math.round(FLASK_OK * 100)}% uptime or under ${POTIONS_OK} potion per pull.</p></div></div>
    ${body}
  </div>`;
}

export function renderReport(model, { isDemo = false } = {}) {
  if (!model.pulls.length) {
    return `${header(model, isDemo)}<div class="card"><p>This report has no boss pulls, so there's nothing to analyze yet.</p></div>`;
  }
  return [
    header(model, isDemo),
    tiles(model),
    bossTable(model),
    progression(model),
    deathsSection(model),
    killsSection(model),
    checksSection(model),
    consumablesSection(model),
    composition(model),
    pullLog(model),
  ].join("");
}
