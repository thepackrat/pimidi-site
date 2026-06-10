// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const sidebarPath = join(here, "src/content/docs/_sidebar.json");

// The sync-docs script writes a Starlight-shaped sidebar order to
// _sidebar.json based on web/docs/index.json from the code repo. If
// the sync hasn't run yet, fall back to autogenerate so `astro dev`
// still starts.
let sidebar;
if (existsSync(sidebarPath)) {
  sidebar = [
    {
      label: "Help",
      items: JSON.parse(readFileSync(sidebarPath, "utf8")),
    },
  ];
}

export default defineConfig({
  site: "https://pimidi.dev",
  integrations: [
    starlight({
      title: "pimidi",
      description:
        "A Raspberry Pi-based MIDI patchbay with a touchscreen web UI, native Network MIDI, multi-pimidi peering, looper/recorder, and routing snapshots.",
      logo: { src: "./src/assets/logo.svg", replacesTitle: false },
      social: {
        github: "https://github.com/thepackrat/pimidi",
      },
      sidebar,
      customCss: ["./src/styles/custom.css"],
      // Place the marketing landing page at /, push the docs under /docs/.
      pagination: true,
      lastUpdated: true,
    }),
  ],
});
