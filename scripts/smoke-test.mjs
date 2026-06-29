const root = "https://www.bungie.net/Platform";
const apiKey = process.env.BUNGIE_API_KEY;
const bungieName = process.env.BUNGIE_NAME || "";

if (!apiKey) {
  console.error("Set BUNGIE_API_KEY to run the live API smoke test. Optional: BUNGIE_NAME='Name#1234'.");
  process.exit(2);
}

async function bungie(path, options = {}) {
  const headers = { "X-API-Key": apiKey, ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${root}${path}`, { ...options, headers });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON response ${response.status}: ${text.slice(0, 200)}`); }
  if (!response.ok || (json.ErrorCode && json.ErrorCode !== 1)) {
    throw new Error(`Bungie error ${response.status} ${json.ErrorStatus || json.ErrorCode}: ${json.Message || text.slice(0, 200)}`);
  }
  return json.Response;
}

function parseBungieName(input) {
  const match = input.match(/^(.+?)#(\d{4,})$/);
  return match ? { displayName: match[1].trim(), displayNameCode: Number(match[2]) } : null;
}

console.log("Checking manifest…");
const manifest = await bungie("/Destiny2/Manifest/");
console.log(JSON.stringify({ manifestVersion: manifest.version, hasEnglishJson: Boolean(manifest.jsonWorldComponentContentPaths?.en) }, null, 2));

if (bungieName) {
  const parsed = parseBungieName(bungieName);
  if (!parsed) throw new Error("BUNGIE_NAME must include the numeric suffix, e.g. Guardian#1234");
  console.log(`Searching ${bungieName}…`);
  const cards = await bungie("/Destiny2/SearchDestinyPlayerByBungieName/-1/", { method: "POST", body: JSON.stringify(parsed) });
  console.log(JSON.stringify({ matches: cards.length, firstMatch: cards[0] || null }, null, 2));
}
