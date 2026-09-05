import { describe, expect, it } from "vitest";
import { deviceDisplayName } from "./device";

describe("deviceDisplayName", () => {
  it("replaces underscores in the model with spaces", () => {
    expect(
      deviceDisplayName({ serial: "emulator-5554", state: "device", model: "Pixel_8_Pro" }),
    ).toBe("Pixel 8 Pro");
  });

  it("falls back to the serial when there is no model", () => {
    expect(deviceDisplayName({ serial: "emulator-5554", state: "device" })).toBe(
      "emulator-5554",
    );
  });

  it("falls back to the serial when the model is blank", () => {
    expect(deviceDisplayName({ serial: "emulator-5554", state: "device", model: "   " })).toBe(
      "emulator-5554",
    );
  });
});
