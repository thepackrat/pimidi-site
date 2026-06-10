# pimidi-site

Marketing + docs site for [pimidi](https://github.com/thepackrat/pimidi),
the touchscreen MIDI patchbay. Deployed via Cloudflare Pages from
`main`.

## Architecture

- **Code repo** (`thepackrat/pimidi`) — canonical source for everything,
  including the help docs at `web/docs/*.md`.
- **Site repo** (this one) — Astro + Starlight scaffold for the public
  site. Pulls the docs from the code repo at build time so they stay
  single-sourced; the daemon-served help and the public docs come
  from the same files.

Permissions on the two repos can move independently — engineering
keeps commit on the code repo, marketing / web / docs writers commit
here, no overlap required.

## Local development

Requires Node 18+.

The pimidi code repo is currently private, so the sync script needs a
GitHub Personal Access Token to fetch markdown. Create a fine-grained
PAT scoped to `thepackrat/pimidi` with **Contents: Read**, drop it in
`.env` (gitignored):

```sh
echo 'PIMIDI_TOKEN=ghp_…' > .env
```

then run:

```sh
npm install
npm run dev          # opens http://localhost:4321
```

`npm run dev` runs `sync-docs` first, which fetches `web/docs/*.md`
from `thepackrat/pimidi@main`, drops them into `src/content/docs/`,
and writes a `_sidebar.json` that drives Starlight's nav in the same
order as the SPA's help menu. If the code repo ever goes public the
token becomes optional.

Override the source while iterating on a feature branch:

```sh
PIMIDI_REPO=myfork/pimidi PIMIDI_REF=feature-branch npm run sync-docs
```

## Build

```sh
npm run build        # writes static output to dist/
npm run preview      # serves dist/ for a final sanity check
```

## Deploy (Cloudflare Pages)

- Connect this repo to a Cloudflare Pages project.
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables:
  - `NODE_VERSION=20`
  - `PIMIDI_TOKEN=…` (the fine-grained PAT with `Contents: Read` on
    `thepackrat/pimidi`)
- Production branch: `main`

After the first deploy, point your custom domain (e.g. `pimidi.dev`)
at the Pages project from the Cloudflare dashboard.

## Auto-rebuild on doc changes (optional polish)

Add a GitHub Action in `thepackrat/pimidi` that fires a
`repository_dispatch` event to `thepackrat/pimidi-site` whenever
files under `web/docs/**` change on `main`. The site repo's Action
then triggers Cloudflare Pages to rebuild. Without this, the site
only rebuilds on pushes to this repo.

## Repo layout

```
.
├── astro.config.mjs       # Starlight integration, sidebar wiring
├── package.json
├── scripts/
│   └── sync-docs.mjs      # pulls web/docs/*.md from the code repo
├── src/
│   ├── assets/            # static assets (logo, etc.)
│   ├── content/
│   │   ├── config.ts      # Starlight collection schema
│   │   └── docs/
│   │       ├── index.mdx  # marketing landing (committed)
│   │       └── *.md       # synced from code repo, gitignored
│   └── styles/
│       └── custom.css     # accent colour + small theme tweaks
└── public/                # files served verbatim (screenshots, etc.)
```

The marketing landing page lives at `src/content/docs/index.mdx` and
the rest of the docs land alongside it after `sync-docs` runs.
Starlight renders the landing using its `splash` template (hero +
feature cards); the synced docs render as a standard docs collection
with a sidebar.
