import { afterEach, beforeEach, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { ArenaLive } from "../src/Arena";
import { GoogleMaps } from "../src/GoogleMaps";
import { Tools, ToolsLive } from "../src/Tools";

let oldChannel: string | undefined;
let oldToken: string | undefined;
beforeEach(() => {
  oldChannel = process.env.ARENA_CHANNEL;
  oldToken = process.env.ARENA_ACCESS_TOKEN;
  process.env.ARENA_CHANNEL = "test-channel";
  delete process.env.ARENA_ACCESS_TOKEN;
});
afterEach(() => {
  if (oldChannel === undefined) delete process.env.ARENA_CHANNEL;
  else process.env.ARENA_CHANNEL = oldChannel;
  if (oldToken === undefined) delete process.env.ARENA_ACCESS_TOKEN;
  else process.env.ARENA_ACCESS_TOKEN = oldToken;
});

const meta = { current_page: 2, next_page: 3, per_page: 6, total_pages: 4, total_count: 23 };
const runTool = (client: HttpClient.HttpClient, input = {}) => Effect.gen(function* () {
  const tools = yield* Tools;
  const results = yield* Stream.runCollect(Stream.unwrap(tools.handle("fetch_arena_blocks", input)));
  return results.at(-1)?.encodedResult;
}).pipe(
  Effect.provide(ToolsLive),
  Effect.provide(ArenaLive),
  Effect.provideService(HttpClient.HttpClient, client),
  Effect.provideService(GoogleMaps, { search: () => Effect.die("Unexpected Maps call") }),
  Effect.runPromise,
);

test("fetches only the requested page and maps all block types, excluding channels", async () => {
  process.env.ARENA_CHANNEL = "my/channel?";
  process.env.ARENA_ACCESS_TOKEN = "secret";
  const urls: string[] = [];
  const client = HttpClient.make((request, url) => {
    urls.push(url.toString());
    expect(request.method).toBe("GET");
    expect(request.headers.authorization).toBe("Bearer secret");
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({
      meta,
      data: [
        { id: 10, base_type: "Channel", type: "Channel", title: "Nested" },
        { id: 11, base_type: "Block", type: "Text", title: null, content: { markdown: "**Note**" }, description: null },
        { id: 12, base_type: "Block", type: "Link", title: "Article", source: { url: "https://example.com/article" }, description: { markdown: "Caption" } },
        { id: 13, base_type: "Block", type: "Image", image: { src: "https://example.com/image.jpg" } },
        { id: 14, base_type: "Block", type: "Attachment", attachment: { url: "https://example.com/file.pdf" } },
        { id: 15, base_type: "Block", type: "Embed", embed: { url: "https://example.com/video" } },
      ],
    })));
  });
  const result = await runTool(client, { page: 2, per: 6 });
  expect(urls).toEqual(["https://api.are.na/v3/channels/my%2Fchannel%3F/contents?page=2&per=6"]);
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    channel: "my/channel?", page: 2, nextPage: 3, per: 6, totalPages: 4, totalItems: 23,
    blocks: [
      { id: 11, type: "Text", url: "https://www.are.na/block/11", content: "**Note**" },
      { id: 12, type: "Link", title: "Article", url: "https://www.are.na/block/12", sourceUrl: "https://example.com/article", description: "Caption" },
      { id: 13, type: "Image", url: "https://www.are.na/block/13", imageUrl: "https://example.com/image.jpg" },
      { id: 14, type: "Attachment", url: "https://www.are.na/block/14", attachmentUrl: "https://example.com/file.pdf" },
      { id: 15, type: "Embed", url: "https://www.are.na/block/15", embedUrl: "https://example.com/video" },
    ],
  });
});

test("defaults pagination, omits auth, and preserves pagination for channel-only pages", async () => {
  const client = HttpClient.make((request, url) => {
    expect(url.search).toBe("?page=1&per=24");
    expect(request.headers.authorization).toBeUndefined();
    return Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({
      data: [{ id: 9, base_type: "Channel", type: "Channel" }], meta,
    })));
  });
  expect(await runTool(client)).toMatchObject({ blocks: [], nextPage: 3, totalItems: 23 });
});

test("empty final page returns null nextPage", async () => {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request,
    Response.json({ data: [], meta: { ...meta, next_page: null } }),
  )));
  expect(await runTool(client, { per: 100 })).toMatchObject({ blocks: [], nextPage: null });
});

test("missing configuration fails without a request", async () => {
  delete process.env.ARENA_CHANNEL;
  const client = HttpClient.make(() => Effect.die("Unexpected request"));
  await expect(runTool(client)).rejects.toMatchObject({ _tag: "ArenaError", message: expect.stringContaining("ARENA_CHANNEL") });
});

test.each([401, 403, 404, 429, 500])("HTTP %s becomes a safe tool error", async (status) => {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request,
    new Response("private upstream details", { status }),
  )));
  await expect(runTool(client)).rejects.toMatchObject({ _tag: "ArenaError", message: `Are.na API request failed (HTTP ${status})` });
});

test.each(["not json", JSON.stringify({ data: [], meta: {} })])("invalid responses become tool errors", async (body) => {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body))));
  await expect(runTool(client)).rejects.toMatchObject({ _tag: "ArenaError", message: "Are.na API returned an invalid response" });
});

test.each([{ page: 0 }, { page: 1.5 }, { per: 0 }, { per: 101 }])("rejects invalid pagination %j", async (input) => {
  const client = HttpClient.make(() => Effect.die("Unexpected request"));
  await expect(runTool(client, input)).rejects.toThrow();
});
