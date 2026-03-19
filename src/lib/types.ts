export type MediaAsset = {
  sourceUrl: string;
  label: string;
  localPath?: string;
  kind: "image";
};

export type SourceContent = {
  url: string;
  kind: "tweet" | "article" | "page";
  title: string;
  author: string | null;
  published: string | null;
  body: string;
  note?: string | null;
  media: MediaAsset[];
};

export type SourceRecord = {
  url: string;
  kind: SourceContent["kind"];
  title: string;
  author: string | null;
  published: string | null;
  outputFiles: string[];
  mediaFiles: string[];
  note?: string | null;
};

export type PreviewPayload = {
  ok: boolean;
  url?: string;
  kind?: string;
  title?: string;
  author?: string | null;
  published?: string | null;
  excerpt?: string;
  mediaCount?: number;
  note?: string | null;
  error?: string;
};

export type BatchInput = {
  urls: string[];
  folderName?: string;
  exportFormats: Array<"txt" | "md" | "pdf" | "html">;
  includeMedia: boolean;
};

export type JobResult = {
  jobId: string;
  createdAt: number;
  status: "done";
  outDirName: string;
  records: SourceRecord[];
  failures: Array<[string, string]>;
  manifestFile: string;
  guideFile: string;
  bundleFile: string;
};

export type DriveAccount = {
  email: string;
  name?: string | null;
  picture?: string | null;
};

export type DriveClientState = {
  status: "unavailable" | "disconnected" | "connecting" | "connected";
  message: string;
  account?: DriveAccount | null;
};
