# Codex Operator Prompt

Use this as the starting prompt for another Codex operator taking over the project.

## Copy/Paste Prompt

```text
You are continuing work on the project in the local Next.js repo:
.../X---to---NotebookLM-nextjs

Start by reading these files first:
1. HANDOFF.md
2. roadmap.md

Project context:
- This is the active Next.js version of "X to NotebookLM".
- It converts X.com tweets and X Articles into NotebookLM-friendly exports.
- It can generate TXT, MD, HTML, PDF, download images, package batches, and upload the batch to Google Drive.
- The live app is deployed on Firebase App Hosting.
- Google Drive browser sign-in is already working.
- The `/api/process` route defaults to TXT, MD, PDF, and HTML when `exportFormats` is omitted.
- Cloud storage is enabled when `APP_STORAGE_BUCKET`, `FIREBASE_STORAGE_BUCKET`, or `GCS_STORAGE_BUCKET` is set; local dev uses `.data/jobs`, and hosted mode without a bucket falls back to temp storage.

Recent important state:
- Quote-tweets that reference tweets with attached X Articles were fixed so they now export the full quoted article body instead of only the outer tweet text.
- Exports were restructured so each source gets its own folder:
  <batch>/<source-slug>/<title> - <author>.txt
  <batch>/<source-slug>/<title> - <author>.md
  <batch>/<source-slug>/<title> - <author>.html
  <batch>/<source-slug>/<title> - <author>.pdf
  <batch>/<source-slug>/assets/...
- The Drive uploader is expected to preserve that relative folder structure.
- PDF export is generated with `playwright-core` using either a detected local Chromium-based browser or `@sparticuz/chromium` when available.
- Hosted PDF generation is now verified live on Firebase App Hosting; it is no longer an open viability question.
- The live Google Drive upload flow is now verified end to end, including nested source folders and the expected `PDF`, `MD`, `TXT`, `HTML`, and `assets` contents in Drive.

Important test URLs:
- Quote-tweet/article case:
  https://x.com/LLMJunky/status/2031802820924436506?s=20
- Existing article-backed tweet case:
  https://x.com/itsolelehmann/status/2033919415771713715?s=20
- Plain tweet case:
  https://x.com/jack/status/20

Current priority:
1. Add regression coverage for:
   - quote-tweets that reference article-backed tweets
   - folderized exports
   - Drive path preservation
2. Harden the hosted PDF/export pipeline so the App Hosting fix stays stable across future dependency/runtime changes.
3. Keep roadmap.md updated as tasks are completed.

Important constraints:
- Prefer the Next.js repo over the legacy Python repo for all new work.
- Do not undo the folderized export structure unless there is a very strong reason.
- Do not start the big UI redesign yet unless it is necessary for a blocking fix.
- Keep the user informed with short progress updates while working.

Before making changes:
- inspect the current repo state
- run the relevant tests or local verification
- then implement the next roadmap item carefully

After making changes:
- run lint/build
- verify the real behavior, not only the code path
- summarize what changed, what was verified, and what remains
```

## Notes

- `HANDOFF.md` is the detailed continuation brief.
- `roadmap.md` is the current tracked task list.
- This file is intentionally short and optimized for copy/paste into another Codex session.
