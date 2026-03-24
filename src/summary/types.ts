export interface TopicSummary {
  title: string;
  summary: string;
  participants: string[];
}

export interface HighlightMessage {
  user: string;
  content: string;
}

export interface UserRanking {
  user: string;
  count: number;
}

export interface ChatStats {
  message_count: number;
  user_count: number;
  active_hours: string; // e.g. "08:15-16:38"
}

export interface DailySummary {
  date: string;
  group_name: string;
  stats: ChatStats;
  topics: TopicSummary[];
  highlights: HighlightMessage[];
  ranking: UserRanking[];
}

export interface RoastItem {
  rank: number;
  user: string;
  count: number;
  roast: string; // 2-line witty commentary
}

export interface RoastResult {
  group_name: string;
  date_range: string;
  message_count: number;
  user_count: number;
  items: RoastItem[];
}

export interface TopicCategory {
  category: string;
  percentage: number;
  title: string;
  description: string;
}

export interface TopicBreakdown {
  group_name: string;
  date_range: string;
  overall_score: number;
  categories: TopicCategory[];
  overall_comment_title: string;
  overall_comment: string;
}
