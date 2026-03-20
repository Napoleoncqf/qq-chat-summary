export interface TopicSummary {
  title: string;
  summary: string;
  participants: string[];
}

export interface HighlightMessage {
  user: string;
  content: string;
  comment: string;
}

export interface UserRanking {
  user: string;
  count: number;
}

export interface ModerationItem {
  type: string; // e.g. "粗俗谐音", "不当内容"
  user: string;
  content: string;
  reason: string;
}

export interface ResourceLink {
  user: string;
  url: string;
  description: string;
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
  moderation: ModerationItem[];
  resources: ResourceLink[];
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
