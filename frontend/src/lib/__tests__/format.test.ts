import { describe, expect, it } from "vitest";
import { withCitationLinks } from "@/lib/citations";
import { cn, formatBytes, formatMs, providerLabel, sourceMeta, timeAgo } from "@/lib/format";

describe("withCitationLinks", () => {
  it("turns numeric references into citation anchors", () => {
    expect(withCitationLinks("Use the VPN client [1].")).toBe("Use the VPN client [1](#cite-1).");
  });

  it("normalises full-width brackets emitted by some models", () => {
    expect(withCitationLinks("Reset it 【2】 now")).toBe("Reset it [2](#cite-2) now");
    expect(withCitationLinks("See 【3†L4-L9】")).toBe("See [3](#cite-3)");
  });

  it("splits grouped references", () => {
    expect(withCitationLinks("Done [1, 2]")).toBe("Done [1](#cite-1)[2](#cite-2)");
  });

  it("leaves real markdown links untouched", () => {
    expect(withCitationLinks("[1](https://x.com)")).toBe("[1](https://x.com)");
    expect(withCitationLinks("[docs](https://x.com)")).toBe("[docs](https://x.com)");
  });
});

describe("format helpers", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(27703)).toBe("27 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats milliseconds", () => {
    expect(formatMs(840)).toBe("840ms");
    expect(formatMs(2450)).toBe("2.5s");
  });

  it("describes relative time", () => {
    expect(timeAgo(new Date().toISOString())).toBe("just now");
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(timeAgo(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3d ago");
  });

  it("maps sources and providers to labels", () => {
    expect(sourceMeta("private_kb").label).toBe("Private KB");
    expect(sourceMeta("insufficient_evidence").tone).toBe("red");
    expect(sourceMeta("unknown").label).toBe("Failed");
    expect(providerLabel("gemini")).toBe("Gemini");
    expect(providerLabel("mistral")).toBe("Mistral");
    expect(providerLabel("")).toBe("—");
  });

  it("joins class names", () => {
    expect(cn("a", false, null, "b", undefined)).toBe("a b");
  });
});
