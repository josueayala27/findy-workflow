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
  followers?: number;
}

export interface RawApifyVideoAsset {
  width?: number;
  height?: number;
  duration?: number;
  url?: string;
  cover?: string;
  thumbnail?: string;
}

export interface RawApifyItem {
  id?: string;
  title?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  bookmarks?: number;
  hashtags?: string[];
  channel?: RawApifyChannel;
  uploadedAt?: number;
  uploadedAtFormatted?: string;
  video?: RawApifyVideoAsset;
}

export interface VideoAnalysis {
  videoId: string;
  sentiment: string;
  sentimentScore: number;
  transcription: string;
  location: string | null;
  summary: string;
}
