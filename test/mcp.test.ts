import { expect, test } from "bun:test";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Effect, Stream } from "effect";
import { Tool } from "effect/unstable/ai";
import { GoogleMaps } from "../src/GoogleMaps";
import { SearchGoogleMaps, Tools, ToolsLive } from "../src/Tools";

test("tool handler uses the injected Google Maps service", async () => {
  const searches: unknown[] = [];
  const results = await Effect.gen(function* () {
    const tools = yield* Tools;
    return yield* Stream.runCollect(
      Stream.unwrap(
        tools.handle("search_google_maps", {
          query: "coffee",
          location: "London",
          includeReviews: true,
        }),
      ),
    );
  }).pipe(
    Effect.provide(ToolsLive),
    Effect.provideService(GoogleMaps, {
      search: (input) =>
        Effect.sync(() => {
          searches.push(input);
          return {
            places: [
              {
                name: "Prufrock Coffee",
                address: "23-25 Leather Lane, London",
                rating: 4.6,
                reviews: [{ author: "Ada", rating: 5, text: "Excellent" }],
              },
            ],
          };
        }),
    }),
    Effect.runPromise,
  );

  expect(searches).toEqual([
    { query: "coffee", location: "London", includeReviews: true },
  ]);
  expect(results.at(-1)?.encodedResult).toEqual({
    places: [
      {
        name: "Prufrock Coffee",
        address: "23-25 Leather Lane, London",
        rating: 4.6,
        reviews: [{ author: "Ada", rating: 5, text: "Excellent" }],
      },
    ],
  });
});

test("stdio client discovers and validates search_google_maps", async () => {
  const child = Bun.spawn([process.execPath, "run", "src/main.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, GOOGLE_MAPS_API_KEY: "" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill(), 8_000);
  const stderr = new Response(child.stderr).text();
  const lines = createInterface({ input: Readable.from(child.stdout) });
  const messages = lines[Symbol.asyncIterator]();
  let id = 0;

  const send = (message: object) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    child.stdin.flush();
  };
  const request = async (method: string, params: object) => {
    const requestId = ++id;
    send({ id: requestId, method, params });
    while (true) {
      const line = await messages.next();
      if (line.done) throw new Error(`Server closed stdout: ${await stderr}`);
      const message = JSON.parse(line.value);
      expect(message.jsonrpc).toBe("2.0");
      if (message.id === requestId) return message;
      expect(message.id).toBeUndefined();
    }
  };

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "personal-mcp-test", version: "0.0.1" },
    });
    expect(initialized.error).toBeUndefined();
    expect(initialized.result.protocolVersion).toBe("2025-11-25");
    expect(initialized.result.serverInfo).toMatchObject({
      name: "personal",
      version: "0.0.1",
    });
    send({ method: "notifications/initialized" });

    const listed = await request("tools/list", {});
    expect(listed.error).toBeUndefined();
    expect(listed.result.tools).toHaveLength(1);
    const tool = listed.result.tools[0];
    expect(tool.name).toBe("search_google_maps");
    expect(tool.inputSchema).toEqual(Tool.getJsonSchema(SearchGoogleMaps));
    expect(tool.outputSchema).toEqual(
      Tool.getJsonSchemaFromSchema(SearchGoogleMaps.successSchema),
    );
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      properties: {
        query: { type: "string" },
        location: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        includeReviews: {
          anyOf: [{ type: "boolean" }, { type: "null" }],
        },
      },
      required: ["query"],
    });

    const missingKey = await request("tools/call", {
      name: "search_google_maps",
      arguments: { query: "coffee" },
    });
    expect(missingKey.error).toBeUndefined();
    expect(missingKey.result.isError).toBe(true);

    for (const args of [{ query: 42 }, {}]) {
      const invalid = await request("tools/call", {
        name: "search_google_maps",
        arguments: args,
      });
      expect(invalid.error).toBeUndefined();
      expect(invalid.result.isError).toBe(true);
      expect(invalid.result.structuredContent).toBeUndefined();
    }
  } finally {
    clearTimeout(deadline);
    child.stdin.end();
    child.kill();
    await child.exited;
    lines.close();
    await stderr;
  }
}, 10_000);
