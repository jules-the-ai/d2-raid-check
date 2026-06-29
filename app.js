const BUNGIE_ROOT = "https://www.bungie.net/Platform";
const BUNGIE_STATS_ROOT = "https://stats.bungie.net/Platform";
const RAID_MODE = 4;
const DUNGEON_MODE = 82;
const DEFAULT_API_KEY = "69d09479fd7343a4bbe7da8e8ac6f537";
const BUNGIE_CLIENT_ID = "53377";

const CONTEST_EVENTS = [
  { name: "The Desert Perpetual", kind: "Raid", start: "2025-09-27T16:00:00Z", end: "2025-09-30T17:00:00Z", hashes: [2586252122, 3896382790] },
  { name: "Equilibrium", kind: "Dungeon", start: "2025-07-19T16:00:00Z", end: "2025-07-22T17:00:00Z", hashes: [1754635208] },
  { name: "Sundered Doctrine", kind: "Dungeon", start: "2025-02-07T17:00:00Z", end: "2025-02-10T17:00:00Z", hashes: [247869137, 3834447244] },
  { name: "Vesper's Host", kind: "Dungeon", start: "2024-10-11T17:00:00Z", end: "2024-10-14T17:00:00Z", hashes: [1915770060, 3492566689, 300092127] },
  { name: "Salvation's Edge", kind: "Raid", start: "2024-06-07T17:00:00Z", end: "2024-06-10T17:00:00Z", hashes: [2192826039, 940375169, 1541433876] },
  { name: "Crota's End", kind: "Raid", start: "2023-09-01T17:00:00Z", end: "2023-09-03T17:00:00Z", hashes: [4179289725, 156253568, 107319834, 1566480315] },
  { name: "Root of Nightmares", kind: "Raid", start: "2023-03-10T17:00:00Z", end: "2023-03-12T17:00:00Z", hashes: [2381413764] },
  { name: "King's Fall", kind: "Raid", start: "2022-08-26T17:00:00Z", end: "2022-08-28T17:00:00Z", hashes: [2897223272, 1374392663] },
  { name: "Vow of the Disciple", kind: "Raid", start: "2022-03-05T18:00:00Z", end: "2022-03-07T18:00:00Z", hashes: [4156879541, 2906950631, 1441982566] },
  { name: "Vault of Glass", kind: "Raid", start: "2021-05-22T17:00:00Z", end: "2021-05-24T17:00:00Z", hashes: [3711931140, 1485585878, 3881495763] }
].map((event) => ({ ...event, hashSet: new Set(event.hashes.map(String)), startMs: Date.parse(event.start), endMs: Date.parse(event.end) }));
const EARLIEST_CONTEST_START_MS = Math.min(...CONTEST_EVENTS.map((event) => event.startMs));


const $ = (id) => document.getElementById(id);
const els = {
  form: $("searchForm"), bungieName: $("bungieName"), maxPages: $("maxPages"),
  concurrency: $("concurrency"), status: $("status"), button: $("searchButton"),
  summary: $("summary"), results: $("results"),
  resultsTitle: $("resultsTitle"), featGroups: $("featGroups"), downloadJson: $("downloadJson")
};

let state = { apiKey: "", manifest: null, lastResult: null };

init();

