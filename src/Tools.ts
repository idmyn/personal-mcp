import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
import { Arena, ArenaError, ArenaFetchInput, ArenaFetchResult } from "./Arena";
import {
  GoogleMaps,
  GoogleMapsError,
  GoogleMapsSearchResult,
} from "./GoogleMaps";

export const SearchGoogleMaps = Tool.make("search_google_maps", {
  description:
    "Search Google Maps for places, optionally biased toward a city or area",
  parameters: Schema.Struct({
    query: Schema.String,
    location: Schema.optional(Schema.String),
    includeReviews: Schema.optional(Schema.Boolean),
  }),
  success: GoogleMapsSearchResult,
  failure: GoogleMapsError,
  dependencies: [GoogleMaps],
});

export const FetchArenaBlocks = Tool.make("fetch_arena_blocks", {
  description:
    "Fetch one page of blocks from the Are.na channel configured by ARENA_CHANNEL. Optional page (default 1) and per (default 24, max 100). Nested channels are excluded; totalItems counts all channel contents. Use nextPage to fetch more, even if blocks is empty; null means the last page.",
  parameters: ArenaFetchInput,
  success: ArenaFetchResult,
  failure: ArenaError,
  dependencies: [Arena],
});

export const Tools = Toolkit.make(SearchGoogleMaps, FetchArenaBlocks);

export const ToolsLive = Tools.toLayer({
  fetch_arena_blocks: (input) =>
    Effect.gen(function* () {
      const arena = yield* Arena;
      return yield* arena.fetchBlocks(input);
    }),
  search_google_maps: (input) =>
    Effect.gen(function* () {
      const googleMaps = yield* GoogleMaps;
      return yield* googleMaps.search(input);
    }),
});
