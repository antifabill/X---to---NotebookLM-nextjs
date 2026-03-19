import AdmZip from "adm-zip";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { safeFileName, slugify } from "@/lib/text";
import type { SourceContent, SourceRecord } from "@/lib/types";
import { downloadBytes } from "@/lib/x";

function safeExtensionFromUrl(url: string, fallback = ".jpg") {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : fallback;
  } catch {
    return fallback;
  }
}

async function downloadMediaAssets(source: SourceContent, assetDir: string) {
  const saved: string[] = [];
  if (!source.media.length) return saved;
  await mkdir(assetDir, { recursive: true });
  for (const [index, asset] of source.media.entries()) {
    const fileName = `image-${String(index + 1).padStart(2, "0")}${safeExtensionFromUrl(asset.sourceUrl)}`;
    const target = path.join(assetDir, fileName);
    await writeFile(target, await downloadBytes(asset.sourceUrl));
    asset.localPath = target;
    saved.push(path.relative(path.dirname(assetDir), target).replaceAll("\\", "/"));
  }
  return saved;
}

function sourceIdentifier(url: string) {
  const pathname = new URL(url).pathname;
  const tweetMatch = /\/status\/(\d+)/.exec(pathname);
  if (tweetMatch?.[1]) return tweetMatch[1];
  const articleMatch = /\/(?:i\/)?article\/(\d+)/.exec(pathname);
  if (articleMatch?.[1]) return articleMatch[1];
  const base = path.basename(pathname);
  return base || "source";
}

function outputBaseName(source: SourceContent) {
  const title = safeFileName(source.title, 120);
  const author = safeFileName(source.author || "Unknown author", 80);
  return safeFileName(`${title} - ${author}`, 180);
}

function buildHeader(source: SourceContent) {
  const lines = [source.title, "=".repeat(source.title.length), "", "Metadata", "--------", `Source: ${source.url}`];
  if (source.author) lines.push(`Author: ${source.author}`);
  if (source.published) lines.push(`Published: ${source.published}`);
  if (source.note) lines.push(`Note: ${source.note}`);
  lines.push("", "Content", "-------", "");
  return lines;
}

