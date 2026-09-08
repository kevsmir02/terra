import { describe, expect, it } from "vitest";
import { PDF_FRAME_SANDBOX } from "./pdfFrame";

const tokens = PDF_FRAME_SANDBOX.split(/\s+/);

describe("PDF frame sandbox", () => {
  it("keeps the viewer's origin so WebKit's PDF.js can fetch the document", () => {
    expect(tokens).toContain("allow-scripts");
    expect(tokens).toContain("allow-same-origin");
  });

  it("never grants navigation, popups, forms, modals or downloads", () => {
    for (const token of tokens) {
      expect(token).not.toMatch(
        /^allow-(top-navigation|popups|forms|modals|downloads|pointer-lock|presentation)/,
      );
    }
  });
});
