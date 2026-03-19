# X to NotebookLM Next.js Handoff

Last updated: 2026-03-19

## Purpose

This file is a transfer-ready handoff for another Codex session or collaborator.

The goal of the project is:

- take X.com tweets / X Articles
- export them into NotebookLM-friendly source files
- support batch processing
- optionally upload the output to Google Drive
- eventually provide a cleaner handoff into NotebookLM

This handoff is intentionally more useful than a raw transcript. It captures the important decisions, current state, known limitations, and the next best tasks.

## Repositories

Original Python repo:

- GitHub: [https://github.com/antifabill/X---to---NotebookLM](https://github.com/antifabill/X---to---NotebookLM)
- Local workspace path: `.../X---to---NotebookLM`

Current active Next.js repo:

- GitHub: [https://github.com/antifabill/X---to---NotebookLM-nextjs](https://github.com/antifabill/X---to---NotebookLM-nextjs)
- Local workspace path: `.../X---to---NotebookLM-nextjs`

The Next.js repo is the active product going forward.

## Current live app

- Live URL: [https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app](https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app)
- Firebase project: `promptsmith-63ac5`

## High-level history

1. The original GitHub repo started as an almost-empty placeholder.
2. A local Python app was built from scratch to:
   - fetch tweets / X Articles
   - export `.txt`, `.md`, `.pdf`, `.html`
   - download tweet/article images
   - package batches for NotebookLM
3. That Python app got a local web UI.
4. A new Next.js fork was then created so the project could move toward Firebase/web deployment.
5. Core extraction/export logic was ported into the Next.js app.
6. Google Drive upload was converted from a local desktop-style flow into a browser-based web flow.
7. The Next.js app was deployed to Firebase App Hosting and connected to GitHub deploys.
8. A later fix corrected quote-tweet article extraction and folderized exports.

## Recent important commits

- `69e90d9` Build local X to NotebookLM web app
- `4f2ba53` Create Next.js migration fork
- `f7fc44f` Add Drive web flow and Firebase deployment
- `c384efd` Enable live Google Drive client ID
- `6d12d4f` Fix quoted article exports and folderized Drive uploads

## What works now

### Core extraction

- Plain tweets can be exported.
- Article-backed tweets can be exported.
- Quote-tweets that reference a tweet with an attached X Article now export the full article body.
- Existing article-backed tweet behavior was preserved.

### Export formats

The app currently supports:

- `TXT`
- `MD`
- `HTML`
- `PDF`
- media/image download
- batch zip packaging

Default behavior in the Next.js UI now enables:

- `TXT`
- `MD`
- `PDF`
- `HTML`

### Export structure

Each source now gets its own folder:

```text
<batch>/
  manifest.json
  README-IMPORT.md
  notebooklm_sources.zip
  <source-slug>/
    source.txt
    source.md
    source.html
    source.pdf
    assets/
      image-01.jpg
      ...
```

This replaced the older flat batch layout.

### Google Drive

- Browser-based Google Drive sign-in works on the live site.
- Google Drive upload works.
- The uploader preserves relative paths, so nested source folders can be recreated in Drive.

### Deployment

- GitHub push to `main` triggers Firebase deployment.
- The live app is reachable and functional.

## Important fixes that were just completed

### 1. Quote-tweet article extraction fix

Problem:

- A sample URL like `https://x.com/LLMJunky/status/2031802820924436506?s=20` only exported the outer quote-tweet text.

Cause:

- The code only checked:
  - `tweetResult.article.article_results.result`
- But the full article for that case lives in:
  - `tweetResult.quoted_status_result.result.article.article_results.result`

Fix:

- `src/lib/x.ts` now checks for article data in this order:
  1. article attached to the current tweet
  2. article attached to the quoted tweet
  3. fallback tweet/syndication content
- When a quoted-tweet article is found:
  - the article body becomes the exported main content
  - the outer tweet is preserved as quote-tweet context in the note/preface

### 2. Folderized exports

Problem:

- The app used to place source files directly in the batch root.

Fix:

- `src/lib/exporter.ts` now writes one subfolder per source.
- File naming inside each source folder is normalized to:
  - `source.txt`
  - `source.md`
  - `source.html`
  - `source.pdf`
  - `assets/...`

### 3. Drive path preservation

The Drive uploader already had the right general behavior, but it now works with the new folderized output structure cleanly because uploads preserve relative paths from the batch root.

## Verified test cases

### Quote-tweet/article case

Input:

- `https://x.com/LLMJunky/status/2031802820924436506?s=20`

Expected:

- full quoted article body
- outer quote-tweet preserved only as context

Verified:

- yes

### Existing article-backed tweet case

Input:

- `https://x.com/itsolelehmann/status/2033919415771713715?s=20`

Expected:

- still exports full article content

Verified:

- yes

### Plain tweet case

Input:

- `https://x.com/jack/status/20`

Expected:

- plain tweet export still works

Verified:

- yes

### Build checks

Verified:

- `npm run lint`
- `npm run build`

Both passed after the latest fixes.

## Important files

Main app entry/UI:

- [src/components/app-shell.tsx](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/components/app-shell.tsx)

Extraction logic:

- [src/lib/x.ts](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/lib/x.ts)

Export generation:

- [src/lib/exporter.ts](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/lib/exporter.ts)

Drive upload:

- [src/lib/google-drive.ts](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/lib/google-drive.ts)

Job/storage handling:

- [src/lib/jobs.ts](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/lib/jobs.ts)

Types:

- [src/lib/types.ts](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/src/lib/types.ts)

Deployment config:

- [firebase.json](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/firebase.json)
- [apphosting.yaml](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/apphosting.yaml)
- [.github/workflows/firebase-apphosting.yml](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/.github/workflows/firebase-apphosting.yml)

Roadmap:

- [roadmap.md](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/roadmap.md)

Legacy Python reference:

- [legacy-python/x_to_notebooklm.py](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/legacy-python/x_to_notebooklm.py)

## Known limitations

### Storage

- Hosted persistence is not fully set up yet.
- `APP_STORAGE_BUCKET` has not been provisioned yet.
- Hosted job history therefore still needs a better long-term storage story.

### CI / deploy hardening

- GitHub deploy still uses `FIREBASE_TOKEN`.
- A more production-grade setup would replace this with Workload Identity or a dedicated service account.

### UI

The user explicitly wants a larger UI overhaul later, including:

- all-in-one page flow
- less crowded layout
- better visual hierarchy
- stronger polish

That work has not been started yet.

### NotebookLM handoff

- There is no true direct import integration yet.
- The app can prepare the files well, and Drive upload works, but the final NotebookLM handoff is still not ideal.

## Google auth context

Current live setup:

- the public Google OAuth client ID is configured for the live app
- browser sign-in works
- users should not need to place a `credentials.json` file for the web app flow

Important distinction:

- end users do not need a local `credentials.json`
- the app still needs Google OAuth configuration in Google Cloud

## Current roadmap summary

See the full tracked list in:

- [roadmap.md](C:/Users/Asus/OneDrive/שולחן%20העבודה/יואב%20שקד/X---to---NotebookLM-nextjs/roadmap.md)

Top remaining tasks:

1. Verify a live multi-source Drive upload and confirm nested source folders in Drive.
2. Provision a real bucket and set `APP_STORAGE_BUCKET`.
3. Replace GitHub `FIREBASE_TOKEN` deployment auth with Workload Identity or a dedicated service account.
4. Add regression coverage for:
   - quote-tweets that reference article-backed tweets
   - folderized exports
   - Drive path preservation
5. Improve article extraction parity for edge-case X payloads and direct article URLs.
6. Do the large UI redesign.

## Suggested next prompt for another Codex session

If you want another Codex instance to continue smoothly, give it this repo and then start with something like:

```text
Read HANDOFF.md and roadmap.md first, then continue the Next.js app from the current state.
Focus next on:
1. verifying live multi-source Drive upload creates nested source folders correctly
2. adding regression coverage for quote-tweet article extraction and folderized exports
Do not rework the UI yet unless necessary.
```

## Notes for the next collaborator

- Prefer the Next.js repo over the Python repo for new work.
- Do not undo the new folderized export structure unless there is a very good reason.
- When testing article extraction, use the exact sample URLs listed above because they already exposed real edge cases.
- Keep the roadmap current as tasks are completed.
