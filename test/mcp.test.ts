import { expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { Tool } from "effect/unstable/ai";
import { HttpRouter } from "effect/unstable/http";
import { GoogleMaps } from "../src/GoogleMaps";
import { McpHttpRoutes } from "../src/main";
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

test("HTTP client discovers and validates search_google_maps", async () => {
  const { handler, dispose } = HttpRouter.toWebHandler(McpHttpRoutes, {
    disableLogger: true,
  });
  let id = 0;
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;

  const send = async (message: object) => {
    const headers = new Headers({
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    });
    if (sessionId) headers.set("Mcp-Session-Id", sessionId);
    if (protocolVersion) {
      headers.set("Mcp-Protocol-Version", protocolVersion);
    }

    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", ...message }),
      }),
    );
    sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId;
    protocolVersion =
      response.headers.get("Mcp-Protocol-Version") ?? protocolVersion;
    return response;
  };
  const request = async (method: string, params: object) => {
    const requestId = ++id;
    const response = await send({ id: requestId, method, params });
    expect(response.status).toBe(200);
    const message = await response.json();
    expect(message.jsonrpc).toBe("2.0");
    expect(message.id).toBe(requestId);
    return message;
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
    expect(sessionId).toBeString();
    expect(protocolVersion as string | null).toBe("2025-11-25");

    const notified = await send({ method: "notifications/initialized" });
    expect(notified.status).toBe(202);

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

    const getResponse = await handler(new Request("http://localhost/mcp"));
    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("Allow")).toBe("POST");
  } finally {
    await dispose();
  }
});
