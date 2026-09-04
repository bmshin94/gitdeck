import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GrowthAssetLibrary } from "../../../src/components/growth/GrowthAssetLibrary";
import { I18nProvider } from "../../../src/i18n/I18nProvider";
import type { GrowthAssetMetadata } from "../../../src/types/growth";

const mocks = vi.hoisted(() => ({
  buildGrowthAssetFileUrl: vi.fn((id: string) => `/api/growth/assets/${id}/file`),
  fetchGrowthAssets: vi.fn(),
  uploadGrowthAsset: vi.fn(),
}));

vi.mock("../../../src/api/growth", () => ({
  buildGrowthAssetFileUrl: mocks.buildGrowthAssetFileUrl,
  fetchGrowthAssets: mocks.fetchGrowthAssets,
  uploadGrowthAsset: mocks.uploadGrowthAsset,
}));

function asset(overrides: Partial<GrowthAssetMetadata> = {}): GrowthAssetMetadata {
  return {
    id: "asset-image",
    accountId: "account-a",
    repository: "acme/rocket",
    kind: "image",
    origin: "upload",
    url: null,
    title: "Release dashboard",
    alt: "A dashboard showing the latest release",
    width: 1200,
    height: 630,
    cardTemplate: null,
    cardData: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

let container: HTMLDivElement;
let root: Root;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.fetchGrowthAssets.mockResolvedValue([]);
  mocks.uploadGrowthAsset.mockResolvedValue(asset());

  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test-asset") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.stubGlobal("Image", class {
    naturalWidth = 1200;
    naturalHeight = 630;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
});

async function renderLibrary(accountId = "account-a", repository = "acme/rocket") {
  await act(async () => {
    root.render(createElement(
      I18nProvider,
      null,
      createElement(GrowthAssetLibrary, {
        accountId,
        enabled: true,
        repository,
      }),
    ));
    await flush();
  });
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (!element) throw new Error(`Missing field ${id}`);
  return element;
}

async function fillUpload(file: File, title = "Release dashboard", alt = "A dashboard showing the latest release") {
  await act(async () => {
    selectFile(field("growth-asset-file") as HTMLInputElement, file);
    setValue(field("growth-asset-title"), title);
    setValue(field("growth-asset-alt"), alt);
  });
}

async function submitUpload() {
  await act(async () => {
    container.querySelector(".growth-asset-upload")?.dispatchEvent(new Event("submit", {
      bubbles: true,
      cancelable: true,
    }));
    await flush();
  });
}

