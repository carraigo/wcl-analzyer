// Abilities that count as "avoidable damage", per Mists of Pandaria boss.
//
// Matched by name (case-insensitive) against the abilities in each report, and
// only on that boss's pulls, so a name that isn't in a report does nothing.
// This is a starting list: edit it to match how your raid plays each fight.

export const AVOIDABLE = {
  // Mogu'shan Vaults
  "The Stone Guard": ["Amethyst Pool", "Cobalt Mine Blast"],
  "Feng the Accursed": ["Lightning Fists", "Epicenter", "Arcane Velocity"],
  "The Spirit Kings": ["Annihilate", "Volley", "Pillage"],
  "Elegon": ["Energy Cascade"],
  "Will of the Emperor": ["Devastating Arc", "Stomp"],

  // Heart of Fear
  "Imperial Vizier Zor'lok": ["Sonic Ring", "Sonic Pulse"],
  "Blade Lord Ta'yak": ["Blade Tempest", "Storm Unleashed"],
  "Garalon": ["Crush"],
  "Wind Lord Mel'jarak": ["Whirling Blade"],
  "Amber-Shaper Un'sok": ["Burning Amber"],
  "Grand Empress Shek'zeer": ["Consuming Terror"],

  // Terrace of Endless Spring
  "Protectors of the Endless": ["Defiled Ground"],
  "Sha of Fear": ["Breath of Fear"],

  // Throne of Thunder
  "Jin'rokh the Breaker": ["Lightning Fissure", "Focused Lightning"],
  "Horridon": ["Sand Trap", "Living Poison", "Lightning Nova"],
  "Council of Elders": ["Quicksand"],
  "Tortos": ["Rockfall"],
  "Megaera": ["Cinders", "Icy Ground"],
  "Ji-Kun": ["Caw"],
  "Durumu the Forgotten": ["Lingering Gaze", "Force of Will", "Disintegration Beam"],
  "Dark Animus": ["Crimson Wake"],
  "Iron Qon": ["Burning Cinders", "Frozen Blood"],
  "Twin Consorts": ["Tidal Force", "Cosmic Barrage", "Flames of Passion"],
  "Lei Shen": ["Thunderstruck", "Crashing Thunder", "Lightning Whip"],

  // Siege of Orgrimmar
  "Immerseus": ["Swirl", "Seeping Sha"],
  "The Fallen Protectors": ["Defiled Ground", "Noxious Poison"],
  "Sha of Pride": ["Bursting Pride"],
  "Galakras": ["Muzzle Spray"],
  "Iron Juggernaut": ["Explosive Tar", "Borer Drill", "Cutter Laser"],
  "Kor'kron Dark Shaman": ["Foul Geyser", "Toxic Storm", "Ashen Wall", "Falling Ash"],
  "General Nazgrim": ["Ravager", "Heroic Shockwave", "Aftershock"],
  "Malkorok": ["Breath of Y'Shaarj"],
  "Thok the Bloodthirsty": ["Burning Blood"],
  "Siegecrafter Blackfuse": ["Laser Burn", "Superheated"],
  "Garrosh Hellscream": ["Desecrated", "Iron Star Impact", "Whirling Corruption", "Empowered Whirling Corruption"],
};

const norm = (s) => String(s ?? "").trim().toLowerCase();

const BY_BOSS = new Map(Object.entries(AVOIDABLE).map(([boss, names]) => [norm(boss), new Set(names.map(norm))]));

export function isAvoidable(bossName, abilityName) {
  return BY_BOSS.get(norm(bossName))?.has(norm(abilityName)) ?? false;
}

// Game IDs in this report's ability list that are avoidable on a boss it contains.
export function avoidableAbilityIds(bossNames, abilities) {
  const wanted = new Set();
  for (const boss of bossNames) for (const name of BY_BOSS.get(norm(boss)) ?? []) wanted.add(name);
  return abilities.filter((a) => wanted.has(norm(a.name))).map((a) => a.gameID);
}
