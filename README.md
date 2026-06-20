# n8n-nodes-keenable

[Keenable](https://keenable.ai) web search and page fetch for [n8n](https://n8n.io).
**Keyless by default** (1,000 requests/hour); add an API key to raise the limits.

This is an [n8n community node](https://docs.n8n.io/integrations/community-nodes/).
It can be used as a normal workflow node and as a **tool for the n8n AI Agent**.

## Operations

| Operation | What it does | Keenable tool |
|---|---|---|
| **Search** | Search the web for pages matching a query. Returns one item per result (`title`, `url`, `description`, `published_at`, …). Optional `site` / published-date filters. | `search_web_pages` |
| **Fetch Page** | Fetch a URL and extract clean, readable content (`content`, `title`, `author`, …). | `fetch_page_content` |

## Installation

Self-hosted n8n → **Settings → Community nodes → Install** and enter:

```
n8n-nodes-keenable
```

Or via CLI in your n8n data folder: `npm install n8n-nodes-keenable`.

## Credentials (optional)

The node works with no credential at all (keyless public tier). To raise the
limits or use the `realtime` search mode, create a **Keenable API** credential:

- **API Key** — get one at <https://keenable.ai/console>.
- **Base URL** — leave as `https://api.keenable.ai` unless self-hosting.

When no credential is attached (or the key is blank), the node calls the
public, keyless endpoints. A `429` on the keyless tier returns an actionable
hint to add a key.

## Compatibility

- Requires Node.js 18+ (uses the global `fetch`).
- Built against the n8n community-node API version 1.

## Resources

- [Keenable docs](https://docs.keenable.ai/mcp-server)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](./LICENSE)
