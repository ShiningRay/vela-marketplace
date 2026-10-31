export interface VpkManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  icon?: string;
  window?: { width: number; height: number };
}

export type PluginStatus = "pending" | "published" | "rejected" | "suspended";
export type PluginCategory = "productivity" | "developer" | "finance" | "fun" | "system" | "other";
export type PluginSort = "recent" | "downloads" | "rating";
export type UserRole = "admin" | "publisher";

export const PLUGIN_CATEGORIES: PluginCategory[] = [
  "productivity",
  "developer",
  "finance",
  "fun",
  "system",
  "other",
];

export const PLUGIN_STATUSES: PluginStatus[] = [
  "pending",
  "published",
  "rejected",
  "suspended",
];

export interface PluginVersion {
  version: string;
  file: string;
  size: number;
  sha256: string;
  downloads: number;
  createdAt: string;
}

export interface ReviewRecord {
  id: string;
  userId: string;
  username: string;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginRecord {
  id: string;
  name: string;
  description: string;
  author: string;
  publisherId: string;
  publisherName: string;
  homepage: string;
  icon: string;
  category: PluginCategory;
  featured: boolean;
  status: PluginStatus;
  reviewNote: string;
  tags: string[];
  versions: PluginVersion[];
  reviews: ReviewRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PluginSummary {
  id: string;
  name: string;
  description: string;
  author: string;
  publisherName: string;
  homepage: string;
  icon: string;
  category: PluginCategory;
  featured: boolean;
  status: PluginStatus;
  reviewNote: string;
  tags: string[];
  latestVersion: string;
  size: number;
  downloads: number;
  rating: number;
  ratingCount: number;
  updatedAt: string;
}

export interface PluginList {
  items: PluginSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PluginListQuery {
  q?: string;
  category?: PluginCategory;
  featured?: boolean;
  sort?: PluginSort;
  status?: PluginStatus | "all";
  page?: number;
  pageSize?: number;
}

export interface PublishInput {
  buffer: Uint8Array;
  description?: string;
  author?: string;
  homepage?: string;
  tags?: string[];
  category?: PluginCategory;
  publisherId: string;
  publisherName: string;
  publisherRole: UserRole;
}

export interface ReviewInput {
  rating: number;
  body: string;
}

export interface DownloadTarget {
  filePath: string;
  fileName: string;
  version: string;
  sha256: string;
}

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export class MarketError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MarketError";
    this.status = status;
  }
}