describe("GrowthAssetLibrary", () => {
  it("renders localized loading, empty, and request-error states", async () => {
    let resolveAssets: ((assets: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets.mockImplementationOnce(() => new Promise<GrowthAssetMetadata[]>((resolve) => {
      resolveAssets = resolve;
    }));

    await renderLibrary();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading repository assets");

    await act(async () => {
      resolveAssets?.([]);
      await flush();
    });
    expect(container.textContent).toContain("No assets yet");

    mocks.fetchGrowthAssets.mockRejectedValueOnce(new Error("library unavailable"));
    await renderLibrary("account-b");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("library unavailable");
  });

  it("reloads for account and repository changes and ignores aborted stale lists", async () => {
    let resolveOld: ((assets: GrowthAssetMetadata[]) => void) | undefined;
    mocks.fetchGrowthAssets
      .mockImplementationOnce(() => new Promise<GrowthAssetMetadata[]>((resolve) => {
        resolveOld = resolve;
      }))
      .mockResolvedValueOnce([asset({ id: "account-b", accountId: "account-b", title: "Account B asset" })])
      .mockResolvedValueOnce([asset({ id: "comet", accountId: "account-b", repository: "acme/comet", title: "Comet asset" })]);

    await renderLibrary("account-a", "acme/rocket");
    const staleSignal = mocks.fetchGrowthAssets.mock.calls[0][1] as AbortSignal;

    await renderLibrary("account-b", "acme/rocket");
    expect(staleSignal.aborted).toBe(true);
    expect(container.textContent).toContain("Account B asset");

    await renderLibrary("account-b", "acme/comet");
    expect(mocks.fetchGrowthAssets.mock.calls.map((call) => call[0])).toEqual([
      "acme/rocket",
      "acme/rocket",
      "acme/comet",
    ]);
    expect(container.textContent).toContain("Comet asset");

    await act(async () => {
      resolveOld?.([asset({ id: "stale", title: "Stale account asset" })]);
      await flush();
    });
    expect(container.textContent).not.toContain("Stale account asset");
  });

  it("validates required metadata, supported types, and the file size before upload", async () => {
    await renderLibrary();
    await fillUpload(new File(["<svg />"], "card.svg", { type: "image/svg+xml" }));
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("PNG, JPEG, WebP, GIF, MP4, or WebM");
    expect(mocks.uploadGrowthAsset).not.toHaveBeenCalled();

    const oversized = new File(["x"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 25 * 1024 * 1024 + 1 });
    await fillUpload(oversized);
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("25 MiB limit");

    await fillUpload(new File(["png"], "release.png", { type: "image/png" }), "Release", " ");
    await submitUpload();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("useful alt text");
    expect(mocks.uploadGrowthAsset).not.toHaveBeenCalled();
  });

  it("renders upload request errors without resetting the form", async () => {
    mocks.uploadGrowthAsset.mockRejectedValueOnce(new Error("upload unavailable"));
    await renderLibrary();
    await fillUpload(new File(["video"], "demo.webm", { type: "video/webm" }), "Demo video", "A demo walkthrough");
    await submitUpload();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("upload unavailable");
    expect((field("growth-asset-title") as HTMLInputElement).value).toBe("Demo video");
    expect((field("growth-asset-alt") as HTMLTextAreaElement).value).toBe("A demo walkthrough");
    expect(mocks.fetchGrowthAssets).toHaveBeenCalledTimes(1);
  });

  it("uploads with browser image dimensions, reports progress, resets, and refreshes the list", async () => {
    let resolveUpload: ((asset: GrowthAssetMetadata) => void) | undefined;
    const saved = asset();
    mocks.uploadGrowthAsset.mockImplementationOnce(() => new Promise<GrowthAssetMetadata>((resolve) => {
      resolveUpload = resolve;
    }));
    mocks.fetchGrowthAssets.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
    await renderLibrary();
    await fillUpload(new File(["png bytes"], "release.png", { type: "image/png" }));

    await act(async () => {
      container.querySelector(".growth-asset-upload")?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
      await flush();
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Uploading the asset");
    expect(mocks.uploadGrowthAsset).toHaveBeenCalledWith({
      repository: "acme/rocket",
      file: expect.any(File),
      filename: "release.png",
      title: "Release dashboard",
      alt: "A dashboard showing the latest release",
      width: 1200,
      height: 630,
    }, expect.any(AbortSignal));

    await act(async () => {
      resolveUpload?.(saved);
      await flush();
    });
    expect(mocks.fetchGrowthAssets).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Asset uploaded.");
    expect(container.textContent).toContain("Release dashboard");
    expect((field("growth-asset-title") as HTMLInputElement).value).toBe("");
    expect((field("growth-asset-alt") as HTMLTextAreaElement).value).toBe("");
  });

  it("aborts an active upload when the account changes", async () => {
    let resolveUpload: ((asset: GrowthAssetMetadata) => void) | undefined;
    mocks.uploadGrowthAsset.mockImplementationOnce((_input, signal: AbortSignal) => new Promise<GrowthAssetMetadata>((resolve) => {
      resolveUpload = resolve;
      expect(signal.aborted).toBe(false);
    }));
    await renderLibrary();
    await fillUpload(new File(["video"], "demo.mp4", { type: "video/mp4" }));
    await submitUpload();
    const uploadSignal = mocks.uploadGrowthAsset.mock.calls[0][1] as AbortSignal;

    await renderLibrary("account-b");
    expect(uploadSignal.aborted).toBe(true);
    await act(async () => {
      resolveUpload?.(asset({ id: "stale-upload", title: "Stale upload" }));
      await flush();
    });
    expect(container.textContent).not.toContain("Stale upload");
  });

  it.each([1440, 390])("keeps accessible controls and authenticated previews at %ipx", async (width) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    mocks.fetchGrowthAssets.mockResolvedValueOnce([
      asset(),
      asset({
        id: "asset-video",
        kind: "video",
        title: "Release walkthrough",
        alt: "A walkthrough of the release flow",
        width: 1920,
        height: 1080,
      }),
    ]);
    await renderLibrary();

    const fileInput = field("growth-asset-file") as HTMLInputElement;
    expect(document.querySelector('label[for="growth-asset-file"]')).not.toBeNull();
    expect(document.querySelector('label[for="growth-asset-title"]')).not.toBeNull();
    expect(document.querySelector('label[for="growth-asset-alt"]')).not.toBeNull();
    expect(fileInput.required).toBe(true);
    expect(fileInput.accept).toContain("image/png");
    expect(fileInput.accept).toContain("video/webm");

    const image = container.querySelector<HTMLImageElement>("img");
    const video = container.querySelector<HTMLVideoElement>("video");
    expect(image?.src).toContain("/api/growth/assets/asset-image/file");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(video?.src).toContain("/api/growth/assets/asset-video/file");
    expect(video?.preload).toBe("metadata");
    expect(video?.getAttribute("aria-label")).toContain("Release walkthrough");
    expect(container.textContent).toContain("1200 × 630 px");
    expect(container.textContent).toContain("A walkthrough of the release flow");
    expect(container.querySelectorAll(".growth-asset-card")).toHaveLength(2);
  });
});
