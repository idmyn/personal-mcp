# Personal MCP

A small Effect-native MCP server for personal tools. It serves Streamable HTTP
on Bun and exposes `search_google_maps` and `fetch_arena_blocks`.

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

## Are.na blocks

Configure the collection (called a channel in Are.na) on the server:

```sh
export ARENA_CHANNEL="your-channel-slug" # Or a numeric channel ID, not a full URL
export ARENA_ACCESS_TOKEN="..." # Optional; required for private channels
bun run start
```

For a URL like `https://www.are.na/username/reading-list`, use `reading-list`.
Public and closed channels can be read without a token. For private channels,
create a [personal access token](https://www.are.na/settings/personal-access-tokens)
with read access using an account that can view the channel. Configuration is
checked when the tool is called, so either tool can be used independently.

Call `fetch_arena_blocks` with `{}` or pagination arguments:

```json
{ "page": 2, "per": 24 }
```

The tool uses the [Are.na v3 channel contents API](https://www.are.na/developers/explore/channel/contents).
It fetches one page per call (default page 1, 24 items; maximum 100). Results
include block IDs, types, Are.na URLs, Markdown content/descriptions, and available
source, image, attachment, and embed URLs. Follow `nextPage` until it is `null`
when more results are needed. Nested channels are excluded, not traversed;
pagination and `totalItems` count all channel contents, so a page can have no
blocks and still have a next page. Ordering uses the API default, `position_desc`.

## Verify

```sh
bun run typecheck
bun test
```