function makeTxtContent(source: SourceContent, baseDir: string) {
  const lines = buildHeader(source);
  lines.push(source.body.trim());
  const mediaPaths = relativeMediaPaths(source, baseDir);
  if (mediaPaths.length) {
    lines.push("", "Images", "------");
    for (const mediaPath of mediaPaths) lines.push(`- ${mediaPath}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function relativeMediaPaths(source: SourceContent, baseDir: string) {
  return source.media
    .map((asset) => asset.localPath)
    .filter(Boolean)
    .map((assetPath) => path.relative(baseDir, assetPath as string).replaceAll("\\", "/"));
}

function makeMdContent(source: SourceContent, baseDir: string) {
  const lines = [
    "---",
    `title: "${source.title.replaceAll('"', "'")}"`,
    `kind: "${source.kind}"`,
    `source_url: "${source.url}"`,
  ];
  if (source.author) lines.push(`author: "${source.author.replaceAll('"', "'")}"`);
  if (source.published) lines.push(`published: "${source.published.replaceAll('"', "'")}"`);
  lines.push("---", "", `# ${source.title}`, "", "## Source Metadata", "", `- Source: ${source.url}`);
  if (source.author) lines.push(`- Author: ${source.author}`);
  if (source.published) lines.push(`- Published: ${source.published}`);
  if (source.note) lines.push(`- Note: ${source.note}`);
  lines.push("", "## Content", "", source.body.trim());
  const mediaPaths = relativeMediaPaths(source, baseDir);
  if (mediaPaths.length) lines.push("", "## Images");
  for (const [index, mediaPath] of mediaPaths.entries()) lines.push("", `![Image ${index + 1}](${mediaPath})`);
  return `${lines.join("\n").trim()}\n`;
}

function bodyTextToHtml(body: string) {
  const lines = body.split("\n");
  const parts: string[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  let ordered = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    parts.push(`<p>${paragraph.join(" ")}</p>`);
    paragraph.length = 0;
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = ordered ? "ol" : "ul";
    parts.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
    listItems.length = 0;
    ordered = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() || "";
    const nextLine = lines[index + 1]?.trim() || "";
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (nextLine && /^-{3,}$/.test(nextLine)) {
      flushParagraph();
      flushList();
      parts.push(`<h2>${line}</h2>`);
      index += 1;
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      parts.push(`<h3>${line.slice(4)}</h3>`);
      continue;
    }
    const unordered = /^- (.+)/.exec(line);
    const orderedMatch = /^1\. (.+)/.exec(line);
    if (unordered || orderedMatch) {
      flushParagraph();
      const isOrdered = Boolean(orderedMatch);
      if (listItems.length && ordered !== isOrdered) flushList();
      ordered = isOrdered;
      listItems.push(unordered?.[1] || orderedMatch?.[1] || line);
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return parts.join("\n");
}

function makeHtmlSnapshot(source: SourceContent, baseDir: string) {
  const metadata = [
    `<p class="source">Source: <a href="${source.url}">${source.url}</a></p>`,
    source.author ? `<p><strong>Author:</strong> ${source.author}</p>` : "",
    source.published ? `<p><strong>Published:</strong> ${source.published}</p>` : "",
    source.note ? `<p class="note"><strong>Note:</strong> ${source.note}</p>` : "",
  ].join("");

  const images = relativeMediaPaths(source, baseDir)
    .map(
      (mediaPath, index) => `
      <figure>
        <img src="${mediaPath}" alt="Image ${index + 1}">
        <figcaption>Image ${index + 1}</figcaption>
      </figure>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${source.title}</title>
  <style>
    :root { --ink:#1e2330; --muted:#596579; --panel:rgba(255,255,255,0.78); --line:#d6c8b5; --accent:#cb5f34; }
    body { margin:0; background:radial-gradient(circle at top left, rgba(203,95,52,0.16), transparent 30%), linear-gradient(180deg, #efe4d1 0%, #f5efe4 100%); color:var(--ink); font:17px/1.7 "Iowan Old Style", "Palatino Linotype", Georgia, serif; }
    main { max-width:860px; margin:0 auto; padding:42px 24px 72px; }
    h1 { margin:0 0 18px; font-size:2.6rem; line-height:1.05; }
    .meta { padding:18px 20px; background:var(--panel); border:1px solid var(--line); border-radius:18px; margin-bottom:24px; }
    article { padding:24px; border-radius:22px; background:var(--panel); border:1px solid var(--line); }
    .source,.note { color:var(--muted); }
    h2,h3 { margin-top:1.8rem; color:var(--accent); }
    p { margin:0 0 1rem; }
    ul,ol { margin:0 0 1rem 1.4rem; }
    figure { margin:24px 0; padding:12px; background:rgba(255,255,255,0.84); border:1px solid var(--line); border-radius:18px; }
    img { display:block; max-width:100%; margin:0 auto; border-radius:12px; }
    figcaption { margin-top:10px; color:var(--muted); text-align:center; font-size:0.95rem; }
  </style>
</head>
<body>
  <main>
    <h1>${source.title}</h1>
    <section class="meta">${metadata}</section>
    <article>${bodyTextToHtml(source.body)}${images}</article>
  </main>
</body>
</html>`;
}

function localBrowserBinary() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

async function resolveBrowserLaunchOptions() {
  const localBrowser = localBrowserBinary();
  if (localBrowser) {
    return {
      executablePath: localBrowser,
      args: ["--allow-file-access-from-files"],
    };
  }

  try {
    const chromium = await import("@sparticuz/chromium");
    const executablePath = await chromium.default.executablePath();
    if (!executablePath) return null;
    return {
      executablePath,
      args: [...chromium.default.args, "--allow-file-access-from-files"],
    };
  } catch {
    return null;
  }
}

async function htmlToPdf(htmlPath: string, pdfPath: string) {
  const launchOptions = await resolveBrowserLaunchOptions();
  if (!launchOptions) return false;

  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({
      executablePath: launchOptions.executablePath,
      args: launchOptions.args,
      headless: true,
    });

    try {
      const page = await browser.newPage();
      const baseHref = pathToFileURL(`${path.dirname(htmlPath)}${path.sep}`).toString();
      const html = await readFile(htmlPath, "utf8");
      const htmlWithBase = html.includes("<head>")
        ? html.replace("<head>", `<head><base href="${baseHref}">`)
        : `<base href="${baseHref}">${html}`;
      await page.setContent(htmlWithBase, { waitUntil: "networkidle" });
      await page.pdf({
        path: pdfPath,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        margin: {
          top: "18mm",
          right: "14mm",
          bottom: "18mm",
          left: "14mm",
        },
      });
      return true;
    } finally {
      await browser.close();
    }
  } catch {
    return false;
  }
}

export async function writeSourceOutputs(source: SourceContent, outDir: string, exportFormats: Set<string>, includeMedia: boolean): Promise<SourceRecord> {
  const sourceDirName = slugify(`${source.title}-${sourceIdentifier(source.url)}`);
  const sourceDir = path.join(outDir, sourceDirName);
  const assetDir = path.join(sourceDir, "assets");
  const baseName = outputBaseName(source);

  await mkdir(sourceDir, { recursive: true });

  const mediaFiles = includeMedia
    ? (await downloadMediaAssets(source, assetDir)).map((file) => `${sourceDirName}/${file}`)
    : [];
  const outputFiles: string[] = [];

  if (exportFormats.has("txt")) {
    const txtName = `${baseName}.txt`;
    await writeFile(path.join(sourceDir, txtName), makeTxtContent(source, sourceDir), "utf8");
    outputFiles.push(`${sourceDirName}/${txtName}`);
  }

  let htmlName: string | null = null;
  if (exportFormats.has("html") || exportFormats.has("pdf")) {
    htmlName = `${baseName}.html`;
    await writeFile(path.join(sourceDir, htmlName), makeHtmlSnapshot(source, sourceDir), "utf8");
    if (exportFormats.has("html")) outputFiles.push(`${sourceDirName}/${htmlName}`);
  }

  if (exportFormats.has("md")) {
    const mdName = `${baseName}.md`;
    await writeFile(path.join(sourceDir, mdName), makeMdContent(source, sourceDir), "utf8");
    outputFiles.push(`${sourceDirName}/${mdName}`);
  }

  if (exportFormats.has("pdf") && htmlName) {
    const pdfName = `${baseName}.pdf`;
    if (await htmlToPdf(path.join(sourceDir, htmlName), path.join(sourceDir, pdfName))) {
      outputFiles.push(`${sourceDirName}/${pdfName}`);
    } else {
      source.note = `${source.note ? `${source.note} ` : ""}PDF export was requested, but browser-based PDF generation was not available.`;
    }
  }

  return {
    url: source.url,
    kind: source.kind,
    title: source.title,
    author: source.author,
    published: source.published,
    outputFiles,
    mediaFiles,
    note: source.note,
  };
}

export async function buildManifest(records: SourceRecord[], outDir: string) {
  const manifestFile = "manifest.json";
  await writeFile(path.join(outDir, manifestFile), JSON.stringify(records, null, 2), "utf8");
  return manifestFile;
}

export async function buildBatchGuide(records: SourceRecord[], failures: Array<[string, string]>, outDir: string) {
  const lines = [
    "# NotebookLM Import Guide",
    "",
    "This folder was generated by the Next.js migration of X to NotebookLM.",
    "",
    "## Recommended upload flow",
    "",
    "1. Open NotebookLM.",
    "2. Create a notebook or open an existing one.",
    "3. Add the `.md`, `.txt`, or `.pdf` files from this folder.",
    "",
    "## Sources in this batch",
    "",
  ];
  for (const record of records) {
    lines.push(`### ${record.title}`, "", `- Source URL: ${record.url}`);
    if (record.author) lines.push(`- Author: ${record.author}`);
    if (record.published) lines.push(`- Published: ${record.published}`);
    lines.push("- Files:");
    for (const file of [...record.outputFiles, ...record.mediaFiles]) lines.push(`  - ${file}`);
    if (record.note) lines.push(`- Note: ${record.note}`);
    lines.push("");
  }
  if (failures.length) {
    lines.push("## Failed URLs", "");
    for (const [url, reason] of failures) lines.push(`- ${url}: ${reason}`);
    lines.push("");
  }
  const guideFile = "README-IMPORT.md";
  await writeFile(path.join(outDir, guideFile), `${lines.join("\n").trim()}\n`, "utf8");
  return guideFile;
}

async function addDirectoryToZip(zip: AdmZip, dir: string, prefix = ""): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipName = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, zipName);
    } else {
      zip.addFile(zipName.replaceAll("\\", "/"), await readFile(fullPath));
    }
  }
}

export async function buildZip(outDir: string) {
  const zipFile = "notebooklm_sources.zip";
  const zip = new AdmZip();
  await addDirectoryToZip(zip, outDir);
  zip.deleteFile(zipFile);
  zip.writeZip(path.join(outDir, zipFile));
  return zipFile;
}