function init() {
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runSearch();
  });
  els.downloadJson.addEventListener("click", () => {
    if (!state.lastResult) return;
    const blob = new Blob([JSON.stringify(state.lastResult, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `d2-raid-check-${state.lastResult.profile.displayName.replace(/[^a-z0-9_-]+/gi, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

async function runSearch() {
  try {
    setBusy(true);
    clearResults();
    state.apiKey = DEFAULT_API_KEY;
    if (!state.apiKey) throw new Error("The site is missing its Bungie API key.");

    const query = els.bungieName.value.trim();
    if (!query) throw new Error("Enter a Bungie Name.");

    state.manifest = null;
    setStatus(`Searching for ${query}…`);
    const profiles = await searchProfiles(query);
    if (!profiles.length) throw new Error(`No Destiny profiles found for “${query}”. Try the full Bungie Name including #code.`);

    const profile = await chooseBestProfile(profiles);
    setStatus(`Using ${profile.displayName} on ${profile.platformName}${profile.isCrossSavePrimary ? " (cross-save primary)" : ""}.`);
    await scanProfile(profile);
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function bungie(path, options = {}) {
  const headers = { "X-API-Key": state.apiKey, ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const root = path.startsWith("/Destiny2/Stats/PostGameCarnageReport/") ? BUNGIE_STATS_ROOT : BUNGIE_ROOT;
  const response = await fetch(`${root}${path}`, { ...options, headers });
  if (!response.ok) {
    const detail = response.status === 401 || response.status === 403 ? " Check that the API key is correct and enabled for Bungie.net API use." : "";
    throw new Error(`Bungie HTTP ${response.status} for ${path}.${detail}`);
  }
  const json = await response.json();
  if (json.ErrorCode && json.ErrorCode !== 1) throw new Error(`${json.Message || "Bungie API error"} (${json.ErrorStatus || json.ErrorCode})`);
  return json.Response;
}

async function loadManifest() {
  if (state.manifest) return state.manifest;
  const manifest = await bungie("/Destiny2/Manifest/");
  const paths = manifest.jsonWorldComponentContentPaths?.en;
  if (!paths) throw new Error("Bungie manifest did not include English component paths.");
  const wanted = ["DestinyActivityDefinition", "DestinyActivityModifierDefinition"];
  const out = {};
  await Promise.all(wanted.map(async (name) => {
    if (!paths[name]) return;
    const res = await fetch(`https://www.bungie.net${paths[name]}`);
    if (!res.ok) throw new Error(`Failed to load manifest component ${name}`);
    out[name] = await res.json();
  }));
  return out;
}

async function searchProfiles(input) {
  const exact = parseBungieName(input);
  let cards = [];
  if (exact) {
    cards = await bungie("/Destiny2/SearchDestinyPlayerByBungieName/-1/", {
      method: "POST",
      body: JSON.stringify({ displayName: exact.name, displayNameCode: exact.code })
    });
  }
  if (!cards?.length) cards = await prefixSearch(input);
  const deduped = new Map();
  for (const card of cards || []) {
    const key = `${card.membershipType}:${card.membershipId}`;
    if (card.membershipId && !deduped.has(key)) deduped.set(key, normalizeCard(card));
  }
  return [...deduped.values()].sort((a, b) => Number(b.isCrossSavePrimary) - Number(a.isCrossSavePrimary));
}

function parseBungieName(input) {
  const match = input.match(/^(.+?)#(\d{4,})$/);
  return match ? { name: match[1].trim(), code: Number(match[2]) } : null;
}

async function prefixSearch(input) {
  const prefix = input.split("#")[0].trim();
  if (prefix.length < 2) return [];
  const users = await bungie(`/User/Search/Prefix/${encodeURIComponent(prefix)}/0/`);
  const exactish = (users?.searchResults || users || []).slice(0, 8);
  const allCards = [];
  for (const user of exactish) {
    const id = user.bungieNetMembershipId || user.membershipId;
    if (!id) continue;
    try {
      const memberships = await bungie(`/User/GetMembershipsById/${id}/254/`);
      allCards.push(...(memberships.destinyMemberships || []));
    } catch (error) {
      console.warn("Membership lookup failed", user, error);
    }
  }
  return allCards;
}

function normalizeCard(card) {
  const override = Number(card.crossSaveOverride || 0);
  return {
    membershipType: Number(card.membershipType),
    membershipId: String(card.membershipId),
    displayName: `${card.bungieGlobalDisplayName || card.displayName || "Unknown"}${card.bungieGlobalDisplayNameCode ? `#${String(card.bungieGlobalDisplayNameCode).padStart(4, "0")}` : ""}`,
    platformName: platformName(card.membershipType),
    isCrossSavePrimary: override && override === Number(card.membershipType),
    raw: card
  };
}

async function chooseBestProfile(profiles) {
  for (const profile of profiles) {
    try {
      const linked = await bungie(`/Destiny2/${profile.membershipType}/Profile/${profile.membershipId}/LinkedProfiles/?getAllMemberships=true`);
      const linkedProfiles = (linked.profiles || []).map(normalizeCard);
      const crossSave = linkedProfiles.find((p) => p.isCrossSavePrimary || Number(p.raw?.crossSaveOverride || 0) === Number(p.membershipType));
      if (crossSave) return crossSave;
    } catch (error) {
      console.warn("Linked profile lookup failed while choosing profile", profile, error);
    }
  }
  return profiles.find((p) => p.isCrossSavePrimary) || profiles[0];
}

async function scanProfile(profile) {
  setBusy(true);
  clearResults(false);
  setStatus(`Loading characters for ${profile.displayName}…`);
  const selected = await resolveLinkedProfile(profile);
  const profileData = await bungie(`/Destiny2/${selected.membershipType}/Profile/${selected.membershipId}/?components=200`);
  const characterIds = Object.keys(profileData.characters?.data || {});
  if (!characterIds.length) throw new Error("No Destiny 2 characters found on this profile.");

  const maxPages = clamp(Number(els.maxPages.value) || 20, 1, 80);
  const concurrency = clamp(Number(els.concurrency.value) || 4, 1, 8);
  setStatus(`Scanning ${characterIds.length} characters (${maxPages} pages per character/mode max)…`);
  const activities = await collectActivities(selected, characterIds, maxPages);
  const contestActivities = await collectContestActivities(selected, characterIds, maxPages);
  const completed = [...activities, ...contestActivities].filter((a) => statValue(a.values?.completed) === 1);
  const unique = dedupeActivities(completed);
  setStatus(`Found ${unique.length} completed raid/dungeon activities, including targeted contest windows. Fetching PGCRs…`);
  const reports = await fetchReports(unique, concurrency);
  const analyzed = reports.map((report) => analyzeReport(report, selected)).filter(Boolean);
  const feats = categorizeFeats(analyzed);
  state.lastResult = { generatedAt: new Date().toISOString(), profile: selected, totals: summarize(feats, analyzed), feats, reports: analyzed };
  renderResults(selected, feats, analyzed);
  setStatus(`Done. Scanned ${activities.length} history rows and ${reports.length} PGCRs for ${selected.displayName}.`);
  setBusy(false);
}

async function resolveLinkedProfile(profile) {
  try {
    const linked = await bungie(`/Destiny2/${profile.membershipType}/Profile/${profile.membershipId}/LinkedProfiles/?getAllMemberships=true`);
    const profiles = linked.profiles || [];
    const primary = profiles.find((p) => p.isCrossSavePrimary) || profiles.find((p) => String(p.membershipId) === profile.membershipId) || profiles[0];
    if (primary) return normalizeCard(primary);
  } catch (error) {
    console.warn("Linked profile lookup failed; using selected profile", error);
  }
  return profile;
}

async function collectActivities(profile, characterIds, maxPages) {
  const rows = [];
  for (const characterId of characterIds) {
    for (const mode of [RAID_MODE, DUNGEON_MODE]) {
      for (let page = 0; page < maxPages; page++) {
        setStatus(`Scanning ${mode === RAID_MODE ? "raid" : "dungeon"} history: character ${characterIds.indexOf(characterId) + 1}/${characterIds.length}, page ${page + 1}/${maxPages}…`);
        const data = await bungie(`/Destiny2/${profile.membershipType}/Account/${profile.membershipId}/Character/${characterId}/Stats/Activities/?mode=${mode}&count=250&page=${page}`);
        const acts = data.activities || [];
        rows.push(...acts);
        if (acts.length < 250) break;
      }
    }
  }
  return rows;
}

async function collectContestActivities(profile, characterIds, normalMaxPages) {
  const rows = [];
  const maxContestPages = Math.max(normalMaxPages, 80);
  for (const characterId of characterIds) {
    for (const mode of [RAID_MODE, DUNGEON_MODE]) {
      for (let page = 0; page < maxContestPages; page++) {
        setStatus(`Targeted contest scan: ${mode === RAID_MODE ? "raid" : "dungeon"} history, character ${characterIds.indexOf(characterId) + 1}/${characterIds.length}, page ${page + 1}/${maxContestPages}…`);
        const data = await bungie(`/Destiny2/${profile.membershipType}/Account/${profile.membershipId}/Character/${characterId}/Stats/Activities/?mode=${mode}&count=250&page=${page}`);
        const acts = data.activities || [];
        rows.push(...acts.filter(activityMatchesContestWindow));
        if (acts.length < 250) break;
        const lastTime = Date.parse(acts.at(-1)?.period || "");
        if (Number.isFinite(lastTime) && lastTime < EARLIEST_CONTEST_START_MS) break;
      }
    }
  }
  return rows;
}

function activityMatchesContestWindow(activity) {
  const details = activity.activityDetails || {};
  const hash = String(details.directorActivityHash || details.referenceId || "");
  const time = Date.parse(activity.period || "");
  if (!Number.isFinite(time)) return false;
  return CONTEST_EVENTS.some((event) => time >= event.startMs && time <= event.endMs && event.hashSet.has(hash));
}

function dedupeActivities(activities) {
  const map = new Map();
  for (const a of activities) {
    const id = String(a.activityDetails?.instanceId || "");
    if (id && !map.has(id)) map.set(id, a);
  }
  return [...map.values()].sort((a, b) => new Date(b.period) - new Date(a.period));
}

async function fetchReports(activities, concurrency) {
  const results = new Array(activities.length);
  let cursor = 0;
  async function worker() {
    while (cursor < activities.length) {
      const i = cursor++;
      const id = activities[i].activityDetails.instanceId;
      try {
        results[i] = await bungie(`/Destiny2/Stats/PostGameCarnageReport/${id}/`);
      } catch (error) {
        console.warn(`Failed PGCR ${id}`, error);
      }
      if (i % 10 === 0) setStatus(`Fetched ${Math.min(i + 1, activities.length)}/${activities.length} PGCRs…`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, activities.length) }, worker));
  return results.filter(Boolean);
}

function analyzeReport(report, profile) {
  const details = report.activityDetails || {};
  const mode = (details.modes || []).includes(DUNGEON_MODE) ? "Dungeon" : (details.modes || []).includes(RAID_MODE) ? "Raid" : null;
  if (!mode) return null;
  const entries = report.entries || [];
  const playerEntry = entries.find((e) => String(e.player?.destinyUserInfo?.membershipId) === profile.membershipId || String(e.player?.destinyUserInfo?.membershipId) === String(profile.raw?.membershipId));
  if (!playerEntry || statValue(playerEntry.values?.completed) !== 1) return null;
  const uniquePlayers = new Map();
  for (const e of entries) {
    const info = e.player?.destinyUserInfo;
    if (info?.membershipId) uniquePlayers.set(String(info.membershipId), info);
  }
  const teamDeaths = entries.reduce((sum, e) => sum + statValue(e.values?.deaths), 0);
  const playerDeaths = statValue(playerEntry.values?.deaths);
  const duration = statValue(playerEntry.values?.activityDurationSeconds) || statValue(report.entries?.[0]?.values?.activityDurationSeconds);
  const activity = activityDefinition(details.directorActivityHash || details.referenceId);
  const modifierText = modifierNames(report).join(" · ");
  return {
    instanceId: String(details.instanceId),
    date: report.period,
    activityHash: String(details.directorActivityHash || details.referenceId || ""),
    activityName: activity?.displayProperties?.name || `Activity ${details.directorActivityHash || details.referenceId}`,
    mode,
    teamSize: uniquePlayers.size || entries.length,
    startedFromBeginning: report.activityWasStartedFromBeginning === true,
    startedFromBeginningKnown: typeof report.activityWasStartedFromBeginning === "boolean",
    flawless: entries.length > 0 && entries.every((e) => statValue(e.values?.deaths) === 0),
    playerDeaths,
    teamDeaths,
    durationSeconds: duration,
    contest: Boolean(contestEventForReport(report)) || isContest(report, activity, modifierText),
    contestEvent: contestEventForReport(report)?.name || "",
    modifiers: modifierText,
    pgcrUrl: `https://www.bungie.net/7/en/PGCR/${details.instanceId}`
  };
}

function categorizeFeats(rows) {
  const full = (r) => r.startedFromBeginning || !r.startedFromBeginningKnown;
  const byDate = (a, b) => new Date(b.date) - new Date(a.date);
  return {
    soloDungeonFlawless: rows.filter((r) => r.mode === "Dungeon" && r.teamSize === 1 && r.flawless && full(r)).sort(byDate),
    soloRaidFlawless: rows.filter((r) => r.mode === "Raid" && r.teamSize === 1 && r.flawless && full(r)).sort(byDate),
    flawlessRaids: rows.filter((r) => r.mode === "Raid" && r.flawless).sort(byDate),
    trioRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 3).sort(byDate),
    duoRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 2).sort(byDate),
    soloRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 1).sort(byDate),
    contestClears: rows.filter((r) => r.contest).sort(byDate)
  };
}

function renderResults(profile, feats, analyzed) {
  els.results.hidden = false;
  els.summary.hidden = false;
  els.resultsTitle.textContent = `${profile.displayName} (${profile.platformName})`;
  const totals = summarize(feats, analyzed);
  els.summary.innerHTML = Object.entries(totals).map(([label, value]) => `<div class="stat"><span>${escapeHtml(label)}</span><b>${value}</b></div>`).join("");
  const groups = [
    ["Solo flawless dungeons", "Completed from the beginning with one player and zero deaths.", feats.soloDungeonFlawless],
    ["Solo flawless raids", "Completed from the beginning with one player and zero deaths.", feats.soloRaidFlawless],
    ["Flawless raids", "Completed raid PGCRs where every listed player had zero deaths.", feats.flawlessRaids],
    ["Trio raid clears", "Completed raid clears with three unique players in the PGCR.", feats.trioRaids],
    ["Duo raid clears", "Completed raid clears with two unique players in the PGCR.", feats.duoRaids],
    ["Solo raid clears", "Completed raid clears with one unique player in the PGCR.", feats.soloRaids],
    ["Contest mode clears", "Completed activities found by known contest raid/dungeon hashes and launch-window dates, plus Bungie contest metadata when available.", feats.contestClears]
  ];
  els.featGroups.replaceChildren(...groups.map(([title, note, rows]) => renderGroup(title, note, rows)));
}

function renderGroup(title, note, rows) {
  const node = $("featTableTemplate").content.firstElementChild.cloneNode(true);
  node.querySelector("h3").textContent = `${title} (${rows.length})`;
  node.querySelector(".group-note").textContent = note;
  const tbody = node.querySelector("tbody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">No matching clears found in the scanned history.</td></tr>`;
    return node;
  }
  tbody.replaceChildren(...rows.map((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDate(r.date)}</td><td>${escapeHtml(r.contestEvent || r.activityName)}${r.contest ? " <span class='badge'>Contest</span>" : ""}</td><td>${r.mode}</td><td>${r.teamSize}</td><td>${formatDuration(r.durationSeconds)}</td><td>${r.playerDeaths} / ${r.teamDeaths}</td><td><a href="${r.pgcrUrl}" target="_blank" rel="noreferrer">PGCR</a></td>`;
    return tr;
  }));
  return node;
}

function summarize(feats, analyzed) {
  return {
    "Raid/Dungeon clears scanned": analyzed.length,
    "Solo flawless dungeons": feats.soloDungeonFlawless.length,
    "Flawless raids": feats.flawlessRaids.length,
    "Trio raids": feats.trioRaids.length,
    "Duo raids": feats.duoRaids.length,
    "Solo raids": feats.soloRaids.length,
    "Contest clears": feats.contestClears.length
  };
}

function activityDefinition(hash) { return state.manifest?.DestinyActivityDefinition?.[toUnsigned(hash)]; }
function modifierDefinition(hash) { return state.manifest?.DestinyActivityModifierDefinition?.[toUnsigned(hash)]; }
function modifierNames(report) {
  return (report.selectedSkullHashes || []).map((h) => modifierDefinition(h)?.displayProperties).filter(Boolean).map((d) => `${d.name || ""} ${d.description || ""}`.trim()).filter(Boolean);
}
function isContest(report, activity, modifierText) {
  const haystack = [activity?.displayProperties?.name, activity?.displayProperties?.description, modifierText].filter(Boolean).join(" ").toLowerCase();
  return /\bcontest\b/.test(haystack);
}
function statValue(stat) { return Number(stat?.basic?.value ?? stat?.value ?? 0); }
function toUnsigned(hash) { return String(Number(hash) >>> 0); }
function platformName(type) { return ({ 1: "Xbox", 2: "PlayStation", 3: "Steam", 4: "Blizzard", 5: "Stadia", 6: "Epic", 10: "Demon", 254: "Bungie" })[Number(type)] || `Membership ${type}`; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Unknown"; }
function formatDuration(seconds) {
  seconds = Number(seconds) || 0;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]); }
function setStatus(message, isError = false) { els.status.textContent = message; els.status.style.color = isError ? "var(--bad)" : ""; }
function setBusy(busy, label = "Working…") { els.button.disabled = busy; els.button.textContent = busy ? label : "Search feats"; }
function clearResults() {
  els.summary.hidden = true; els.summary.innerHTML = "";
  els.results.hidden = true; els.featGroups.innerHTML = "";
}
