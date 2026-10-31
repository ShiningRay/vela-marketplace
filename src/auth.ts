import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuthResult, PublicUser, UserRole } from "./types";
import { MarketError } from "./types";

interface UserRecord extends PublicUser {
  salt: string;
  passwordHash: string;
}

interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthStore {
  readonly #file: string;
  readonly #users = new Map<string, UserRecord>();
  readonly #sessions = new Map<string, SessionRecord>();

  constructor(dataDir: string) {
    const dir = path.resolve(dataDir);
    mkdirSync(dir, { recursive: true });
    this.#file = path.join(dir, "accounts.json");
    this.#load();
  }

  #load(): void {
    if (!existsSync(this.#file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.#file, "utf8")) as {
        users?: UserRecord[];
        sessions?: SessionRecord[];
      };
      const now = Date.now();
      for (const user of parsed.users ?? []) {
        if (user?.id && user.username) this.#users.set(user.id, user);
      }
      for (const session of parsed.sessions ?? []) {
        if (Date.parse(session.expiresAt) > now) this.#sessions.set(session.tokenHash, session);
      }
    } catch {
      this.#users.clear();
      this.#sessions.clear();
    }
  }

  #persist(): void {
    const temporary = `${this.#file}.tmp`;
    writeFileSync(
      temporary,
      `${JSON.stringify(
        { users: [...this.#users.values()], sessions: [...this.#sessions.values()] },
        null,
        2,
      )}\n`,
      "utf8",
    );
    renameSync(temporary, this.#file);
  }

  #hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }

  #createSession(user: UserRecord): AuthResult {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    this.#sessions.set(hashToken(token), {
      tokenHash: hashToken(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
    this.#persist();
    return { token, user: publicUser(user) };
  }

  register(username: string, password: string, role: UserRole = "publisher"): AuthResult {
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name)) {
      throw new MarketError(400, "username must match [A-Za-z0-9_-]{3,32}");
    }
    if (password.length < 8 || password.length > 200) {
      throw new MarketError(400, "password must be 8-200 characters");
    }
    if ([...this.#users.values()].some((user) => user.username.toLowerCase() === name.toLowerCase())) {
      throw new MarketError(409, "username is already registered");
    }
    const salt = randomBytes(16).toString("hex");
    const user: UserRecord = {
      id: randomBytes(12).toString("hex"),
      username: name,
      role,
      createdAt: new Date().toISOString(),
      salt,
      passwordHash: this.#hashPassword(password, salt),
    };
    this.#users.set(user.id, user);
    return this.#createSession(user);
  }

  ensureAdmin(username: string, password: string): PublicUser | null {
    if (!username || !password) return null;
    const existing = [...this.#users.values()].find((user) => user.role === "admin");
    if (existing) return publicUser(existing);
    return this.register(username, password, "admin").user;
  }

  login(username: string, password: string): AuthResult {
    const user = [...this.#users.values()].find(
      (candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase(),
    );
    if (!user) throw new MarketError(401, "invalid username or password");
    const actual = Buffer.from(this.#hashPassword(password, user.salt), "hex");
    const expected = Buffer.from(user.passwordHash, "hex");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new MarketError(401, "invalid username or password");
    }
    return this.#createSession(user);
  }

  resolve(token: string): PublicUser | null {
    if (!token) return null;
    const session = this.#sessions.get(hashToken(token));
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.#sessions.delete(session.tokenHash);
      this.#persist();
      return null;
    }
    const user = this.#users.get(session.userId);
    return user ? publicUser(user) : null;
  }

  logout(token: string): void {
    if (!token) return;
    this.#sessions.delete(hashToken(token));
    this.#persist();
  }
}
