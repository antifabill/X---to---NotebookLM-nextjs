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

- PDF generation currently relies on local Microsoft Edge headless printing, matching the original local-app workflow.
- Local development stores batch jobs in `.data/jobs`.
- Hosted environments fall back to a writable temp directory unless `APP_STORAGE_BUCKET` is configured.

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

To enable Drive sign-in on the live site, add the App Hosting secret:

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_GOOGLE_CLIENT_ID --project promptsmith-63ac5
```

If you want persisted cloud job storage on App Hosting, also set:

```yaml
env:
  - variable: APP_STORAGE_BUCKET
    value: your-storage-bucket-name
```

## Next migration steps

1. Add the production Google OAuth client ID secret in App Hosting.
2. Provision a dedicated storage bucket for persisted hosted job history.
3. Improve article extraction parity and quality on edge-case X payloads.
4. Replace the temporary GitHub deploy token flow with Workload Identity or a dedicated service account when ready.
