# Personal MCP

A small Effect-native MCP server for personal tools. It runs over stdio on Bun
and currently exposes one tool: `search_google_maps`.

## Setup

```sh
bun install
export GOOGLE_MAPS_API_KEY="..."
```

The key must have the Google Places API (New) enabled.

## MCP client configuration

```json
{
  "mcpServers": {
    "personal": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/personal-mcp/src/main.ts"
      ],
      "env": {
        "GOOGLE_MAPS_API_KEY": "..."
      }
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
