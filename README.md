# Personal MCP

A small Effect-native MCP server for personal tools. It serves Streamable HTTP
on Bun and currently exposes one tool: `search_google_maps`.

## Setup

```sh
bun install
export GOOGLE_MAPS_API_KEY="..."
bun run start
```

The key must have the Google Places API (New) enabled.
The MCP endpoint is `http://127.0.0.1:3000/mcp`. Set `PORT` to use a different
port; the server intentionally binds only to the local machine.

## MCP client configuration

```json
{
  "mcpServers": {
    "personal": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Call `search_google_maps` with a search query and, optionally, a location bias
and reviews:

```json
{
  "query": "coffee",
  "location": "London",
  "includeReviews": true
}
```

## Verify

```sh
bun run typecheck
bun test
```
