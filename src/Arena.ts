import { Context, Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export const ArenaFetchInput = Schema.Struct({
  page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  per: Schema.optional(Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(100),
  )),
});

const Markdown = Schema.Struct({ markdown: Schema.String });
const ArenaContent = Schema.Struct({
  id: Schema.Int,
  base_type: Schema.Literals(["Block", "Channel"]),
  type: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Markdown)),
  content: Schema.optional(Schema.NullOr(Markdown)),
  source: Schema.optional(Schema.NullOr(Schema.Struct({ url: Schema.String }))),
  image: Schema.optional(Schema.NullOr(Schema.Struct({ src: Schema.String }))),
  attachment: Schema.optional(Schema.NullOr(Schema.Struct({ url: Schema.String }))),
  embed: Schema.optional(Schema.NullOr(Schema.Struct({
    url: Schema.optional(Schema.NullOr(Schema.String)),
  }))),
});

const ArenaResponse = Schema.Struct({
  data: Schema.Array(ArenaContent),
  meta: Schema.Struct({
    current_page: Schema.Int,
    next_page: Schema.NullOr(Schema.Int),
    per_page: Schema.Int,
    total_pages: Schema.Int,
    total_count: Schema.Int,
  }),
});

export const ArenaFetchResult = Schema.Struct({
  channel: Schema.String,
  blocks: Schema.Array(Schema.Struct({
    id: Schema.Int,
    type: Schema.String,
    title: Schema.optional(Schema.String),
    url: Schema.String,
    description: Schema.optional(Schema.String),
    content: Schema.optional(Schema.String),
    sourceUrl: Schema.optional(Schema.String),
    imageUrl: Schema.optional(Schema.String),
    attachmentUrl: Schema.optional(Schema.String),
    embedUrl: Schema.optional(Schema.String),
  })),
  page: Schema.Int,
  nextPage: Schema.NullOr(Schema.Int),
  per: Schema.Int,
  totalPages: Schema.Int,
  totalItems: Schema.Int,
});

export class ArenaError extends Schema.TaggedError<ArenaError>()(
  "ArenaError",
  { message: Schema.String },
) {}

export class Arena extends Context.Service<Arena, {
  readonly fetchBlocks: (input: typeof ArenaFetchInput.Type) =>
    Effect.Effect<typeof ArenaFetchResult.Type, ArenaError>;
}>()("personal/Arena") {}

export const ArenaLive = Layer.effect(Arena, Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const fetchBlocks = Effect.fn("Arena.fetchBlocks")(function* (input: typeof ArenaFetchInput.Type) {
    const channel = process.env.ARENA_CHANNEL?.trim();
    if (!channel) {
      return yield* new ArenaError({ message: "ARENA_CHANNEL environment variable is required (channel ID or slug)" });
    }
    const params = yield* Schema.decodeUnknownEffect(ArenaFetchInput)(input).pipe(
      Effect.mapError(() => new ArenaError({ message: "page must be a positive integer; per must be an integer from 1 to 100" })),
    );
    const token = process.env.ARENA_ACCESS_TOKEN?.trim();
    const response = yield* HttpClientRequest.get(
      `https://api.are.na/v3/channels/${encodeURIComponent(channel)}/contents`,
    ).pipe(
      HttpClientRequest.setUrlParams({ page: params.page ?? 1, per: params.per ?? 24 }),
      HttpClientRequest.setHeaders(token ? { Authorization: `Bearer ${token}` } : {}),
      client.execute,
      Effect.mapError(() => new ArenaError({ message: "Could not reach the Are.na API" })),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* new ArenaError({ message: `Are.na API request failed (HTTP ${response.status})` });
    }
    const result = yield* HttpClientResponse.schemaBodyJson(ArenaResponse)(response).pipe(
      Effect.mapError(() => new ArenaError({ message: "Are.na API returned an invalid response" })),
    );
    return {
      channel,
      blocks: result.data.filter((item) => item.base_type === "Block").map((block) => ({
        id: block.id,
        type: block.type,
        ...(block.title != null ? { title: block.title } : {}),
        url: `https://www.are.na/block/${block.id}`,
        ...(block.description ? { description: block.description.markdown } : {}),
        ...(block.content ? { content: block.content.markdown } : {}),
        ...(block.source ? { sourceUrl: block.source.url } : {}),
        ...(block.image ? { imageUrl: block.image.src } : {}),
        ...(block.attachment ? { attachmentUrl: block.attachment.url } : {}),
        ...(block.embed?.url != null ? { embedUrl: block.embed.url } : {}),
      })),
      page: result.meta.current_page,
      nextPage: result.meta.next_page,
      per: result.meta.per_page,
      totalPages: result.meta.total_pages,
      totalItems: result.meta.total_count,
    };
  });
  return Arena.of({ fetchBlocks });
}));
