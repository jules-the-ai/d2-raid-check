# D2 Raid Check

A static, browser-only Destiny 2 raid and dungeon feat checker powered by the official Bungie API.

## What it does

Enter a Bungie Name and a Bungie API key, then the app searches Destiny profiles and scans raid/dungeon activity history in the browser. For completed activities it fetches Post Game Carnage Reports (PGCRs) and detects:

- Trio raid clears
- Duo raid clears
- Solo raid clears
- Solo flawless dungeon clears
- Solo flawless raid clears
- Flawless raid clears
- Contest mode clears when Bungie activity/modifier definitions expose contest metadata

## Privacy model

There is no backend. The Bungie API key is stored only in the browser's `localStorage` so it can be reused on the same machine. Use the "Forget saved key" button to remove it.

Because this is a browser-only app, do not hard-code a private Bungie API key in the repo. Create a Bungie app at https://www.bungie.net/7/en/Application and paste the API key into the app UI.

## Local development

Any static file server works:

```bash
python3 -m http.server 8088 --bind 0.0.0.0 --directory .
```

Then open http://127.0.0.1:8088/.

## Bungie API endpoints used

- `GET /Platform/Destiny2/Manifest/`
- `POST /Platform/Destiny2/SearchDestinyPlayerByBungieName/{membershipType}/`
- `GET /Platform/User/Search/Prefix/{displayNamePrefix}/{page}/`
- `GET /Platform/User/GetMembershipsById/{membershipId}/{membershipType}/`
- `GET /Platform/Destiny2/{membershipType}/Profile/{membershipId}/LinkedProfiles/`
- `GET /Platform/Destiny2/{membershipType}/Profile/{membershipId}/?components=200`
- `GET /Platform/Destiny2/{membershipType}/Account/{membershipId}/Character/{characterId}/Stats/Activities/`
- `GET /Platform/Destiny2/Stats/PostGameCarnageReport/{activityId}/`

## Detection notes and limitations

- Full clears use Bungie's `activityWasStartedFromBeginning` PGCR flag when that flag is present. If Bungie omits the flag for an older report, the app keeps the clear rather than silently hiding it.
- Fireteam size is the number of unique Destiny memberships listed in the PGCR.
- Flawless means every player entry in the PGCR has zero deaths.
- Contest mode is detected by looking for the word `contest` in loaded activity/modifier definitions. Bungie does not expose every historical contest state consistently, so contest results should be treated as best-effort.
- History scanning is paginated; increase "Max history pages" in the UI to search older clears at the cost of more API calls.
