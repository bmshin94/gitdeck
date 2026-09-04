import { describe, expect, it } from "vitest";
import {
  createDefaultGrowthProfile,
  DEFAULT_GROWTH_CADENCE,
  DEFAULT_GROWTH_CHANNELS,
  DEFAULT_GROWTH_PILLARS,
  growthProfileColor,
} from "../../../src/utils/growth/profileDefaults";

describe("Growth profile defaults", () => {
  it("provides complete independent profile defaults", () => {
    const first = createDefaultGrowthProfile("account-a", "owner/repo");
    const second = createDefaultGrowthProfile("account-b", "owner/repo");

    expect(first.channels).toEqual(DEFAULT_GROWTH_CHANNELS);
    expect(first.cadence).toEqual(DEFAULT_GROWTH_CADENCE);
    expect(first.pillars).toEqual(DEFAULT_GROWTH_PILLARS);
    expect(first.pillars).not.toBe(second.pillars);
    expect(first.channels).not.toBe(second.channels);
    expect(first.pillars.every(({ weight }) => weight === 20)).toBe(true);
    expect(first.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("assigns a stable palette color from repository identity", () => {
    const color = growthProfileColor("owner/repo");
    expect(color).toMatch(/^#[0-9A-F]{6}$/);
    expect(growthProfileColor("owner/repo")).toBe(color);
    expect(createDefaultGrowthProfile("account-a", "owner/repo").color).toBe(color);
  });
});
