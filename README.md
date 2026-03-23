# X to NotebookLM Next.js

This repository is the Next.js migration fork of the original Python-based `X---to---NotebookLM` app.

## Current status

The fork already supports:

- paste, drag, or drop X URLs into a browser UI
- live preview of the first source
- tweet extraction, including tweet-linked X Articles when the public GraphQL payload exposes the full article body
- export to `.txt`, `.md`, `.html`, and `.pdf`
- image download when media exists
- batch packaging with `manifest.json`, `README-IMPORT.md`, and a zip bundle
- browser-based Google Drive sign-in and batch upload from the UI
- recent local job history
- Firebase App Hosting deployment

The original Python implementation is preserved in [`legacy-python/`](./legacy-python).

## Local development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production checks

Lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

## Notes

- PDF generation uses `playwright-core` with either a detected local Chromium-based browser or `@sparticuz/chromium` as the executable source. If no compatible browser runtime is available, the export continues without a PDF and records a note for that source.
- Local development stores batch jobs in `.data/jobs`.
- Cloud storage is enabled when any of `APP_STORAGE_BUCKET`, `FIREBASE_STORAGE_BUCKET`, or `GCS_STORAGE_BUCKET` is set.
- App Hosting is configured with `APP_STORAGE_BUCKET=promptsmith-63ac5-x-to-notebooklm-us-central1` for build and runtime.
- Hosted persistence has been verified end to end through the deployed app/API path after App Hosting deploy: the live home page returned `200`, hosted batch `job-1774193456008-94be977d` succeeded, and `/api/jobs`, `/api/jobs/<jobId>`, bundle download, and file download all worked afterward.
- Hosted PDF generation is also now verified live on App Hosting: batch `job-1774259965753-6b5c7c7e` produced `.pdf` files for both tested sources, and a hosted PDF download returned `200` with `application/pdf`.

## Google Drive web flow

The Next.js app now uses a browser-based Google Drive flow instead of the old local `credentials.json` approach for end users.

For local development, add:

```bash
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id
```

Without that variable, the app still works, but the Google Drive UI stays disabled.

## Firebase App Hosting

This repo is linked to Firebase project `promptsmith-63ac5` and backend `x-to-notebooklm-nextjs`.

Important config files:

- [firebase.json](./firebase.json)
- [apphosting.yaml](./apphosting.yaml)
- [\.github/workflows/firebase-apphosting.yml](./.github/workflows/firebase-apphosting.yml)

Live URL:

- [https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app](https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app)

Drive sign-in is configured on the live site through `apphosting.yaml` using the Google OAuth client ID as a public env value.

Persisted cloud job storage is now configured in `apphosting.yaml` with `APP_STORAGE_BUCKET=promptsmith-63ac5-x-to-notebooklm-us-central1`. `APP_STORAGE_BUCKET` is the preferred app-specific name, and `FIREBASE_STORAGE_BUCKET` or `GCS_STORAGE_BUCKET` are also recognized:

```yaml
env:
  - variable: APP_STORAGE_BUCKET
    value: promptsmith-63ac5-x-to-notebooklm-us-central1
```

Hosted persistence is now verified through the live app/API path after deploy using bucket `promptsmith-63ac5-x-to-notebooklm-us-central1`. That verification covers the application-visible flow, not direct bucket inspection; IAM hardening and retention rules still need follow-up.

Hosted PDF generation is now verified on the deployed App Hosting site as well.

The end-to-end Google Drive flow is now verified too: a signed-in browser upload created the expected batch folder and per-source folders, and the source folder view showed `PDF`, `MD`, `TXT`, `HTML`, and `assets`.

## Next migration steps

1. Improve article extraction parity and quality on edge-case X payloads.
2. Replace the temporary GitHub deploy token flow with Workload Identity or a dedicated service account when ready.
3. Define retention rules and any cleanup behavior for hosted job artifacts.
