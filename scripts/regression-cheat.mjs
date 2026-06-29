import fs from 'node:fs';
const root = 'https://www.bungie.net/Platform';
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const defaultKey = appSource.match(/DEFAULT_API_KEY\s*=\s*"([^"]+)"/)?.[1];
const key = process.env.BUNGIE_API_KEY || defaultKey;
if (!key) throw new Error('Missing Bungie API key');
async function api(path, opts = {}) {
  const r = await fetch(root + path, { ...opts, headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json();
  if (j.ErrorCode !== 1) throw new Error(`${path}: ${j.ErrorStatus} ${j.Message}`);
  return j.Response;
}
function normalize(card) {
  const override = Number(card.crossSaveOverride || 0);
  return { membershipType: Number(card.membershipType), membershipId: String(card.membershipId), isCrossSavePrimary: Boolean(override && override === Number(card.membershipType)) };
}
async function chooseBest(profiles) {
  for (const profile of profiles) {
    const linked = await api(`/Destiny2/${profile.membershipType}/Profile/${profile.membershipId}/LinkedProfiles/?getAllMemberships=true`);
    const linkedProfiles = (linked.profiles || []).map(normalize);
    const crossSave = linkedProfiles.find((p) => p.isCrossSavePrimary);
    if (crossSave) return crossSave;
  }
  return profiles.find((p) => p.isCrossSavePrimary) || profiles[0];
}
const cards = (await api('/Destiny2/SearchDestinyPlayerByBungieName/-1/', { method: 'POST', body: JSON.stringify({ displayName: 'Cheat', displayNameCode: 7299 }) })).map(normalize);
const selected = await chooseBest(cards);
if (selected.membershipId !== '4611686018486184544' || selected.membershipType !== 2) {
  throw new Error(`Expected cross-save PS profile 4611686018486184544/2, got ${selected.membershipId}/${selected.membershipType}`);
}
const profile = await api(`/Destiny2/${selected.membershipType}/Profile/${selected.membershipId}/?components=200`);
const chars = Object.keys(profile.characters?.data || {});
let activities = [];
for (const ch of chars) {
  for (const mode of [4, 82]) {
    for (let page = 0; page < 3; page++) {
      const h = await api(`/Destiny2/${selected.membershipType}/Account/${selected.membershipId}/Character/${ch}/Stats/Activities/?mode=${mode}&count=250&page=${page}`);
      activities.push(...(h.activities || []));
      if ((h.activities || []).length < 250) break;
    }
  }
}
const unique = [...new Map(activities.filter((a) => a.values?.completed?.basic?.value === 1).map((a) => [a.activityDetails.instanceId, a])).values()];
let trioRaids = 0, flawlessRaids = 0;
for (const a of unique.slice(0, 220)) {
  const report = await api(`/Destiny2/Stats/PostGameCarnageReport/${a.activityDetails.instanceId}/`);
  if (!(a.activityDetails.modes || []).includes(4)) continue;
  const team = new Set(report.entries.map((e) => String(e.player?.destinyUserInfo?.membershipId)).filter(Boolean)).size;
  const flawless = report.entries.length > 0 && report.entries.every((e) => Number(e.values?.deaths?.basic?.value || 0) === 0);
  if (team === 3) trioRaids += 1;
  if (flawless) flawlessRaids += 1;
}
if (unique.length < 50 || trioRaids < 1 || flawlessRaids < 1) {
  throw new Error(`Expected visible clears for Cheat#7299; got unique=${unique.length}, trio=${trioRaids}, flawless=${flawlessRaids}`);
}
console.log(JSON.stringify({ selected, characters: chars.length, completedRaidDungeonActivities: unique.length, trioRaids, flawlessRaids }, null, 2));
