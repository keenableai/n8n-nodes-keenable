# Publishing n8n-nodes-keenable

Standalone n8n community node → npm. n8n discovers it from npm by the
`n8n-community-node-package` keyword; users install by package name from the
in-app Community nodes screen. Unlike the Pi package, n8n loads **compiled
JS**, so a build step is required.

## Prerequisites

- Node.js 18+ (global `fetch`).
- npm auth to publish `n8n-nodes-keenable` (unscoped public package).
- Optional: a local n8n instance for the install smoke test.

## Pre-publish checks

```bash
npm install
npm run check                 # tsc --noEmit (type-check; must exit 0)
npm run build                 # tsc → dist/*.js + copies the SVG icon
npm pack --dry-run            # published contents must be exactly dist/ + manifest
```

The published tarball ships only `dist/` (compiled JS + `.d.ts` + the icon) plus
`package.json`, `README.md`, `LICENSE`.

## Local smoke test (do before announcing)

```bash
npm run build
# In your n8n data dir (~/.n8n):
mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install /path/to/keenable-integrations/n8n/node
# restart n8n, add the "Keenable" node, run Search + Fetch (keyless),
# then attach a Keenable API credential and re-run.
```

Verify both operations keyless, then keyed; confirm the node also appears as a
tool under the AI Agent node.

## Publish

```bash
npm publish --access public
```

## Verified-node submission (after npm publish)

For one-click install on n8n Cloud, submit the package to n8n's verified-node
program per <https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/>.
Requirements include a public source repo, the linter (`@n8n/eslint-config`)
passing, and the docs/structure conventions. Gated on making the source repo
public (shared blocker with the MCP registries).
