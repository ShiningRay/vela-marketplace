import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import semver from "semver";
import type {
  DownloadTarget,
  PluginCategory,
  PluginList,
  PluginListQuery,
  PluginRecord,
  PluginStatus,
  PluginSummary,
  PluginVersion,
  PublishInput,
  ReviewInput,
  ReviewRecord,
  VpkManifest,
} from "./types";
import { MarketError, PLUGIN_CATEGORIES, PLUGIN_STATUSES } from "./types";

const MANIFEST_PATH = "manifest.json";
const MAX_FILES = 64;
const MAX_FILE_BYTES = 5_000_000;
const MAX_TOTAL_BYTES = 6_000_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;
const RESERVED_IDS = new Set([
  "about",
  "files",
  "editor",
  "terminal",
  "marketplace",
  "service",
  "settings",
]);

function safeArchivePath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "." || part === "")) return null;
  return normalized;
}

function parseManifest(value: unknown): VpkManifest {
  if (typeof value !== "object" || value === null) {
    throw new MarketError(400, "manifest.json must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.id !== "string" || !ID_PATTERN.test(manifest.id)) {
    throw new MarketError(400, "manifest.id must match ^[a-z0-9][a-z0-9-]{1,31}$");
  }
  if (RESERVED_IDS.has(manifest.id)) {
    throw new MarketError(400, `manifest.id is reserved: ${manifest.id}`);
  }
  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    throw new MarketError(400, "manifest.name is required");
  }
  if (typeof manifest.version !== "string" || !semver.valid(manifest.version)) {
    throw new MarketError(400, "manifest.version must be a valid semver version");
  }
  if (typeof manifest.entry !== "string" || !manifest.entry.endsWith(".html")) {
    throw new MarketError(400, "manifest.entry must be an HTML file");
  }
  let window: VpkManifest["window"];
  if (manifest.window !== undefined) {
    if (typeof manifest.window !== "object" || manifest.window === null) {
      throw new MarketError(400, "manifest.window must be an object");
    }
    const raw = manifest.window as Record<string, unknown>;
    if (
      typeof raw.width !== "number" ||
      typeof raw.height !== "number" ||
      !Number.isFinite(raw.width) ||
      !Number.isFinite(raw.height) ||
      raw.width < 240 ||
      raw.height < 180
    ) {
      throw new MarketError(400, "manifest.window requires width >= 240 and height >= 180");
    }
    window = { width: Math.round(raw.width), height: Math.round(raw.height) };
  }
  return {
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version,
    entry: safeArchivePath(manifest.entry) ?? "",
    icon: typeof manifest.icon === "string" ? manifest.icon.slice(0, 4) : "▣",
    ...(window ? { window } : {}),
  };
}

export interface InspectedVpk {
  manifest: VpkManifest;
  sha256: string;
  size: number;
}

