# D2 Raid Check

A static, browser-only Destiny 2 raid and dungeon feat checker powered by the official Bungie API.

## What it does

Enter a Bungie Name, then the app searches Destiny profiles and scans raid/dungeon activity history in the browser. For completed activities it fetches Post Game Carnage Reports (PGCRs) and detects:

- Trio raid clears
- Duo raid clears
- Solo raid clears
- Solo flawless dungeon clears
- Solo flawless raid clears
- Flawless raid clears
- Contest mode clears when Bungie activity/modifier definitions expose contest metadata

## Privacy model

There is no backend. This public GitHub Pages build includes an origin-restricted Bungie API key for `https://jules-the-ai.github.io`, and users only enter a Bungie Name. No user-provided API key is stored.

## API-key testing

For command-line verification, run:

```bash
BUNGIE_API_KEY=your_key npm run smoke:bungie
BUNGIE_API_KEY=your_key BUNGIE_NAME="Guardian#1234" npm run smoke:bungie
```

Keep keys in your shell or an ignored `.env.local` file for CLI testing.

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

- Low-man raid clears are counted from any completed PGCR with the matching team size. Solo flawless full clears still require Bungie's `activityWasStartedFromBeginning` PGCR flag when that flag is present.
- Fireteam size is the number of unique Destiny memberships listed in the PGCR.
- Flawless means every player entry in the PGCR has zero deaths.
- Contest mode is detected by looking for the word `contest` in loaded activity/modifier definitions. Bungie does not expose every historical contest state consistently, so contest results should be treated as best-effort.
- History scanning is paginated; the UI defaults to 3 pages per character/mode for speed. Increase "Max history pages" to search older clears at the cost of more API calls.
