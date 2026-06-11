// scripts/sync-docs.mjs
//
// Pulls web/docs/*.md from the canonical pimidi code repo and writes
// them into src/content/docs/ as Starlight-compatible files (with
// the `title` + `sidebar.order` frontmatter Starlight expects).
//
// Source of truth: github.com/thepackrat/pimidi @ main, web/docs/.
// Reads web/docs/index.json to drive sidebar order; that file already
// represents the canonical order the daemon shows users in the SPA's
// help menu, so the public website ordering matches one-for-one.
//
// Runs as `npm run sync-docs` (also wired as a pre-hook on dev/build
// in package.json), so a fresh clone + `npm install && npm run dev`
// works end-to-end without any extra setup.
//
// Override the source via env vars if you want to point at a fork or
// a branch:
//   PIMIDI_REPO=myfork/pimidi PIMIDI_REF=feature-branch npm run sync-docs
//
// No external deps — uses Node 18+'s global fetch.

import { mkdir, writeFile, readdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const docsOut = join(repoRoot, "src/content/docs");

// Minimal dotenv shim. Reads `.env` at repo root and merges into
// process.env without overriding existing values (so Cloudflare Pages
// env vars win over a stale local .env). Avoids adding the dotenv
// dep; the file format we accept is just KEY=value per line, with
// `#` comments and blank lines ignored.
async function loadDotEnv() {
  const path = join(repoRoot, ".env");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
await loadDotEnv();

const REPO = process.env.PIMIDI_REPO || "thepackrat/pimidi";
const REF = process.env.PIMIDI_REF || "main";

// Use the GitHub API rather than raw.githubusercontent.com. The
// raw endpoint works for public repos but has been inconsistent for
// private repos with fine-grained PATs; the contents API is the
// official path and handles auth reliably. With
// `Accept: application/vnd.github.raw` the response body IS the file
// content (no base64 unwrap step needed).
const API = `https://api.github.com/repos/${REPO}/contents/web/docs`;

// The pimidi code repo is currently private, so the API needs auth.
// Set PIMIDI_TOKEN (locally in .env or as a Cloudflare Pages env
// var) to a fine-grained PAT scoped to the pimidi repo with
// Contents: Read. If the repo ever goes public the token becomes
// optional and the API answers anonymously.
const TOKEN = process.env.PIMIDI_TOKEN || process.env.GH_TOKEN || "";
const baseHeaders = {
  "User-Agent": "pimidi-site-sync",
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

function diagnoseError(url, status, statusText) {
  if (status === 404 && !TOKEN) {
    return new Error(
      `fetch ${url}: 404 — repo is private (or path missing). Set PIMIDI_TOKEN to a fine-grained PAT with Contents: Read on ${REPO}.`,
    );
  }
  if (status === 404 && TOKEN) {
    return new Error(
      `fetch ${url}: 404 with PIMIDI_TOKEN set. Token may be missing Contents:Read on ${REPO}, scoped to the wrong repo, or expired. Verify at https://github.com/settings/tokens.`,
    );
  }
  if (status === 401) {
    return new Error(
      `fetch ${url}: 401 — PIMIDI_TOKEN is rejected by GitHub (invalid / expired / revoked).`,
    );
  }
  if (status === 403) {
    return new Error(
      `fetch ${url}: 403 — token authenticated but lacks permission, or rate-limited. Check the PAT's repo permissions.`,
    );
  }
  return new Error(`fetch ${url}: ${status} ${statusText}`);
}

// Both helpers ask for the raw file body via Accept:
// application/vnd.github.raw — the contents API otherwise wraps the
// payload in a metadata envelope with base64-encoded content. For
// our use both index.json and the .md files are themselves the
// content we want, so raw is what we always need.
async function getText(url) {
  const res = await fetch(url, {
    headers: { ...baseHeaders, Accept: "application/vnd.github.raw" },
  });
  if (!res.ok) throw diagnoseError(url, res.status, res.statusText);
  return await res.text();
}

async function getJSON(url) {
  const text = await getText(url);
  return JSON.parse(text);
}

// Slug → kebab-case file basename (just strip an optional .md).
function slugify(s) {
  return s.replace(/\.md$/i, "").trim();
}

// Strip the leading `# Title` line from the original markdown. Starlight
// shows the title from frontmatter at the top of the page, so leaving
// the H1 in the body would duplicate it visually.
function stripLeadingH1(md) {
  return md.replace(/^#\s+.+\n+/, "");
}

async function main() {
  console.log(`[sync-docs] source: ${REPO}@${REF} (api.github.com)`);
  console.log(
    `[sync-docs] auth: ${TOKEN ? `PIMIDI_TOKEN present (len=${TOKEN.length})` : "anonymous"}`,
  );

  await mkdir(docsOut, { recursive: true });

  // Clear any previously-synced .md files so a doc removed upstream
  // also disappears from the site. Preserves index.mdx (the marketing
  // landing) and anything else non-.md the user has hand-authored.
  const existing = await readdir(docsOut);
  await Promise.all(
    existing
      .filter((f) => f.endsWith(".md") || f === "_sidebar.json")
      .map((f) => rm(join(docsOut, f), { force: true })),
  );

  const index = await getJSON(`${API}/index.json?ref=${REF}`);
  if (!Array.isArray(index.topics) || index.topics.length === 0) {
    throw new Error("source index.json has no topics");
  }

  const sidebarItems = [];

  for (let i = 0; i < index.topics.length; i++) {
    const topic = index.topics[i];
    const slug = slugify(topic.slug);
    const order = i + 1;
    const title = topic.title || slug;

    const mdUrl = `${API}/${slug}.md?ref=${REF}`;
    const raw = await getText(mdUrl);
    const body = stripLeadingH1(raw);

    const frontmatter = [
      "---",
      `title: ${JSON.stringify(title)}`,
      "sidebar:",
      `  order: ${order}`,
      "---",
      "",
    ].join("\n");

    const out = join(docsOut, `${slug}.md`);
    await writeFile(out, frontmatter + body);
    // Sidebar slug = entry slug, which for a file at
    // src/content/docs/<name>.md is just <name>. (Would only carry a
    // path prefix if we nested the docs under src/content/docs/<dir>/,
    // which we don't; flat is fine for the doc count we have.)
    sidebarItems.push({ label: title, slug });
    console.log(`[sync-docs]   wrote ${slug}.md  (${title})`);
  }

  await writeFile(
    join(docsOut, "_sidebar.json"),
    JSON.stringify(sidebarItems, null, 2),
  );
  console.log(`[sync-docs] done — ${index.topics.length} files`);
}

main().catch((err) => {
  console.error("[sync-docs] failed:", err);
  process.exit(1);
});
