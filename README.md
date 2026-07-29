# It Just Fitz — website

The deployed source for [itjustfitz.com](https://itjustfitz.com) — the site for an AI
consulting and web presence practice serving small businesses in the Greater
Philadelphia area.

Hand-authored HTML, CSS, and vanilla JavaScript. No framework, no build step, no
package manifest. Hosted on Cloudflare Pages.

## Contents

| Path | Purpose |
|---|---|
| `index.html` | Redirect to the landing page |
| `itjustfitz-puzzle.html` | The landing page |
| `dashboard.html` | Admin surface (authentication required) |
| `portal.html` | Client project portal (access code required) |
| `assets/app-config.js` | Public browser configuration |
| `assets/puzzle.js` | Interlocking puzzle-piece section borders |

## Running locally

```bash
python -m http.server 8080
# then open http://localhost:8080/itjustfitz-puzzle.html
```

## Note on configuration

`assets/app-config.js` contains only values that are safe in a browser: the Supabase
project URL, the anon key (constrained by row-level security policies), and the Edge
Function base URL. API keys and the service-role key are held server-side as Supabase
Edge Function secrets and never appear in this repo.

## Contributing

This is a deploy target, generated from a private repository — pull requests against
it cannot be merged upstream. Bug reports are welcome via Issues.
