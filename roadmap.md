# X to NotebookLM Next.js Roadmap

Last updated: 2026-03-19

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

## Active task list

- [x] 0. Create `roadmap.md` with the work completed so far and track the next tasks.
- [x] 1. Port Google Drive sign-in/upload as a real web flow.
- [x] 2. Make storage/deploy architecture Firebase-friendly.
- [x] 3. Set up GitHub to Firebase deployment for the new Next.js repo.

## Notes

- The current Next.js fork works locally and exports NotebookLM-ready bundles.
- Google Drive auth now uses a browser-based Google Identity Services flow and can upload finished batches directly to Drive.
- Storage now supports a deployment-friendly cloud path via `APP_STORAGE_BUCKET`, with safe temp-directory fallback on App Hosting when the bucket is not configured yet.
- Firebase App Hosting is configured for project `promptsmith-63ac5`.
- Live deployed URL: `https://x-to-notebooklm-nextjs--promptsmith-63ac5.us-central1.hosted.app`
- GitHub Actions deployment is configured in `.github/workflows/firebase-apphosting.yml`.
- Browser-based Drive sign-in is enabled on the live site through a public App Hosting env value for `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
