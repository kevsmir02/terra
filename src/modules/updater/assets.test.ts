import { describe, expect, it } from "vitest";
import { isNewer, selectAsset, type ReleaseAsset } from "./assets";

const asset = (name: string): ReleaseAsset => ({
  name,
  browser_download_url: `https://example.test/${name}`,
});

const ASSETS = [
  asset("Terra_0.8.6_amd64.deb"),
  asset("Terra_0.8.6_amd64.deb.sig"),
  asset("Terra-0.8.6-1.x86_64.rpm"),
  asset("Terra-0.8.6-1.x86_64.rpm.sig"),
  asset("Terra_0.8.6_amd64.AppImage"),
  asset("Terra_0.8.6_amd64.AppImage.sig"),
  asset("latest.json"),
];

describe("selectAsset", () => {
  it("pairs the rpm with its signature", () => {
    const picked = selectAsset("rpm", ASSETS);
    expect(picked?.pkg.name).toBe("Terra-0.8.6-1.x86_64.rpm");
    expect(picked?.sig.name).toBe("Terra-0.8.6-1.x86_64.rpm.sig");
  });

  it("pairs the deb with its signature", () => {
    const picked = selectAsset("deb", ASSETS);
    expect(picked?.pkg.name).toBe("Terra_0.8.6_amd64.deb");
    expect(picked?.sig.name).toBe("Terra_0.8.6_amd64.deb.sig");
  });

  it("never selects the .sig as the package", () => {
    expect(selectAsset("rpm", ASSETS)?.pkg.name.endsWith(".sig")).toBe(false);
  });

  it("returns null for an unsupported install kind", () => {
    expect(selectAsset("unsupported", ASSETS)).toBeNull();
  });

  it("returns null when the signature is missing", () => {
    expect(selectAsset("rpm", [asset("Terra-0.8.6-1.x86_64.rpm")])).toBeNull();
  });

  it("returns null when no matching package exists", () => {
    expect(selectAsset("rpm", [asset("Terra_0.8.6_amd64.deb")])).toBeNull();
  });

  it("ignores non-x86_64 rpm builds", () => {
    expect(
      selectAsset("rpm", [
        asset("Terra-0.8.6-1.aarch64.rpm"),
        asset("Terra-0.8.6-1.aarch64.rpm.sig"),
      ]),
    ).toBeNull();
  });
});

describe("isNewer", () => {
  it("detects a newer patch", () => {
    expect(isNewer("0.8.6", "0.8.5")).toBe(true);
  });

  it("rejects an equal version", () => {
    expect(isNewer("0.8.5", "0.8.5")).toBe(false);
  });

  it("rejects an older version", () => {
    expect(isNewer("0.8.4", "0.8.5")).toBe(false);
  });

  it("strips a leading v", () => {
    expect(isNewer("v0.9.0", "0.8.5")).toBe(true);
  });

  it("compares numerically, not lexically", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
  });

  it("treats a prerelease as older than its release", () => {
    expect(isNewer("0.9.0-beta1", "0.9.0")).toBe(false);
  });
});
