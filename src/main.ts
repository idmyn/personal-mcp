import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunStdio from "@effect/platform-bun/BunStdio";
import { Effect, Layer, Logger } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { FetchHttpClient } from "effect/unstable/http";
import { GoogleMapsLive } from "./GoogleMaps";
import { Tools, ToolsLive } from "./Tools";

const AppLive = McpServer.toolkit(Tools).pipe(
  Layer.provide(ToolsLive),
  Layer.provide(GoogleMapsLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    McpServer.layerStdio({
      name: "personal",
      version: "0.0.1",
      protocols: [McpProtocol.v2025_11_25],
    }),
  ),
  Layer.provide(BunStdio.layer),
);

// Keep stdout exclusively for MCP frames.
BunRuntime.runMain(
  Layer.launch(AppLive).pipe(
    Effect.provideService(Logger.LogToStderr, true),
  ),
);
