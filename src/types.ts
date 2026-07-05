export type Category =
  | "Restaurants"
  | "Beach"
  | "Tourist"
  | "Shopping"
  | "Nightlife"
  | "ActiveLife";

export interface ScrapeInput {
  query: string;
  category: Category;
  location?: string;
  resultsLimit?: number;
}

export type ApifyDateRange =
  | "DEFAULT"
  | "LAST_24_HOURS"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "LAST_THREE_MONTHS"
  | "LAST_SIX_MONTHS";

export type ApifySortType = "RELEVANCE" | "MOST_LIKED";

export interface ApifyActorInput {
  customMapFunction: string;
  dateRange: ApifyDateRange;
  includeSearchKeywords: boolean;
  keywords: string[];
  location: string;
  maxItems: number;
  sortType: ApifySortType;
}

export interface RawApifyChannel {
  id?: string;
  name?: string;
  username?: string;
  bio?: string;
  avatar?: string;
  verified?: boolean;
  url?: string;
  followers?: number;
  following?: number;
  videos?: number;
}

export interface RawApifyVideo {
  width?: number;
  height?: number;
  ratio?: string;
  duration?: number;
  url?: string;
  cover?: string;
  thumbnail?: string;
}

export interface RawApifySong {
  id?: number;
  title?: string;
  artist?: string;
  album?: string | null;
  duration?: number;
  cover?: string;
}

/** TikTok-native subtitle track, when present — free alternative to running STT. */
export interface RawApifySubtitle {
  caption_format?: string;
  caption_length?: number;
  is_auto_generated?: boolean;
  is_original_caption?: boolean;
  lang?: string;
  language_code?: string;
  url?: string;
}

export interface RawApifyItem {
  inputSource?: string;
  id?: string;
  title?: string;
  views?: number;
  likes?: number;
  /** Comment count only — this actor does not return comment text. */
  comments?: number;
  shares?: number;
  bookmarks?: number;
  hashtags?: string[];
  channel?: RawApifyChannel;
  uploadedAt?: number;
  uploadedAtFormatted?: string;
  video?: RawApifyVideo;
  song?: RawApifySong;
  subtitleInformation?: RawApifySubtitle[];
  postPage?: string;
}

export const SENTIMENTS = [
  "happy",
  "excited",
  "relaxing",
  "nostalgic",
  "neutral",
  "disappointed",
  "sad",
  "angry",
] as const;

export type Sentiment = (typeof SENTIMENTS)[number];

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationMention {
  name: string;
  coordinates: Coordinates | null;
}

export interface VideoAnalysis {
  videoId: string;
  sentiment: Sentiment;
  sentimentScore: number;
  transcription: string;
  locations: LocationMention[];
  summary: string;
}

export interface Engagement {
  likes: number;
  comments: number;
  shares: number;
  bookmarks: number;
}

export interface PlaceSentiment {
  videoId: string;
  sentiment: Sentiment;
  sentimentScore: number;
}

export interface PlaceSummary {
  placeId: string;
  name: string;
  location: string | null;
  coordinates: { lat: number; lng: number } | null;
  score: number;
  mentionCount: number;
  engagement: Engagement;
  sentiments: PlaceSentiment[];
  suspicious: boolean;
}
