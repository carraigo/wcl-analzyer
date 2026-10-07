// Warcraft Logs OAuth, done entirely in the browser.
//
// Primary route: Authorization Code + PKCE with a *public* client. The page
// sends the visitor to Warcraft Logs to sign in, gets a one-time code back on
// the redirect, and swaps it for a token. No secret is involved, so nothing
// sensitive is ever in this repo.
//
// Fallback route: client credentials. The visitor pastes their own client ID
// and secret; they stay in this browser's localStorage and only ever go to
// warcraftlogs.com.
//
// Tokens from the PKCE route call /api/v2/user; client-credential tokens call
// /api/v2/client. Both can read public reports.

const TOKEN_KEY = "wcl.token";
const PKCE_KEY = "wcl.pkce";

function storage(kind) {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(kind, key) {
  try {
    const raw = storage(kind)?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(kind, key, value) {
  try {
    if (value === null) storage(kind)?.removeItem(key);
    else storage(kind)?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the token just won't survive a reload */
  }
}

// ---- PKCE helpers (exported for tests) ----

export function base64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomVerifier(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes).slice(0, length);
}

export async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

// ---- token storage ----

export function currentToken() {
  const token = readJson("local", TOKEN_KEY);
  if (!token?.accessToken) return null;
  if (token.expiresAt && Date.now() > token.expiresAt - 60_000) {
    writeJson("local", TOKEN_KEY, null);
    return null;
  }
  return token;
}

export function signOut() {
  writeJson("local", TOKEN_KEY, null);
}

function saveToken(json, kind) {
  const token = {
    accessToken: json.access_token,
    kind, // "user" (PKCE) or "client" (client credentials)
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
  };
  writeJson("local", TOKEN_KEY, token);
  return token;
}

async function postToken(oauthHost, params) {
  let res;
  try {
    res = await fetch(`${oauthHost}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
  } catch (err) {
    throw new Error(
      `Couldn't reach ${oauthHost}/oauth/token (${err.message}). ` +
        "If this keeps happening the browser may be blocking the request (CORS).",
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const why = json.error_description || json.message || json.error || `HTTP ${res.status}`;
    throw new Error(`Warcraft Logs refused the sign-in: ${why}`);
  }
  return json;
}

// ---- PKCE flow ----

export function redirectUri() {
  // The page itself is the redirect target; strip any query or hash.
  return `${location.origin}${location.pathname}`;
}

export async function beginSignIn({ clientId, oauthHost, returnTo }) {
  if (!clientId) throw new Error("Add a Warcraft Logs client ID in Settings first.");
  const verifier = randomVerifier();
  const state = randomVerifier(24);
  const redirect = redirectUri();
  writeJson("session", PKCE_KEY, { verifier, state, clientId, oauthHost, redirect, returnTo });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
  });
  location.assign(`${oauthHost}/oauth/authorize?${params}`);
}

// Call on page load. Returns { token, returnTo } after a redirect back from
// Warcraft Logs, or null if this isn't one.
export async function finishSignInIfRedirected() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return null;

  const pending = readJson("session", PKCE_KEY);
  writeJson("session", PKCE_KEY, null);
  history.replaceState(null, "", redirectUri() + location.hash);

  if (error) throw new Error(`Sign-in was cancelled or failed: ${params.get("error_description") || error}`);
  if (!pending || pending.state !== params.get("state")) {
    throw new Error("Sign-in response didn't match this browser's request. Please try again.");
  }

  const json = await postToken(pending.oauthHost, {
    grant_type: "authorization_code",
    client_id: pending.clientId,
    code,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirect,
  });
  return { token: saveToken(json, "user"), returnTo: pending.returnTo };
}

// ---- client credentials fallback ----

export async function signInWithClientCredentials({ clientId, clientSecret, oauthHost }) {
  if (!clientId || !clientSecret) throw new Error("Both client ID and client secret are needed.");
  const json = await postToken(oauthHost, {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  return saveToken(json, "client");
}
