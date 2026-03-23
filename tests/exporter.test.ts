import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { SourceContent } from "@/lib/types";

vi.mock("@/lib/x", () => ({
  downloadBytes: vi.fn(async () => Buffer.from("image-bytes")),
}));

describe("writeSourceOutputs", () => {
  async function loadExporter() {
    vi.resetModules();
    return import("@/lib/exporter");
  }

  function makeSource(): SourceContent {
    return {
      url: "https://x.com/itsolelehmann/status/2033919415771713715?s=20",
      kind: "article",
      title: "Deep Research Notes",
      author: "Ada Lovelace (@ada)",
      published: "2026-03-23 11:30 UTC",
      body: "First paragraph.\n\n- Bullet one\n- Bullet two",
      note: "Captured from a regression fixture.",
      media: [
        {
          sourceUrl: "https://pbs.twimg.com/media/example-image.jpg",
          label: "example-image",
          kind: "image",
        },
      ],
    };
  }

  it("writes folderized outputs with descriptive filenames and nested assets", async () => {
    const { writeSourceOutputs } = await loadExporter();
    const outDir = await mkdtemp(path.join(tmpdir(), "exporter-test-"));

    const record = await writeSourceOutputs(makeSource(), outDir, new Set(["txt", "md", "html"]), true);

    expect(record.outputFiles).toEqual([
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).txt",
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).html",
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).md",
    ]);
    expect(record.mediaFiles).toEqual([
      "Deep-Research-Notes-2033919415771713715/assets/image-01.jpg",
    ]);

    const mdPath = path.join(outDir, record.outputFiles[2]);
    const htmlPath = path.join(outDir, record.outputFiles[1]);
    const assetPath = path.join(outDir, record.mediaFiles[0]);
    expect(existsSync(mdPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(assetPath)).toBe(true);

    const mdContent = await readFile(mdPath, "utf8");
    expect(mdContent).toContain("![Image 1](assets/image-01.jpg)");
  });

  it("adds a pdf output when the injected pdf renderer succeeds", async () => {
    const { writeSourceOutputs } = await loadExporter();
    const outDir = await mkdtemp(path.join(tmpdir(), "exporter-pdf-success-"));
    const pdfRenderer = vi.fn(async (_htmlPath: string, pdfPath: string) => {
      await import("node:fs/promises").then(({ writeFile }) => writeFile(pdfPath, "pdf-bytes"));
      return true;
    });

    const record = await writeSourceOutputs(makeSource(), outDir, new Set(["html", "pdf"]), false, {
      pdfRenderer,
    });

    expect(pdfRenderer).toHaveBeenCalledTimes(1);
    expect(record.outputFiles).toEqual([
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).html",
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).pdf",
    ]);
    expect(existsSync(path.join(outDir, record.outputFiles[1]))).toBe(true);
  });

  it("keeps the batch usable when pdf rendering is unavailable", async () => {
    const { writeSourceOutputs } = await loadExporter();
    const outDir = await mkdtemp(path.join(tmpdir(), "exporter-pdf-unavailable-"));
    const source = makeSource();

    const record = await writeSourceOutputs(source, outDir, new Set(["html", "pdf"]), false, {
      pdfRenderer: vi.fn(async () => false),
    });

    expect(record.outputFiles).toEqual([
      "Deep-Research-Notes-2033919415771713715/Deep Research Notes - Ada Lovelace (@ada).html",
    ]);
    expect(record.note).toContain("Captured from a regression fixture.");
    expect(record.note).toContain("PDF export was requested, but browser-based PDF generation was not available.");
  });
});
