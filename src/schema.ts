import { boolean, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const places = pgTable("places", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalName: text("canonical_name").notNull().unique(),
  locationText: text("location_text"),
  lat: numeric("lat", { mode: "number" }),
  lng: numeric("lng", { mode: "number" }),
  category: text("category"),
  mentionCount: integer("mention_count").notNull().default(0),
  totalLikes: integer("total_likes").notNull().default(0),
  totalComments: integer("total_comments").notNull().default(0),
  totalShares: integer("total_shares").notNull().default(0),
  totalBookmarks: integer("total_bookmarks").notNull().default(0),
  suspiciousLocation: boolean("suspicious_location").notNull().default(false),
  googlePlaceId: text("google_place_id"),
  verificationStatus: text("verification_status").notNull().default("unverified"),
  verificationScore: numeric("verification_score", { mode: "number" }),
  department: text("department"),
  municipality: text("municipality"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const placeMentions = pgTable(
  "place_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id),
    videoId: text("video_id").notNull(),
    sentiment: text("sentiment"),
    sentimentScore: numeric("sentiment_score", { mode: "number" }),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    bookmarks: integer("bookmarks").notNull().default(0),
    summary: text("summary"),
    locationText: text("location_text"),
    transcript: text("transcript"),
    source: text("source").notNull().default("tiktok"),
    sourceUrl: text("source_url"),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("place_mentions_place_source_video_key").on(table.placeId, table.source, table.videoId),
  ],
);

export const webSources = pgTable(
  "web_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull().unique(),
    domain: text("domain").notNull(),
    category: text("category"),
    status: text("status").notNull().default("pending"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("web_sources_status_idx").on(table.status)],
);
