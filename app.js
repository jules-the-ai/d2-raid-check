const BUNGIE_ROOT = "https://www.bungie.net/Platform";
const RAID_MODE = 4;
const DUNGEON_MODE = 82;
const KEY_STORAGE = "d2-raid-check:bng-api-key";

const $ = (id) => document.getElementById(id);
const els = {
  form: $("searchForm"), apiKey: $("apiKey"), bungieName: $("bungieName"), maxPages: $("maxPages"),
  concurrency: $("concurrency"), status: $("status"), button: $("searchButton"), clearKey: $("clearKey"),
  matches: $("matches"), matchList: $("matchList"), summary: $("summary"), results: $("results"),
  resultsTitle: $("resultsTitle"), featGroups: $("featGroups"), downloadJson: $("downloadJson"), testKey: $("testKey")
};

let state = { apiKey: "", manifest: null, lastResult: null };

init();

function init() {
  els.apiKey.value = localStorage.getItem(KEY_STORAGE) || "";
  els.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runSearch();
  });
  els.testKey.addEventListener("click", testApiConnection);
  els.clearKey.addEventListener("click", () => {
    localStorage.removeItem(KEY_STORAGE);
    els.apiKey.value = "";
    setStatus("Saved API key removed from this browser.");
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
    state.apiKey = readAndPersistApiKey();

    const query = els.bungieName.value.trim();
    if (!query) throw new Error("Enter a Bungie Name.");

    setStatus("Loading Bungie manifest definitions…");
    state.manifest = await loadManifest();

    setStatus(`Searching for ${query}…`);
    const profiles = await searchProfiles(query);
    if (!profiles.length) throw new Error(`No Destiny profiles found for “${query}”. Try the full Bungie Name including #code.`);

    if (profiles.length === 1) {
      await scanProfile(profiles[0]);
    } else {
      showMatches(profiles);
      setStatus(`Found ${profiles.length} possible matches. Choose one to scan.`);
    }
  } catch (error) {
    console.error(error);
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function readAndPersistApiKey() {
  const key = els.apiKey.value.trim();
  if (!key) throw new Error("A Bungie API key is required.");
  localStorage.setItem(KEY_STORAGE, key);
  return key;
}

async function testApiConnection() {
  try {
    setBusy(true, "Testing…");
    state.apiKey = readAndPersistApiKey();
    state.manifest = null;
    setStatus("Testing Bungie API key against the manifest endpoint…");
    const manifest = await bungie("/Destiny2/Manifest/");
    const mobileWorld = manifest.mobileWorldContentPaths?.en || manifest.jsonWorldComponentContentPaths?.en?.DestinyActivityDefinition;
    setStatus(`API key works. Manifest version ${manifest.version || "unknown"}; content path loaded: ${mobileWorld ? "yes" : "no"}.`);
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
  const response = await fetch(`${BUNGIE_ROOT}${path}`, { ...options, headers });
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

function showMatches(profiles) {
  els.matches.hidden = false;
  els.matchList.replaceChildren(...profiles.map((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "match-card";
    button.innerHTML = `<strong>${escapeHtml(profile.displayName)}</strong><span>${profile.platformName}${profile.isCrossSavePrimary ? " · cross-save primary" : ""}</span>`;
    button.addEventListener("click", () => scanProfile(profile).catch((e) => setStatus(e.message, true)).finally(() => setBusy(false)));
    return button;
  }));
}

async function scanProfile(profile) {
  setBusy(true);
  clearResults(false);
  els.matches.hidden = true;
  setStatus(`Loading characters for ${profile.displayName}…`);
  const selected = await resolveLinkedProfile(profile);
  const profileData = await bungie(`/Destiny2/${selected.membershipType}/Profile/${selected.membershipId}/?components=200`);
  const characterIds = Object.keys(profileData.characters?.data || {});
  if (!characterIds.length) throw new Error("No Destiny 2 characters found on this profile.");

  const maxPages = clamp(Number(els.maxPages.value) || 20, 1, 80);
  const concurrency = clamp(Number(els.concurrency.value) || 4, 1, 8);
  setStatus(`Scanning ${characterIds.length} characters (${maxPages} pages per character/mode max)…`);
  const activities = await collectActivities(selected, characterIds, maxPages);
  const completed = activities.filter((a) => statValue(a.values?.completed) === 1);
  const unique = dedupeActivities(completed);
  setStatus(`Found ${unique.length} completed raid/dungeon activities. Fetching PGCRs…`);
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
    contest: isContest(report, activity, modifierText),
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
    flawlessRaids: rows.filter((r) => r.mode === "Raid" && r.flawless && full(r)).sort(byDate),
    trioRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 3 && full(r)).sort(byDate),
    duoRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 2 && full(r)).sort(byDate),
    soloRaids: rows.filter((r) => r.mode === "Raid" && r.teamSize === 1 && full(r)).sort(byDate),
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
    ["Trio raid clears", "Completed full raid clears with three unique players in the PGCR.", feats.trioRaids],
    ["Duo raid clears", "Completed full raid clears with two unique players in the PGCR.", feats.duoRaids],
    ["Solo raid clears", "Completed full raid clears with one unique player in the PGCR.", feats.soloRaids],
    ["Contest mode clears", "Completed activities with contest detected from activity/modifier definitions.", feats.contestClears]
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
    tr.innerHTML = `<td>${formatDate(r.date)}</td><td>${escapeHtml(r.activityName)}${r.contest ? " <span class='badge'>Contest</span>" : ""}</td><td>${r.mode}</td><td>${r.teamSize}</td><td>${formatDuration(r.durationSeconds)}</td><td>${r.playerDeaths} / ${r.teamDeaths}</td><td><a href="${r.pgcrUrl}" target="_blank" rel="noreferrer">PGCR</a></td>`;
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
function setBusy(busy, label = "Working…") { els.button.disabled = busy; els.testKey.disabled = busy; els.button.textContent = busy ? label : "Search feats"; }
function clearResults(hideMatches = true) {
  if (hideMatches) els.matches.hidden = true;
  els.summary.hidden = true; els.summary.innerHTML = "";
  els.results.hidden = true; els.featGroups.innerHTML = "";
}