export function inspectVpk(buffer: Uint8Array): InspectedVpk {
  if (buffer.byteLength > MAX_TOTAL_BYTES) {
    throw new MarketError(413, "Package exceeds the 6 MB limit");
  }
  let archive: Record<string, Uint8Array>;
  let extractedBytes = 0;
  try {
    archive = unzipSync(buffer, {
      filter: (file) => {
        if (file.originalSize > MAX_FILE_BYTES) {
          throw new MarketError(413, `File is too large: ${file.name}`);
        }
        extractedBytes += file.originalSize;
        if (extractedBytes > MAX_TOTAL_BYTES) {
          throw new MarketError(413, "Package exceeds the 6 MB limit");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof MarketError) throw error;
    throw new MarketError(400, "File is not a valid VPK/ZIP package");
  }
  const names = Object.keys(archive).filter((name) => !name.endsWith("/"));
  if (names.length === 0) throw new MarketError(400, "Package is empty");
  if (names.length > MAX_FILES) throw new MarketError(400, `Package has more than ${MAX_FILES} files`);

  let total = 0;
  for (const name of names) {
    if (!safeArchivePath(name)) throw new MarketError(400, `Unsafe package path: ${name}`);
    const bytes = archive[name];
    if (!bytes) continue;
    if (bytes.byteLength > MAX_FILE_BYTES) throw new MarketError(413, `File is too large: ${name}`);
    total += bytes.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new MarketError(413, "Package exceeds the 6 MB limit");
  }

  const rawManifest = archive[MANIFEST_PATH];
  if (!rawManifest) throw new MarketError(400, "manifest.json must be at the package root");
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(rawManifest));
  } catch {
    throw new MarketError(400, "manifest.json is not valid JSON");
  }
  const manifest = parseManifest(parsed);
  if (!manifest.entry || !archive[manifest.entry]) {
    throw new MarketError(400, `Entry not found: ${manifest.entry || "(empty)"}`);
  }
  return {
    manifest,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    size: buffer.byteLength,
  };
}

function text(value: string | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

function normalizeTags(input: string[] | undefined): string[] {
  if (!input) return [];
  const unique = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().toLowerCase();
    if (tag) unique.add(tag.slice(0, 24));
    if (unique.size >= 8) break;
  }
  return [...unique];
}

function isCategory(value: unknown): value is PluginCategory {
  return typeof value === "string" && (PLUGIN_CATEGORIES as string[]).includes(value);
}

function isStatus(value: unknown): value is PluginStatus {
  return typeof value === "string" && (PLUGIN_STATUSES as string[]).includes(value);
}

function latestVersion(record: PluginRecord): PluginVersion {
  const sorted = [...record.versions].sort((left, right) =>
    semver.rcompare(left.version, right.version),
  );
  const latest = sorted[0];
  if (!latest) throw new MarketError(500, `Plugin has no versions: ${record.id}`);
  return latest;
}

function averageRating(reviews: ReviewRecord[]): { rating: number; count: number } {
  if (reviews.length === 0) return { rating: 0, count: 0 };
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return { rating: Math.round((total / reviews.length) * 10) / 10, count: reviews.length };
}

function summarize(record: PluginRecord): PluginSummary {
  const latest = latestVersion(record);
  const rating = averageRating(record.reviews);
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    author: record.author,
    publisherName: record.publisherName,
    homepage: record.homepage,
    icon: record.icon,
    category: record.category,
    featured: record.featured,
    status: record.status,
    reviewNote: record.reviewNote,
    tags: record.tags,
    latestVersion: latest.version,
    size: latest.size,
    downloads: record.versions.reduce((sum, version) => sum + version.downloads, 0),
    rating: rating.rating,
    ratingCount: rating.count,
    updatedAt: record.updatedAt,
  };
}

