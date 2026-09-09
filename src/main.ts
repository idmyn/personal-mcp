import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Layer } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import { ArenaLive } from "./Arena";
import { GoogleMapsLive } from "./GoogleMaps";
import { Tools, ToolsLive } from "./Tools";

export const McpHttpRoutes = McpServer.toolkit(Tools).pipe(
  Layer.provide(ToolsLive),
  Layer.provide(ArenaLive),
  Layer.provide(GoogleMapsLive),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    McpServer.layerHttp({
      name: "personal",
      version: "0.0.1",
      path: "/mcp",
      protocols: [McpProtocol.v2025_11_25],
    }),
  ),
);

const AppLive = HttpRouter.serve(McpHttpRoutes).pipe(
  Layer.provide(
    BunHttpServer.layer({
      hostname: "127.0.0.1",
      port: Number(process.env.PORT ?? "3000"),
    }),
  ),
);

if (import.meta.main) {
  BunRuntime.runMain(Layer.launch(AppLive));
}
