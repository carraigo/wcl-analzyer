// Wires the page together: form, sign-in, settings, downloads, tooltip.

import { CONFIG } from "./config.js";
import { parseReportInput } from "./report-url.js";
import {
  beginSignIn, currentToken, finishSignInIfRedirected, redirectUri, signInWithClientCredentials, signOut,
} from "./auth.js";
import { AuthError, fetchReportBundle } from "./api.js";
import { buildModel, toCsv, PULL_COLUMNS, DEATH_COLUMNS } from "./transform.js";
import { renderReport, killPanel, checksPanel } from "./render.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "wcl.settings";

let current = null; // { bundle, model }

// ---- settings ----

function loadSettings() {
  try {
    return { ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return {};
  }
}
function saveSettings(s) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
const clientId = () => loadSettings().clientId || CONFIG.clientId;

// ---- messages ----

function showMessage(text, { error = false } = {}) {
  const el = $("message");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.hidden = !text;
}

function refreshAuthUi() {
  const token = currentToken();
  $("auth-status").textContent = token
    ? token.kind === "client" ? "Using your API client" : "Signed in"
    : "Not signed in";
  $("sign-in").hidden = Boolean(token);
  $("sign-out").hidden = !token;
}

// ---- analysis ----

function show(bundle) {
  const model = buildModel(bundle);
  current = { bundle, model };
  $("results").innerHTML = renderReport(model, { isDemo: Boolean(bundle.demo) });
  const select = $("kill-select");
  if (select) select.addEventListener("change", () => ($("kill-panel").innerHTML = killPanel(model.kills[Number(select.value)])));
  const bossFilter = $("boss-filter");
  if (bossFilter) bossFilter.addEventListener("change", () => ($("checks-panel").innerHTML = checksPanel(model, bossFilter.value || null)));
}

async function analyze(input) {
  let target;
  try {
    target = parseReportInput(input, CONFIG.defaultSite);
  } catch (err) {
    showMessage(err.message, { error: true });
    return;
  }

  const token = currentToken();
  if (!token) {
    if (clientId()) {
      showMessage("Sending you to Warcraft Logs to sign in…");
      await beginSignIn({ clientId: clientId(), oauthHost: CONFIG.oauthHost, returnTo: input });
    } else {
      showMessage("To read live reports, add a Warcraft Logs client ID in Settings (or try the demo data).", { error: true });
      $("settings").showModal();
    }
    return;
  }

  try {
    const bundle = await fetchReportBundle({ ...target, token, onProgress: (m) => showMessage(m) });
    show(bundle);
    showMessage("");
    history.replaceState(null, "", `#${target.site}/${target.code}`);
  } catch (err) {
    if (err instanceof AuthError) {
      signOut();
      refreshAuthUi();
    }
    showMessage(err.message, { error: true });
  }
}

async function loadDemo() {
  showMessage("Loading demo data…");
  try {
    const res = await fetch("demo/demo-report.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    show(await res.json());
    showMessage("");
  } catch (err) {
    showMessage(`Couldn't load the demo data (${err.message}). If you opened index.html straight from disk, serve the folder instead; see the README.`, { error: true });
  }
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const bundle = JSON.parse(reader.result);
      if (!bundle?.report?.fights) throw new Error("not a saved report file");
      show(bundle);
      showMessage("");
    } catch (err) {
      showMessage(`Couldn't read that file: ${err.message}.`, { error: true });
    }
  };
  reader.readAsText(file);
}

// ---- downloads ----

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleDownload(kind) {
  if (!current) return;
  const code = current.model.meta.code;
  if (kind === "pulls") download(`${code}-pulls.csv`, toCsv(current.model.pulls, PULL_COLUMNS), "text/csv");
  if (kind === "deaths") download(`${code}-deaths.csv`, toCsv(current.model.deaths, DEATH_COLUMNS), "text/csv");
  if (kind === "raw") download(`${code}.json`, JSON.stringify(current.bundle, null, 1), "application/json");
}

// ---- tooltip (anything with data-tip) ----

function setupTooltip() {
  const tip = $("tooltip");
  const place = (e) => {
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - pad;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    place(e);
  });
  document.addEventListener("pointermove", (e) => {
    if (!tip.hidden) place(e);
  });
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && !el.contains(e.relatedTarget)) tip.hidden = true;
  });
}

// ---- boot ----

function bind() {
  $("report-form").addEventListener("submit", (e) => {
    e.preventDefault();
    analyze($("report-input").value);
  });
  $("load-demo").addEventListener("click", loadDemo);
  $("load-file").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));
  $("results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-download]");
    if (btn) handleDownload(btn.dataset.download);
  });

  $("sign-in").addEventListener("click", async () => {
    if (!clientId()) {
      $("settings").showModal();
      return;
    }
    try {
      await beginSignIn({ clientId: clientId(), oauthHost: CONFIG.oauthHost, returnTo: $("report-input").value });
    } catch (err) {
      showMessage(err.message, { error: true });
    }
  });
  $("sign-out").addEventListener("click", () => {
    signOut();
    refreshAuthUi();
  });

  $("open-settings").addEventListener("click", () => {
    $("client-id").value = loadSettings().clientId || CONFIG.clientId;
    $("redirect-hint").textContent = redirectUri();
    $("settings").showModal();
  });
  $("settings").addEventListener("close", () => {
    if ($("settings").returnValue === "save") {
      saveSettings({ ...loadSettings(), clientId: $("client-id").value.trim() });
    }
  });
  $("cc-sign-in").addEventListener("click", async () => {
    try {
      await signInWithClientCredentials({
        clientId: $("cc-id").value.trim(),
        clientSecret: $("cc-secret").value.trim(),
        oauthHost: CONFIG.oauthHost,
      });
      $("cc-secret").value = "";
      $("settings").close();
      refreshAuthUi();
      showMessage("Got a token. Paste a report and press Analyze.");
    } catch (err) {
      showMessage(err.message, { error: true });
      $("settings").close();
    }
  });
}

async function boot() {
  bind();
  setupTooltip();
  $("redirect-hint").textContent = redirectUri();

  let returnTo = null;
  try {
    const result = await finishSignInIfRedirected();
    if (result) returnTo = result.returnTo;
  } catch (err) {
    showMessage(err.message, { error: true });
  }
  refreshAuthUi();

  // Resume what the user asked for before signing in, or a shared #site/code link.
  const fromHash = location.hash.match(/^#(\w+)\/([A-Za-z0-9]{16})$/);
  const pending = returnTo || (fromHash ? `https://${fromHash[1]}.warcraftlogs.com/reports/${fromHash[2]}` : null);
  if (pending) {
    $("report-input").value = pending;
    if (currentToken()) analyze(pending);
  }
}

boot();
