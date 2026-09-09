import { afterEach, beforeEach, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { McpSchema } from "effect/unstable/ai";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Arena } from "../src/Arena";
import { GoogleMaps, GoogleMapsLive } from "../src/GoogleMaps";
import { Tools, ToolsLive } from "../src/Tools";

let oldApiKey: string | undefined;
beforeEach(() => {
  oldApiKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});
afterEach(() => {
  if (oldApiKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = oldApiKey;
});

test.each([false, true])("Maps results are valid MCP JSON with includeReviews=%s", async (includeReviews) => {
  const client = HttpClient.make((request) => {
    expect(request.headers["x-goog-fieldmask"]?.includes("places.reviews")).toBe(includeReviews);
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({
      places: [
        {},
        {
          displayName: { text: "Coffee" },
          formattedAddress: "1 High Street",
          location: { latitude: 51.5, longitude: -0.1 },
          rating: 0,
          userRatingCount: 0,
          priceLevel: "PRICE_LEVEL_INEXPENSIVE",
          editorialSummary: { text: "" },
          websiteUri: "https://example.com",
          googleMapsUri: "https://maps.google.com/example",
          currentOpeningHours: { weekdayDescriptions: ["Monday: Closed"] },
          reviews: [
            {},
            { authorAttribution: { displayName: "Ada" }, rating: 0, relativePublishTimeDescription: "a day ago", text: { text: "" } },
          ],
        },
      ],
    })));
  });
  const result = await Effect.gen(function* () {
    const tools = yield* Tools;
    const results = yield* Stream.runCollect(Stream.unwrap(tools.handle(
      "search_google_maps", { query: "coffee", includeReviews },
    )));
    return results.at(-1)?.encodedResult;
  }).pipe(
    Effect.provide(ToolsLive),
    Effect.provide(GoogleMapsLive),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.provideService(Arena, { fetchBlocks: () => Effect.die("Unexpected Arena call") }),
    Effect.runPromise,
  );

  expect(() => new McpSchema.CallToolResult({ content: [], structuredContent: result })).not.toThrow();
  expect(result).toStrictEqual({
    places: [
      { name: "Unknown", ...(includeReviews ? { reviews: [] } : {}) },
      {
        name: "Coffee",
        address: "1 High Street",
        location: { latitude: 51.5, longitude: -0.1 },
        rating: 0,
        userRatingCount: 0,
        priceLevel: "PRICE_LEVEL_INEXPENSIVE",
        summary: "",
        websiteUrl: "https://example.com",
        googleMapsUrl: "https://maps.google.com/example",
        openingHours: ["Monday: Closed"],
        ...(includeReviews ? { reviews: [{}, { author: "Ada", rating: 0, relativePublishTime: "a day ago", text: "" }] } : {}),
      },
    ],
  });
});

test("retries geocoding and search independently after 503 responses", async () => {
  const attempts = { geocode: 0, search: 0 };
  const client = HttpClient.make((request) => Effect.sync(() => {
    const stage = request.headers["x-goog-fieldmask"] === "places.location" ? "geocode" : "search";
    attempts[stage]++;
    return HttpClientResponse.fromWeb(request, attempts[stage] === 1
      ? new Response("Unavailable", { status: 503 })
      : Response.json(stage === "geocode"
        ? { places: [{ location: { latitude: 51.5, longitude: -0.1 } }] }
        : { places: [{ displayName: { text: "Prufrock Coffee" } }] }));
  }));
  const result = await Effect.gen(function* () {
    const maps = yield* GoogleMaps;
    return yield* maps.search({ query: "Prufrock London", location: "London", includeReviews: false });
  }).pipe(
    Effect.provide(GoogleMapsLive),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  );
  expect(result).toStrictEqual({ places: [{ name: "Prufrock Coffee" }] });
  expect(attempts).toEqual({ geocode: 2, search: 2 });
});

test.each([400, 403, 503])("bounds retries for HTTP %s", async (status) => {
  let attempts = 0;
  const client = HttpClient.make((request) => Effect.sync(() => {
    attempts++;
    return HttpClientResponse.fromWeb(request, new Response("Failed", { status }));
  }));
  const result = Effect.gen(function* () {
    const maps = yield* GoogleMaps;
    return yield* maps.search({ query: "Prufrock London" });
  }).pipe(
    Effect.provide(GoogleMapsLive),
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.runPromise,
  );
  await expect(result).rejects.toMatchObject({
    _tag: "GoogleMapsError",
    message: expect.stringContaining(`(${status} POST`),
  });
  expect(attempts).toBe(status === 503 ? 3 : 1);
});
