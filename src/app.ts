import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import type { AuthStore } from "./auth";
import type { PublicUser } from "./types";
import { MarketError, PLUGIN_CATEGORIES, PLUGIN_STATUSES } from "./types";
import type { PluginCategory, PluginStatus } from "./types";
import { MarketplaceStore } from "./store";

const MAX_UPLOAD_BYTES = 6_000_000;
const DEFAULT_PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function bearer(req: Request): string {
  const header = req.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function numberParam(value: unknown, fallback: number): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringBody(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
  return typeof value === "string" ? value : "";
}

function booleanParam(value: unknown): boolean | undefined {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return undefined;
}

function categoryParam(value: unknown): PluginCategory | undefined {
  const category = stringBody(value);
  return (PLUGIN_CATEGORIES as string[]).includes(category)
    ? (category as PluginCategory)
    : undefined;
}

function statusParam(value: unknown): PluginStatus | "all" | undefined {
  const status = stringBody(value);
  if (status === "all") return "all";
  return (PLUGIN_STATUSES as string[]).includes(status) ? (status as PluginStatus) : undefined;
}

export interface CreateAppOptions {
  store: MarketplaceStore;
  accounts: AuthStore;
  adminToken: string;
  publicDir?: string;
}

interface Locals {
  user?: PublicUser;
}

export function createApp(options: CreateAppOptions) {
  const app = express();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const resolveUser = (req: Request): PublicUser | null => {
    const token = bearer(req);
    if (!token) return null;
    if (options.adminToken && tokenMatches(token, options.adminToken)) {
      return {
        id: "admin-token",
        username: "admin",
        role: "admin",
        createdAt: "1970-01-01T00:00:00.000Z",
      };
    }
    return options.accounts.resolve(token);
  };

  app.use((req, res, next) => {
    (res.locals as Locals).user = resolveUser(req) ?? undefined;
    next();
  });

  const userOf = (res: Response): PublicUser | undefined => (res.locals as Locals).user;

  const requireUser = (_req: Request, res: Response, next: NextFunction): void => {
    if (!userOf(res)) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  };

  const requireAdmin = (_req: Request, res: Response, next: NextFunction): void => {
    const user = userOf(res);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin role required" });
      return;
    }
    next();
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "vela-marketplace" });
  });

  app.get("/api/meta", (_req, res) => {
    res.json({ categories: PLUGIN_CATEGORIES, statuses: PLUGIN_STATUSES });
  });

  app.post("/api/auth/register", (req, res, next) => {
    try {
      const username = stringBody(req.body.username);
      const password = stringBody(req.body.password);
      res.status(201).json(options.accounts.register(username, password));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    try {
      res.json(
        options.accounts.login(stringBody(req.body.username), stringBody(req.body.password)),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const user = userOf(res);
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    res.json({ user });
  });

  app.post("/api/auth/logout", (req, res) => {
    options.accounts.logout(bearer(req));
    res.status(204).end();
  });

  app.get("/api/me/plugins", requireUser, (req, res) => {
    const user = userOf(res)!;
    res.json({ items: options.store.byPublisher(user.id) });
  });

  app.get("/api/plugins", (req, res) => {
    const sort = stringBody(req.query.sort);
    res.json(
      options.store.list({
        q: stringBody(req.query.q),
        category: categoryParam(req.query.category),
        featured: booleanParam(req.query.featured),
        sort: sort === "downloads" || sort === "rating" ? sort : "recent",
        page: numberParam(req.query.page, 1),
        pageSize: numberParam(req.query.pageSize, 24),
      }),
    );
  });

  app.get("/api/plugins/:id", (req, res) => {
    const plugin = options.store.get(req.params.id ?? "");
    if (!plugin) {
      res.status(404).json({ error: "Unknown plugin" });
      return;
    }
    res.json({
      ...plugin,
      versions: options.store.versions(plugin.id),
      reviews: options.store.reviews(plugin.id),
    });
  });

  app.get("/api/plugins/:id/reviews", (req, res) => {
    res.json({ items: options.store.reviews(req.params.id ?? "") });
  });

  app.post("/api/plugins/:id/reviews", requireUser, (req, res, next) => {
    try {
      const user = userOf(res)!;
      const plugin = options.store.addReview(
        (req.params.id ?? ""),
        { id: user.id, username: user.username },
        {
          rating: numberParam(req.body.rating, 0),
          body: stringBody(req.body.body),
        },
      );
      res.status(201).json(plugin);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/plugins/:id/download", (req, res, next) => {
    try {
      const version = stringBody(req.query.version) || "latest";
      const target = options.store.download((req.params.id ?? ""), version);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("X-VPK-SHA256", target.sha256);
      res.download(target.filePath, target.fileName, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/plugins", requireUser, upload.single("file"), (req, res, next) => {
    try {
      if (!req.file) throw new MarketError(400, "file field is required");
      const user = userOf(res)!;
      const tags = stringBody(req.body.tags)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const plugin = options.store.publish({
        buffer: req.file.buffer,
        description: stringBody(req.body.description),
        author: stringBody(req.body.author),
        homepage: stringBody(req.body.homepage),
        tags,
        category: categoryParam(req.body.category),
        publisherId: user.id,
        publisherName: user.username,
        publisherRole: user.role,
      });
      res.status(201).json(plugin);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/plugins", requireAdmin, (req, res) => {
    const status = statusParam(req.query.status) ?? "pending";
    res.json(
      options.store.list({
        q: stringBody(req.query.q),
        category: categoryParam(req.query.category),
        featured: booleanParam(req.query.featured),
        status,
        sort: "recent",
        page: numberParam(req.query.page, 1),
        pageSize: numberParam(req.query.pageSize, 100),
      }),
    );
  });

  app.post("/api/admin/plugins/:id/status", requireAdmin, (req, res, next) => {
    try {
      const status = statusParam(req.body.status);
      if (!status || status === "all") throw new MarketError(400, "valid status is required");
      res.json(options.store.setStatus((req.params.id ?? ""), status, stringBody(req.body.note)));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/plugins/:id", requireAdmin, (req, res, next) => {
    try {
      res.json(
        options.store.updateMeta((req.params.id ?? ""), {
          category: categoryParam(req.body.category),
          featured: typeof req.body.featured === "boolean" ? req.body.featured : undefined,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.use(express.static(options.publicDir ?? DEFAULT_PUBLIC_DIR));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof MarketError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "Internal marketplace error" });
  });

  return app;
}
