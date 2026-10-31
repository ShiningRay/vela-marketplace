import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { AuthStore } from "../src/auth";
import { MarketplaceStore } from "../src/store";

function packageBuffer(
  id = "market-demo",
  name = "Market Demo",
  version = "1.0.0",
): Buffer {
  const manifest = {
    id,
    name,
    version,
    entry: "index.html",
    icon: "M",
  };
  const archive = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest)),
    "index.html": strToU8(`<!doctype html><h1>${name}</h1>`),
  });
  return Buffer.from(archive);
}

describe("marketplace API", () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), "vela-marketplace-"));
    app = createApp({
      store: new MarketplaceStore(dataDir),
      accounts: new AuthStore(dataDir),
      adminToken: "test-token",
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("uploads as admin, searches and downloads a published VPK", async () => {
    const buffer = packageBuffer();
    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer test-token")
      .field("description", "A demo plugin")
      .field("author", "E2E")
      .field("category", "developer")
      .field("tags", "demo,test")
      .attach("file", buffer, "market-demo.vpk")
      .expect(201)
      .expect((response) => {
        expect(response.body.id).toBe("market-demo");
        expect(response.body.latestVersion).toBe("1.0.0");
        expect(response.body.status).toBe("published");
      });

    const list = await request(app).get("/api/plugins?q=demo&category=developer").expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({
      id: "market-demo",
      name: "Market Demo",
      author: "E2E",
      latestVersion: "1.0.0",
      category: "developer",
      status: "published",
      rating: 0,
      ratingCount: 0,
      tags: ["demo", "test"],
    });

    const download = await request(app)
      .get("/api/plugins/market-demo/download?version=latest")
      .expect(200)
      .expect("Content-Type", "application/zip");
    expect(download.headers["content-disposition"]).toContain("market-demo-1.0.0.vpk");
    expect(download.headers["content-length"]).toBe(String(buffer.length));
    expect(download.headers["x-vpk-sha256"]).toMatch(/^[a-f0-9]{64}$/);

    const after = await request(app).get("/api/plugins/market-demo").expect(200);
    expect(after.body.downloads).toBe(1);
  });

  it("registers publishers, reviews uploads and supports review and ratings", async () => {
    const publisher = await request(app)
      .post("/api/auth/register")
      .send({ username: "publisher", password: "publisher-pass" })
      .expect(201);
    const publisherToken = publisher.body.token as string;
    expect(publisher.body.user).toMatchObject({ username: "publisher", role: "publisher" });

    await request(app)
      .post("/api/plugins")
      .set("Authorization", `Bearer ${publisherToken}`)
      .field("description", "Pending plugin")
      .field("category", "finance")
      .attach("file", packageBuffer("pending-demo", "Pending Demo"), "pending-demo.vpk")
      .expect(201)
      .expect((response) => expect(response.body.status).toBe("pending"));

    expect((await request(app).get("/api/plugins?q=pending")).body.total).toBe(0);
    const mine = await request(app)
      .get("/api/me/plugins")
      .set("Authorization", `Bearer ${publisherToken}`)
      .expect(200);
    expect(mine.body.items[0]).toMatchObject({ id: "pending-demo", status: "pending" });
    const pending = await request(app)
      .get("/api/admin/plugins?status=pending")
      .set("Authorization", "Bearer test-token")
      .expect(200);
    expect(pending.body.total).toBe(1);

    await request(app)
      .post("/api/admin/plugins/pending-demo/status")
      .set("Authorization", "Bearer test-token")
      .send({ status: "published", note: "looks good" })
      .expect(200);
    await request(app)
      .patch("/api/admin/plugins/pending-demo")
      .set("Authorization", "Bearer test-token")
      .send({ category: "finance", featured: true })
      .expect(200);

    const published = await request(app).get("/api/plugins?featured=true").expect(200);
    expect(published.body.items[0]).toMatchObject({
      id: "pending-demo",
      category: "finance",
      featured: true,
      status: "published",
    });

    const reviewer = await request(app)
      .post("/api/auth/register")
      .send({ username: "reviewer", password: "reviewer-pass" })
      .expect(201);
    await request(app)
      .post("/api/plugins/pending-demo/reviews")
      .set("Authorization", `Bearer ${reviewer.body.token}`)
      .send({ rating: 5, body: "Excellent plugin" })
      .expect(201);

    await request(app)
      .post("/api/plugins/pending-demo/reviews")
      .set("Authorization", `Bearer ${publisherToken}`)
      .send({ rating: 1, body: "Self review" })
      .expect(400);

    const detail = await request(app).get("/api/plugins/pending-demo").expect(200);
    expect(detail.body.rating).toBe(5);
    expect(detail.body.ratingCount).toBe(1);
    expect(detail.body.reviews[0]).toMatchObject({ username: "reviewer", rating: 5 });
  });

  it("rejects missing auth, duplicate versions and malformed packages", async () => {
    const buffer = packageBuffer();
    await request(app).post("/api/plugins").attach("file", buffer, "demo.vpk").expect(401);
    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer wrong")
      .attach("file", buffer, "demo.vpk")
      .expect(401);
    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer test-token")
      .attach("file", buffer, "demo.vpk")
      .expect(201);
    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer test-token")
      .attach("file", buffer, "demo.vpk")
      .expect(409);

    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer test-token")
      .attach("file", Buffer.from("not a zip"), "bad.vpk")
      .expect(400);

    await request(app)
      .post("/api/plugins")
      .set("Authorization", "Bearer test-token")
      .attach("file", packageBuffer("missing-demo", "Missing", "1.0.0"), "missing.vpk")
      .expect(201);
    await request(app)
      .post("/api/admin/plugins/missing-demo/status")
      .set("Authorization", "Bearer test-token")
      .send({ status: "bogus" })
      .expect(400);
  });
});
