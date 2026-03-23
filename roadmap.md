# X to NotebookLM Next.js Roadmap

Last updated: 2026-03-23

## Completed so far

- [x] Cloned the original repository and inspected the starting point.
- [x] Built the original local Python tool for exporting X tweets and article-backed tweets into NotebookLM-friendly files.
- [x] Added local web UI to the Python version.
- [x] Improved article extraction for tweet-linked X Articles.
- [x] Added export options for `.txt`, `.md`, `.pdf`, HTML snapshots, media download, and batch zip packaging.
- [x] Added preview card, drag-and-drop input, clipboard paste, and better text cleanup in the Python version.
- [x] Improved PDF generation to remove browser header/footer noise.
- [x] Created and pushed the original Python repo updates to GitHub.
- [x] Created a new Next.js migration fork:
  - Repo: `https://github.com/antifabill/X---to---NotebookLM-nextjs`
- [x] Ported the core extraction/export flow into the Next.js fork.
- [x] Added Next.js API routes for preview, processing, job listing, and downloads.
- [x] Added the first Next.js web UI for batch conversion.
- [x] Preserved the Python implementation under `legacy-python/`.
- [x] Verified the Next.js fork locally with the Ole Lehmann test URL.
- [x] Pushed the Next.js fork to GitHub.
- [x] Added browser-based Google Drive sign-in and direct Drive upload in the Next.js app.
- [x] Added Firebase App Hosting configuration for the Next.js fork.
- [x] Created and deployed the App Hosting backend for `promptsmith-63ac5`.
- [x] Connected GitHub to Firebase deployment through GitHub Actions.
- [x] Enabled the live Google OAuth client ID on the deployed site.
- [x] Verified the deployed app home page and preview endpoint return `200`.
- [x] Verified that live Google Drive upload works for a real batch.
- [x] Fixed quote-tweet/article extraction so exports contain the full quoted article body.
- [x] Restructured exports so each source gets its own subfolder with descriptive export filenames plus `assets/`.
- [x] Verified hosted bucket-backed persistence end to end after deploy: live home page returned `200`, hosted batch `job-1774193456008-94be977d` succeeded, and `/api/jobs`, `/api/jobs/<jobId>`, bundle download, and file download all worked afterward.
- [x] Verified hosted PDF generation live on App Hosting after the exporter/tracing/runtime fixes: batch `job-1774259965753-6b5c7c7e` produced `.pdf` files for both verified sources, and a hosted PDF download returned `200` with `application/pdf`.
- [x] Verified the live Google Drive upload flow end to end with a multi-source batch, including nested source folders and the expected `PDF`, `MD`, `TXT`, `HTML`, and `assets` contents.

## Current roadmap

### Foundation

- [x] 0. Create `roadmap.md` with the work completed so far and track the next tasks.
- [x] 1. Port Google Drive sign-in/upload as a real web flow.
- [x] 2. Make storage/deploy architecture Firebase-friendly.
- [x] 3. Set up GitHub to Firebase deployment for the new Next.js repo.

### Infrastructure and deployment

- [x] Provision a real bucket and set a recognized bucket env var for persistent hosted job history, preferably `APP_STORAGE_BUCKET`.
- [x] Verify persisted hosted job history after deployment with a real hosted batch run.
- [ ] Replace the GitHub `FIREBASE_TOKEN` flow with Workload Identity or a dedicated service account.
- [ ] Add deployment environments for staging vs production.
- [ ] Add App Hosting runtime monitoring/logging checklist and failure triage notes.

### Google Drive and NotebookLM flow

- [ ] Add clearer success/error UX for Drive auth expiration and upload failures.
- [ ] Improve the NotebookLM handoff flow after export/upload.
- [ ] Explore whether a more direct NotebookLM import/open handoff is possible.

### Storage and job lifecycle

- [ ] Decide how long hosted jobs should be kept and add cleanup/retention rules.
- [ ] Add explicit hosted-mode behavior for temporary vs persistent job history.
- [ ] Add a delete job action in the UI.

### Extraction and output quality

- [ ] Add regression coverage for quote-tweets that reference article-backed tweets.
- [ ] Add regression coverage for folderized exports and Drive path preservation.
- [ ] Improve article extraction parity for edge-case X payloads and direct article URLs.
- [ ] Add better formatting preservation in Markdown and PDF exports.
- [ ] Add more resilient image handling and clearer missing-media notes.
- [ ] Add regression test cases for tweet, article, and generic page exports.

### Product and UI

- [ ] Do a major UI makeover:
  - all-in-one page flow
  - less crowded layout
  - clearer visual hierarchy
  - better batch results presentation
- [ ] Redesign the main page so preview, settings, results, and Drive actions feel like one cohesive workflow.
- [ ] Add a stronger visual identity and polish pass for desktop and mobile.
- [ ] Add a lightweight recent-history / saved-batches experience.

### Developer experience

- [ ] Add `.env.example` / setup docs for local Google Drive auth.
- [ ] Add a deployment/setup guide for Firebase, App Hosting, and Google OAuth.
- [ ] Add CI checks for lint and build on pull requests.
- [ ] Document the architecture split between local mode, hosted mode, and cloud-storage mode.

## Notes

- The current Next.js fork works locally and exports NotebookLM-ready bundles.
- Google Drive auth now uses a browser-based Google Identity Services flow and can upload finished batches directly to Drive.
- Storage now supports a deployment-friendly cloud path when `APP_STORAGE_BUCKET`, `FIREBASE_STORAGE_BUCKET`, or `GCS_STORAGE_BUCKET` is set.
- Firebase App Hosting is configured for project `promptsmith-63ac5`.
- Live deployed URL: `https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app`
- GitHub Actions deployment is configured in `.github/workflows/firebase-apphosting.yml`.
- Browser-based Drive sign-in is enabled on the live site through a public App Hosting env value for `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- `APP_STORAGE_BUCKET` is now configured in App Hosting as `promptsmith-63ac5-x-to-notebooklm-us-central1`.
- Hosted persistence is verified through the deployed app/API path using bucket `promptsmith-63ac5-x-to-notebooklm-us-central1`.
- Hosted PDF generation is verified through the deployed app/API path using batch `job-1774259965753-6b5c7c7e` and a successful hosted PDF download.
- The live Google Drive upload flow is also verified end to end with the signed-in browser upload and Drive folder screenshots.
- That proof is limited to the application-visible flow; retention rules, IAM review/hardening, and any direct bucket-inspection workflow are still open.
