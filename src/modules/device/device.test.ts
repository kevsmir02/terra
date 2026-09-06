import { describe, expect, it } from "vitest";
import { deviceDisplayName, isReady } from "./device";

describe("deviceDisplayName", () => {
  it("replaces underscores in the model with spaces", () => {
    expect(
      deviceDisplayName({
        serial: "emulator-5554",
        state: "device",
        model: "Pixel_8_Pro",
      }),
    ).toBe("Pixel 8 Pro");
  });

  it("falls back to the serial when there is no model", () => {
    expect(
      deviceDisplayName({ serial: "emulator-5554", state: "device" }),
    ).toBe("emulator-5554");
  });

  it("falls back to the serial when the model is blank", () => {
    expect(
      deviceDisplayName({
        serial: "emulator-5554",
        state: "device",
        model: "   ",
      }),
    ).toBe("emulator-5554");
  });
});

describe("isReady", () => {
  it('is true when the state is "device"', () => {
    expect(isReady({ serial: "emulator-5554", state: "device" })).toBe(true);
  });

  it("is false for any other state", () => {
    expect(isReady({ serial: "emulator-5554", state: "offline" })).toBe(false);
    expect(
      isReady({ serial: "192.168.1.42:5555", state: "unauthorized" }),
    ).toBe(false);
  });
});
