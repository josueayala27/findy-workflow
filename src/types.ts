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

export interface RawApifyComment {
  text?: string;
  diggCount?: number;
}

export interface RawApifyAuthor {
  name?: string;
  nickName?: string;
}

export interface RawApifyVideoMeta {
  coverUrl?: string;
  originalCoverUrl?: string;
}

export interface RawApifyItem {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  diggCount?: number;
  playCount?: number;
  commentCount?: number;
  comments?: RawApifyComment[];
  videoMeta?: RawApifyVideoMeta;
  authorMeta?: RawApifyAuthor;
}
