import { Context, Effect, Layer, Predicate, Record, Schedule, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

const BASE_FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.priceLevel",
  "places.editorialSummary",
  "places.currentOpeningHours",
];

const GooglePlaceResponse = Schema.Struct({
  places: Schema.optional(
    Schema.Array(
      Schema.Struct({
        displayName: Schema.optional(Schema.Struct({ text: Schema.String })),
        formattedAddress: Schema.optional(Schema.String),
        location: Schema.optional(
          Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number }),
        ),
        rating: Schema.optional(Schema.Number),
        userRatingCount: Schema.optional(Schema.Number),
        websiteUri: Schema.optional(Schema.String),
        googleMapsUri: Schema.optional(Schema.String),
        priceLevel: Schema.optional(Schema.String),
        editorialSummary: Schema.optional(Schema.Struct({ text: Schema.String })),
        currentOpeningHours: Schema.optional(
          Schema.Struct({
            weekdayDescriptions: Schema.optional(Schema.Array(Schema.String)),
          }),
        ),
        reviews: Schema.optional(
          Schema.Array(
            Schema.Struct({
              authorAttribution: Schema.optional(
                Schema.Struct({ displayName: Schema.String }),
              ),
              rating: Schema.optional(Schema.Number),
              relativePublishTimeDescription: Schema.optional(Schema.String),
              text: Schema.optional(Schema.Struct({ text: Schema.String })),
            }),
          ),
        ),
      }),
    ),
  ),
});

const LocationResponse = Schema.Struct({
  places: Schema.optional(
    Schema.Array(
      Schema.Struct({
        location: Schema.optional(
          Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number }),
        ),
      }),
    ),
  ),
});

export const GoogleMapsReview = Schema.Struct({
  author: Schema.optional(Schema.String),
  rating: Schema.optional(Schema.Number),
  relativePublishTime: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});

export const GoogleMapsPlace = Schema.Struct({
  name: Schema.String,
  address: Schema.optional(Schema.String),
  location: Schema.optional(
    Schema.Struct({ latitude: Schema.Number, longitude: Schema.Number }),
  ),
  rating: Schema.optional(Schema.Number),
  userRatingCount: Schema.optional(Schema.Number),
  priceLevel: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  websiteUrl: Schema.optional(Schema.String),
  googleMapsUrl: Schema.optional(Schema.String),
  openingHours: Schema.optional(Schema.Array(Schema.String)),
  reviews: Schema.optional(Schema.Array(GoogleMapsReview)),
});

export const GoogleMapsSearchResult = Schema.Struct({
  places: Schema.Array(GoogleMapsPlace),
});

export type GoogleMapsSearchResult = typeof GoogleMapsSearchResult.Type;

export interface GoogleMapsSearchInput {
  readonly query: string;
  readonly location?: string | undefined;
  readonly includeReviews?: boolean | undefined;
}

export class GoogleMapsError extends Schema.TaggedError<GoogleMapsError>()(
  "GoogleMapsError",
  { message: Schema.String },
) {}

export class GoogleMaps extends Context.Service<
  GoogleMaps,
  {
    readonly search: (
      input: GoogleMapsSearchInput,
    ) => Effect.Effect<GoogleMapsSearchResult, GoogleMapsError>;
  }
>()("personal/GoogleMaps") {}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const omitUndefined = <T extends Record<string, unknown>>(fields: T): Partial<T> =>
  Record.filter(fields, Predicate.isNotUndefined) as Partial<T>;

export const GoogleMapsLive = Layer.effect(
  GoogleMaps,
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.tap(Effect.fn("GoogleMaps.logFailedResponse")(function* (response) {
        if (response.status >= 200 && response.status < 300) return;
        const body = yield* response.text.pipe(
          Effect.timeout("1 second"),
          Effect.catch(() => Effect.succeed("[response body unavailable]")),
        );
        const apiKey = response.request.headers["x-goog-api-key"];
        const redactedBody = apiKey ? body.replaceAll(apiKey, "[REDACTED]") : body;
        yield* Effect.logWarning("Google Maps HTTP request failed", {
          stage: response.request.headers["x-goog-fieldmask"] === "places.location"
            ? "geocode" : "search",
          status: response.status,
          retryAfter: response.headers["retry-after"],
          contentType: response.headers["content-type"],
          body: redactedBody.slice(0, 2048),
          bodyTruncated: redactedBody.length > 2048,
        });
      })),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        retryOn: "errors-only",
        times: 2,
        schedule: Schedule.exponential("500 millis"),
      }),
    );

    const search = Effect.fn("GoogleMaps.search")(function* (
      input: GoogleMapsSearchInput,
    ) {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return yield* new GoogleMapsError({
          message: "GOOGLE_MAPS_API_KEY environment variable is required",
        });
      }

      const headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
      };
      const body: Record<string, unknown> = { textQuery: input.query };

      if (input.location) {
        const geocoded = yield* HttpClientRequest.post(PLACES_URL).pipe(
          HttpClientRequest.setHeaders({
            ...headers,
            "X-Goog-FieldMask": "places.location",
          }),
          HttpClientRequest.bodyJsonUnsafe({
            textQuery: input.location,
            maxResultCount: 1,
          }),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(LocationResponse)),
          Effect.mapError(
            (error) =>
              new GoogleMapsError({
                message: `Could not geocode location: ${errorMessage(error)}`,
              }),
          ),
        );
        const location = geocoded.places?.[0]?.location;
        if (!location) {
          return yield* new GoogleMapsError({
            message: `Could not geocode "${input.location}"`,
          });
        }
        body.locationBias = {
          circle: { center: location, radius: 10_000 },
        };
      }

      const includeReviews = input.includeReviews ?? false;
      const response = yield* HttpClientRequest.post(PLACES_URL).pipe(
        HttpClientRequest.setHeaders({
          ...headers,
          "X-Goog-FieldMask": [
            ...BASE_FIELDS,
            ...(includeReviews ? ["places.reviews"] : []),
          ].join(","),
        }),
        HttpClientRequest.bodyJsonUnsafe(body),
        client.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GooglePlaceResponse)),
        Effect.mapError(
          (error) =>
            new GoogleMapsError({
              message: `Google Maps API request failed: ${errorMessage(error)}`,
            }),
        ),
      );

      return {
        places: (response.places ?? []).map((place) => ({
          name: place.displayName?.text ?? "Unknown",
          ...omitUndefined({
            address: place.formattedAddress,
            location: place.location,
            rating: place.rating,
            userRatingCount: place.userRatingCount,
            priceLevel: place.priceLevel,
            summary: place.editorialSummary?.text,
            websiteUrl: place.websiteUri,
            googleMapsUrl: place.googleMapsUri,
            openingHours: place.currentOpeningHours?.weekdayDescriptions,
            reviews: includeReviews
              ? (place.reviews ?? []).map((review) => omitUndefined({
                  author: review.authorAttribution?.displayName,
                  rating: review.rating,
                  relativePublishTime: review.relativePublishTimeDescription,
                  text: review.text?.text,
                }))
              : undefined,
          }),
        })),
      };
    });

    return GoogleMaps.of({ search });
  }),
);
