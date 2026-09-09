import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";
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

export const Tools = Toolkit.make(SearchGoogleMaps);

export const ToolsLive = Tools.toLayer({
  search_google_maps: (input) =>
    Effect.gen(function* () {
      const googleMaps = yield* GoogleMaps;
      return yield* googleMaps.search(input);
    }),
});
