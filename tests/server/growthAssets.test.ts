import { Readable } from "node:stream";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { TMP_DIR } = vi.hoisted(() => {
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { resolve: resolvePath } = require("node:path") as typeof import("node:path");
  return { TMP_DIR: resolvePath(tmpdir(), `gitdeck-growth-assets-${process.pid}-${Date.now()}`) };
});

vi.mock("../../src/server/config", () => ({ DATA_DIR: TMP_DIR }));

const assets = await import("../../src/server/growth/assets");
const store = await import("../../src/server/growth/store");
const { closeDatabase, getDatabase } = await import("../../src/server/sqlite");

function body(value: Buffer | string): Readable {
  return Readable.from([value]);
}

function upload(overrides: Partial<Parameters<typeof assets.persistUploadedGrowthAsset>[0]> = {}) {
  const bytes = Buffer.from("asset bytes\u0000", "utf8");
  return assets.persistUploadedGrowthAsset({
    accountId: "account-a",
    repository: "acme/rocket",
    filename: "release.png",
    title: "Release image",
    alt: "The release dashboard",
    width: 1200,
    height: 630,
    contentType: "image/png",
    contentLength: bytes.byteLength,
    body: body(bytes),
    ...overrides,
  });
}

beforeEach(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  closeDatabase();
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("Growth asset persistence", () => {
  it.each([
    ["image/png", "image", ".png"],
    ["image/jpeg", "image", ".jpg"],
    ["image/webp", "image", ".webp"],
    ["image/gif", "image", ".gif"],
    ["video/mp4", "video", ".mp4"],
    ["video/webm", "video", ".webm"],
  ] as const)("round-trips an allowlisted %s upload", async (contentType, kind, extension) => {
    const bytes = Buffer.from(`binary-${contentType}\u0000`, "utf8");
    const saved = await upload({
      filename: `asset${extension}`,
      contentType,
      contentLength: bytes.byteLength,
      body: body(bytes),
    });

    expect(saved).toMatchObject({
      accountId: "account-a",
      repository: "acme/rocket",
      kind,
      origin: "upload",
      title: "Release image",
      alt: "The release dashboard",
    });
    expect(saved.path).toMatch(new RegExp(`^[0-9a-f-]+\\${extension}$`));
    expect(saved.path).not.toContain("growth-assets");
    const file = await assets.readGrowthAssetFile("account-a", saved.id);
    expect(file).toEqual({ body: bytes, contentType, length: bytes.byteLength });
    expect(await assets.readGrowthAssetFile("account-b", saved.id)).toBeNull();
  });

  it("rejects unsupported, empty, mismatched, and oversized bodies without orphaning files or rows", async () => {
    await expect(upload({ contentType: "image/svg+xml" }))
      .rejects.toBeInstanceOf(assets.UnsupportedGrowthAssetTypeError);
    await expect(upload({ contentLength: 0, body: body(Buffer.alloc(0)) }))
      .rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ contentLength: 2, body: body("three") }))
      .rejects.toBeInstanceOf(assets.GrowthAssetValidationError);

    async function* oversizedBody() {
      for (let index = 0; index < 26; index += 1) yield Buffer.alloc(1024 * 1024, index);
    }
    await expect(upload({ contentLength: undefined, body: oversizedBody() }))
      .rejects.toBeInstanceOf(assets.GrowthAssetTooLargeError);

    expect(store.listGrowthAssets("account-a", "acme/rocket")).toEqual([]);
    const files = await readdir(assets.getGrowthAssetRoot()).catch(() => [] as string[]);
    expect(files).toEqual([]);
  });

  it("cleans up the installed file when SQLite persistence fails", async () => {
    store.ensureGrowthSchema();
    getDatabase().exec(`
      CREATE TRIGGER reject_growth_asset_insert
      BEFORE INSERT ON growth_assets
      BEGIN
        SELECT RAISE(FAIL, 'forced persistence failure');
      END;
    `);

    await expect(upload()).rejects.toThrow("forced persistence failure");
    expect(store.listGrowthAssets("account-a", "acme/rocket")).toEqual([]);
    expect(await readdir(assets.getGrowthAssetRoot())).toEqual([]);
  });

  it("rejects traversal, missing, URL-only, and generated asset files", async () => {
    const root = assets.getGrowthAssetRoot();
    await mkdir(root, { recursive: true });
    await writeFile(resolve(TMP_DIR, "secret.png"), "secret");
    const traversal = store.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "upload",
      path: "../secret.png",
      title: "Traversal",
      alt: "Traversal",
    });
    const missing = store.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "upload",
      path: "missing.png",
      title: "Missing",
      alt: "Missing",
    });
    const remote = store.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "website",
      url: "https://example.com/image.png",
      title: "Remote",
      alt: "Remote",
    });
    const generated = store.createGrowthAsset({
      accountId: "account-a",
      repository: "acme/rocket",
      kind: "image",
      origin: "generated",
      cardTemplate: "release",
      cardData: { title: "Release" },
      title: "Generated",
      alt: "Generated",
    });

    await expect(assets.readGrowthAssetFile("account-a", traversal.id)).resolves.toBeNull();
    await expect(assets.readGrowthAssetFile("account-a", missing.id)).resolves.toBeNull();
    await expect(assets.readGrowthAssetFile("account-a", remote.id)).resolves.toBeNull();
    await expect(assets.readGrowthAssetFile("account-a", generated.id)).resolves.toBeNull();
  });

  it("validates metadata before creating a file", async () => {
    await expect(upload({ repository: "invalid" })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ filename: "../release.png" })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ title: " " })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ alt: "" })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ width: 0 })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    await expect(upload({ height: 100_001 })).rejects.toBeInstanceOf(assets.GrowthAssetValidationError);
    expect(store.listGrowthAssets("account-a", "acme/rocket")).toEqual([]);
    await expect(readdir(assets.getGrowthAssetRoot())).rejects.toMatchObject({ code: "ENOENT" });
  });
});