function normalizeRecord(raw: Partial<PluginRecord> & { id: string; name: string }): PluginRecord {
  const now = new Date().toISOString();
  const versions = Array.isArray(raw.versions)
    ? raw.versions.map((version) => ({
        ...version,
        downloads: typeof version.downloads === "number" ? version.downloads : 0,
      }))
    : [];
  const reviews = Array.isArray(raw.reviews) ? raw.reviews : [];
  return {
    id: raw.id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    author: typeof raw.author === "string" ? raw.author : "Vela",
    publisherId: typeof raw.publisherId === "string" ? raw.publisherId : "system",
    publisherName: typeof raw.publisherName === "string" ? raw.publisherName : "Vela",
    homepage: typeof raw.homepage === "string" ? raw.homepage : "",
    icon: typeof raw.icon === "string" ? raw.icon : "▣",
    category: isCategory(raw.category) ? raw.category : "other",
    featured: raw.featured === true,
    status: isStatus(raw.status) ? raw.status : "published",
    reviewNote: typeof raw.reviewNote === "string" ? raw.reviewNote : "",
    tags: Array.isArray(raw.tags) ? normalizeTags(raw.tags) : [],
    versions,
    reviews,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

export class MarketplaceStore {
  readonly #dataDir: string;
  readonly #metadataPath: string;
  readonly #filesDir: string;
  #plugins = new Map<string, PluginRecord>();

  constructor(dataDir: string) {
    this.#dataDir = path.resolve(dataDir);
    this.#metadataPath = path.join(this.#dataDir, "plugins.json");
    this.#filesDir = path.join(this.#dataDir, "files");
    mkdirSync(this.#filesDir, { recursive: true });
    this.#load();
  }

  #load(): void {
    if (!existsSync(this.#metadataPath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.#metadataPath, "utf8")) as {
        plugins?: Array<Partial<PluginRecord> & { id: string; name: string }>;
      };
      for (const raw of parsed.plugins ?? []) {
        if (!raw?.id || !raw.name) continue;
        const record = normalizeRecord(raw);
        this.#plugins.set(record.id, record);
      }
    } catch {
      this.#plugins = new Map();
    }
  }

  #persist(): void {
    mkdirSync(this.#dataDir, { recursive: true });
    const temporary = `${this.#metadataPath}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify({ version: 2, plugins: [...this.#plugins.values()] }, null, 2)}\n`,
      "utf8",
    );
    renameSync(temporary, this.#metadataPath);
  }

  publish(input: PublishInput): PluginSummary {
    const inspected = inspectVpk(input.buffer);
    const { manifest } = inspected;
    const existing = this.#plugins.get(manifest.id);
    if (existing && input.publisherRole !== "admin" && existing.publisherId !== input.publisherId) {
      throw new MarketError(403, "Plugin belongs to another publisher");
    }
    if (existing?.versions.some((version) => version.version === manifest.version)) {
      throw new MarketError(409, `Version already exists: ${manifest.id}@${manifest.version}`);
    }

    const now = new Date().toISOString();
    const relativeFile = path.posix.join("files", manifest.id, `${manifest.version}.vpk`);
    const absoluteFile = path.join(this.#dataDir, relativeFile);
    mkdirSync(path.dirname(absoluteFile), { recursive: true });
    writeFileSync(absoluteFile, input.buffer);

    const version: PluginVersion = {
      version: manifest.version,
      file: relativeFile,
      size: inspected.size,
      sha256: inspected.sha256,
      downloads: 0,
      createdAt: now,
    };

    const record: PluginRecord = existing ?? {
      id: manifest.id,
      name: manifest.name,
      description: "",
      author: input.publisherName,
      publisherId: input.publisherId,
      publisherName: input.publisherName,
      homepage: "",
      icon: manifest.icon ?? "▣",
      category: "other",
      featured: false,
      status: "pending",
      reviewNote: "",
      tags: [],
      versions: [],
      reviews: [],
      createdAt: now,
      updatedAt: now,
    };
    record.name = manifest.name;
    record.icon = manifest.icon ?? record.icon;
    if (!existing || input.publisherRole !== "admin") {
      record.publisherId = input.publisherId;
      record.publisherName = input.publisherName;
    }
    record.author =
      text(input.author, 80) || record.publisherName || input.publisherName;
    const description = text(input.description, 500);
    const homepage = text(input.homepage, 300);
    if (description) record.description = description;
    if (homepage) record.homepage = homepage;
    if (isCategory(input.category)) record.category = input.category;
    const tags = normalizeTags(input.tags);
    if (tags.length > 0) record.tags = tags;
    record.status = input.publisherRole === "admin" ? "published" : "pending";
    record.reviewNote = "";
    record.versions.push(version);
    record.updatedAt = now;
    this.#plugins.set(record.id, record);
    this.#persist();
    return summarize(record);
  }

  list(query: PluginListQuery = {}): PluginList {
    const needle = (query.q ?? "").trim().toLowerCase();
    const status = query.status ?? "published";
    const records = [...this.#plugins.values()].filter((record) => {
      if (status !== "all" && record.status !== status) return false;
      if (query.category && record.category !== query.category) return false;
      if (query.featured !== undefined && record.featured !== query.featured) return false;
      if (!needle) return true;
      return [
        record.id,
        record.name,
        record.description,
        record.author,
        record.publisherName,
        ...record.tags,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    const sort = query.sort ?? "recent";
    const items = records.map(summarize).sort((left, right) => {
      if (sort === "downloads") return right.downloads - left.downloads;
      if (sort === "rating") {
        return right.rating - left.rating || right.ratingCount - left.ratingCount;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
    const safePage = Math.max(1, Math.floor(query.page ?? 1) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 24) || 24));
    const start = (safePage - 1) * safeSize;
    return {
      items: items.slice(start, start + safeSize),
      total: items.length,
      page: safePage,
      pageSize: safeSize,
    };
  }

  byPublisher(publisherId: string): PluginSummary[] {
    return [...this.#plugins.values()]
      .filter((record) => record.publisherId === publisherId)
      .map(summarize)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  get(id: string, includeUnpublished = false): PluginSummary | null {
    const record = this.#plugins.get(id);
    if (!record) return null;
    if (!includeUnpublished && record.status !== "published") return null;
    return summarize(record);
  }

  versions(id: string): PluginVersion[] {
    const record = this.#plugins.get(id);
    if (!record) return [];
    return [...record.versions].sort((left, right) => semver.rcompare(left.version, right.version));
  }

  reviews(id: string): ReviewRecord[] {
    const record = this.#plugins.get(id);
    if (!record || record.status !== "published") return [];
    return [...record.reviews].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  addReview(id: string, user: { id: string; username: string }, input: ReviewInput): PluginSummary {
    const record = this.#plugins.get(id);
    if (!record || record.status !== "published") throw new MarketError(404, `Unknown plugin: ${id}`);
    if (record.publisherId === user.id) {
      throw new MarketError(400, "publishers cannot review their own plugin");
    }
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new MarketError(400, "rating must be an integer from 1 to 5");
    }
    const body = text(input.body, 1000);
    if (!body) throw new MarketError(400, "review body is required");
    const now = new Date().toISOString();
    const existing = record.reviews.find((review) => review.userId === user.id);
    if (existing) {
      existing.rating = input.rating;
      existing.body = body;
      existing.username = user.username;
      existing.updatedAt = now;
    } else {
      record.reviews.push({
        id: randomUUID(),
        userId: user.id,
        username: user.username,
        rating: input.rating,
        body,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.#persist();
    return summarize(record);
  }

  setStatus(id: string, status: PluginStatus, note = ""): PluginSummary {
    const record = this.#plugins.get(id);
    if (!record) throw new MarketError(404, `Unknown plugin: ${id}`);
    if (!isStatus(status)) throw new MarketError(400, "invalid plugin status");
    record.status = status;
    record.reviewNote = text(note, 500);
    record.updatedAt = new Date().toISOString();
    this.#persist();
    return summarize(record);
  }

  updateMeta(
    id: string,
    patch: { category?: PluginCategory; featured?: boolean },
  ): PluginSummary {
    const record = this.#plugins.get(id);
    if (!record) throw new MarketError(404, `Unknown plugin: ${id}`);
    if (patch.category !== undefined) {
      if (!isCategory(patch.category)) throw new MarketError(400, "invalid plugin category");
      record.category = patch.category;
    }
    if (patch.featured !== undefined) record.featured = patch.featured;
    record.updatedAt = new Date().toISOString();
    this.#persist();
    return summarize(record);
  }

  download(id: string, requestedVersion = "latest"): DownloadTarget {
    const record = this.#plugins.get(id);
    if (!record || record.status !== "published") throw new MarketError(404, `Unknown plugin: ${id}`);
    const version =
      requestedVersion === "latest"
        ? latestVersion(record)
        : record.versions.find((candidate) => candidate.version === requestedVersion);
    if (!version) throw new MarketError(404, `Unknown version: ${id}@${requestedVersion}`);
    const filePath = path.join(this.#dataDir, version.file);
    if (!existsSync(filePath)) throw new MarketError(404, "Package file is missing");
    version.downloads += 1;
    this.#persist();
    return {
      filePath,
      fileName: `${record.id}-${version.version}.vpk`,
      version: version.version,
      sha256: version.sha256,
    };
  }
}
