import { describe, expect, it } from "vitest";

import { buildDriveUploadPlan } from "@/lib/google-drive";
import type { JobResult } from "@/lib/types";

function makeJobResult(): JobResult {
  return {
    jobId: "job-12345678",
    createdAt: 1_774_000_000_000,
    status: "done",
    outDirName: "folderized-check",
    failures: [],
    manifestFile: "manifest.json",
    guideFile: "README-IMPORT.md",
    bundleFile: "notebooklm_sources.zip",
    records: [
      {
        url: "https://x.com/example/status/1",
        kind: "article",
        title: "First Article",
        author: "Author One",
        published: "2026-03-23T10:00:00.000Z",
        outputFiles: [
          "First-Article-203/source.txt",
          "First-Article-203/source.md",
          "First-Article-203/source.html",
          "First-Article-203/source.pdf",
        ],
        mediaFiles: [
          "First-Article-203/assets/cover.png",
          "First-Article-203/assets/inline/chart.webp",
        ],
      },
      {
        url: "https://x.com/example/status/2",
        kind: "tweet",
        title: "Second Tweet",
        author: "Author Two",
        published: "2026-03-23T11:00:00.000Z",
        outputFiles: [
          "Second-Tweet-20/Second Tweet - Author Two.txt",
          "Second-Tweet-20/Second Tweet - Author Two.md",
          "Second-Tweet-20/Second Tweet - Author Two.html",
          "Second-Tweet-20/Second Tweet - Author Two.pdf",
        ],
        mediaFiles: ["Second-Tweet-20/assets/avatar.jpg"],
      },
    ],
  };
}

describe("buildDriveUploadPlan", () => {
  it("preserves root files and nested relative paths without flattening", () => {
    const plan = buildDriveUploadPlan(makeJobResult());

    expect(plan.files.map((entry) => entry.relativeFile)).toEqual([
      "First-Article-203/assets/cover.png",
      "First-Article-203/assets/inline/chart.webp",
      "First-Article-203/source.html",
      "First-Article-203/source.md",
      "First-Article-203/source.pdf",
      "First-Article-203/source.txt",
      "manifest.json",
      "notebooklm_sources.zip",
      "README-IMPORT.md",
      "Second-Tweet-20/assets/avatar.jpg",
      "Second-Tweet-20/Second Tweet - Author Two.html",
      "Second-Tweet-20/Second Tweet - Author Two.md",
      "Second-Tweet-20/Second Tweet - Author Two.pdf",
      "Second-Tweet-20/Second Tweet - Author Two.txt",
    ]);

    const nestedAsset = plan.files.find((entry) => entry.relativeFile === "First-Article-203/assets/inline/chart.webp");
    expect(nestedAsset).toEqual({
      relativeFile: "First-Article-203/assets/inline/chart.webp",
      fileName: "chart.webp",
      folderSegments: ["First-Article-203", "assets", "inline"],
      folderPaths: ["First-Article-203", "First-Article-203/assets", "First-Article-203/assets/inline"],
    });

    expect(plan.files.some((entry) => entry.fileName === "First-Article-203/assets/inline/chart.webp")).toBe(false);
  });

  it("returns folder creation order from parents to children", () => {
    const plan = buildDriveUploadPlan(makeJobResult());

    expect(plan.folders).toEqual([
      "First-Article-203",
      "Second-Tweet-20",
      "First-Article-203/assets",
      "Second-Tweet-20/assets",
      "First-Article-203/assets/inline",
    ]);
  });
});
