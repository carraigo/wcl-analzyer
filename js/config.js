// Site-wide settings. Everything here is public: it ships to every visitor.
//
// clientId: the ID of a *public* (PKCE) Warcraft Logs API client. Create one at
//   https://www.warcraftlogs.com/api/clients/ with "Public Client" ticked and the
//   redirect URL set to wherever this page is hosted. A public client has no
//   secret, so it is safe to commit. Leave it blank and each visitor can paste
//   their own in the Settings panel instead.
export const CONFIG = {
  clientId: "01a117d3-38f7-73ec-b1ae-84eeb59cb253",
  // Accounts and OAuth live on the main site for every game flavour.
  oauthHost: "https://www.warcraftlogs.com",
  // Used when someone pastes a bare report code instead of a full URL.
  defaultSite: "classic",
};
