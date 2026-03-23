# ORCHESTRATOR MEMORY
## Repo Summary
- This repo is the active Next.js migration fork of the original Python `X---to---NotebookLM` app, as stated in `README.md` and `HANDOFF.md`.
- The current app converts X tweets, X Articles, and generic pages into NotebookLM-friendly exports with TXT, MD, HTML, PDF, media download, zip packaging, and optional Google Drive upload.
- `package.json` shows a Next.js 16 / React 19 / TypeScript stack with `@google-cloud/storage`, `playwright-core`, `@sparticuz/chromium`, `cheerio`, and `adm-zip`.

## Architecture and Boundaries
- `src/app/page.tsx` is the server entry and renders the main UI with recent jobs preloaded.
- `src/components/app-shell.tsx` owns the client workflow for URL input, live preview, batch export, recent jobs, and browser-based Drive connect/upload.
- API boundaries are `src/app/api/process/route.ts`, `src/app/api/preview/route.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[jobId]/route.ts`, `src/app/api/jobs/[jobId]/download/route.ts`, and `src/app/api/jobs/[jobId]/bundle/route.ts`.
- Core logic is split across `src/lib/x.ts` for extraction, `src/lib/exporter.ts` for file generation, `src/lib/jobs.ts` for job persistence/serving, and `src/lib/google-drive.ts` for browser-side Drive upload.

## Entry Points and Important Paths
- `src/app/page.tsx`: home page entry that loads recent jobs and renders the shell.
- `src/components/app-shell.tsx`: main UX for previewing, converting, downloading, and uploading batches.
- `src/lib/x.ts`, `src/lib/exporter.ts`, `src/lib/jobs.ts`, and `src/lib/google-drive.ts`: core extraction, export, storage, and Drive integration files.
- `firebase.json`, `apphosting.yaml`, and `.github/workflows/firebase-apphosting.yml`: deployment and hosting configuration.

## Commands and Verification
- `package.json` defines `npm run dev`, `npm run build`, `npm run start`, `npm run lint`, `npm test`, and `npm run test:watch`.
- `README.md` documents `npm install`, `npm run dev`, `npm run lint`, and `npm run build` as the main local and production checks.
- `HANDOFF.md` says `npm run lint` and `npm run build` passed after the latest fixes.
- On 2026-03-23, a new Vitest harness was added with `vitest.config.ts`, `tests/setup.ts`, committed fixtures under `tests/fixtures/x`, and regression specs for extraction, exporter behavior, and Drive upload planning.
- On 2026-03-23, `npm test`, `npm run lint`, and `npm run build` all passed locally after the regression slice; Vitest reported 3 passing files and 8 passing tests.
- On 2026-03-23, the deployed app successfully processed a live multi-source batch (`job-1774252978810-9aa00724`) with `https://x.com/itsolelehmann/status/2033919415771713715?s=20` and `https://x.com/jack/status/20`, and the hosted `/api/jobs`, `/api/jobs/<jobId>`, bundle, and file download endpoints all returned `200`.
- On 2026-03-23, after the hosted PDF fixes, the deployed app successfully generated PDFs for a live multi-source batch (`job-1774259965753-6b5c7c7e`), and a hosted PDF download returned `200` with `application/pdf`.

## Conventions and Patterns
- The route handlers in the listed API files all declare `export const runtime = "nodejs"`.
- `src/components/app-shell.tsx` uses local React state plus `fetch()` calls to the app's own API routes instead of server actions.
- `src/lib/jobs.ts` stores jobs under `.data/jobs` locally and switches to temp storage plus optional cloud upload behavior in hosted environments.
- `src/lib/google-drive.ts` uses browser local storage and Google Identity Services to manage Drive auth on the client.
- `src/lib/exporter.ts` now exposes a small `pdfRenderer` injection seam on `writeSourceOutputs(...)` so regression tests can verify the PDF branch without launching a real browser.
- `src/lib/google-drive.ts` now exposes a pure `buildDriveUploadPlan(job)` helper so the nested-folder upload logic can be tested without hitting the Drive API.

## Fragile Areas and Risks
- `src/lib/x.ts` relies on public X guest-token, GraphQL, and syndication responses, so extraction can break if those public payloads change.
- `apphosting.yaml` sets `APP_STORAGE_BUCKET=promptsmith-63ac5-x-to-notebooklm-us-central1` for build and runtime, and hosted persistence has now been verified through the deployed app/API path after a successful hosted batch run.
- `src/lib/google-drive.ts` keeps the Drive access token and account profile in browser `localStorage`, loads Google Identity Services in the browser, and uploads directly from the client to Google Drive; future Drive troubleshooting will still require a signed-in browser session because there is no server-side upload API.
- Hosted PDF generation now works on App Hosting, but the fix depends on internal `@sparticuz/chromium` helper files plus a route-scoped tracing include in `next.config.ts`, so future package upgrades or build-system changes could break it again.
- `.github/workflows/firebase-apphosting.yml` still deploys with `FIREBASE_TOKEN`, and both `README.md` and `roadmap.md` say this should be replaced.
- Current docs and `src/lib/exporter.ts` agree that exports are folderized per source and use descriptive filenames based on source title/author, plus `assets/` for media.

## Decisions and Rationale
- `README.md` and `HANDOFF.md` both make the Next.js repo the active product while preserving the original Python app as a legacy reference.
- `README.md` says Google Drive was intentionally moved to a browser-based sign-in flow so end users do not need a local `credentials.json`.
- `src/lib/jobs.ts` and `README.md` reflect a deployment-friendly storage decision: use local `.data/jobs` in development and cloud storage in hosted mode when a recognized bucket env var is present.
- `HANDOFF.md` documents that quote-tweet article extraction was changed so the quoted article body becomes the main export content when available, with the outer tweet kept as context.
- Regression coverage should start with a small Node-side Vitest harness rather than browser E2E, because the highest-risk logic is concentrated in `src/lib/x.ts`, `src/lib/exporter.ts`, and `src/lib/google-drive.ts`.
- The current exporter and Drive modules likely need small test seams instead of full integration harnesses: inject a PDF renderer into `writeSourceOutputs` and extract a pure Drive upload-plan helper from `src/lib/google-drive.ts`.
- The regression-coverage slice followed that plan: keep Node-side tests focused on extraction, folderized exports, PDF success/failure behavior at the seam, and Drive path preservation, while leaving signed-in browser Drive checks as manual verification.

## Active Work
- `roadmap.md` now treats both bucket provisioning and hosted persistence verification as complete, while still listing `FIREBASE_TOKEN` replacement, staging/production environments, and runtime monitoring/triage notes.
- Regression coverage for quote-tweet article extraction, folderized exports, hosted PDF seam behavior, and Drive path preservation is now implemented locally but still needs to be committed and pushed.
- The next likely implementation slice is deploy-auth hardening: replace `FIREBASE_TOKEN` in `.github/workflows/firebase-apphosting.yml` with Workload Identity Federation or a dedicated service-account flow.
- Product flow work still open includes improving Drive auth/error UX and improving the NotebookLM handoff.
- Storage/job lifecycle work still open includes retention rules, clearer hosted-mode behavior, and a delete-job action in the UI.
- `roadmap.md` also lists a major UI makeover, but `HANDOFF.md` and `OPERATOR-PROMPT.md` say not to start that redesign yet unless needed for a blocking fix.

## Recent Meaningful Changes
- `roadmap.md` and `HANDOFF.md` say the app now has browser-based Google Drive sign-in/upload and Firebase App Hosting deployment.
- `HANDOFF.md` documents a quote-tweet/article extraction fix so exports include the quoted article body instead of only the outer quote-tweet text.
- `HANDOFF.md` and `roadmap.md` say exports were restructured into one folder per source and Drive uploads preserve relative paths for nested folders.
- The docs now record that deployed hosted persistence was verified via the app-visible path: live home page `200`, hosted batch `job-1774193456008-94be977d`, `/api/jobs`, `/api/jobs/<jobId>`, bundle download, and file download all succeeded afterward.
- A sequence of targeted hosted PDF fixes landed on 2026-03-23: explicit Sparticuz bin discovery in `src/lib/exporter.ts`, route-scoped `outputFileTracingIncludes` in `next.config.ts`, explicit root `node_modules` bin fallback, boolean Playwright headless launch, and AL2023 library backfill using Sparticuz's internal helper modules.
- A later live hosted verification on 2026-03-23 confirmed multi-source processing through the deployed app/API path with nested per-source output paths and working PDF generation: job `job-1774259965753-6b5c7c7e` produced `.pdf` files and a hosted PDF download returned `200` with `application/pdf`.
- User-provided Drive screenshots on 2026-03-23 confirmed the final browser-only step: the uploaded Drive batch contains the expected root files plus per-source folders, and the source folder view shows `PDF`, `MD`, `TXT`, `HTML`, and `assets`.
- The stale docs drift around export structure and exporter/job behavior has been corrected in the current docs set, so README, HANDOFF, roadmap, and memory should now be treated as aligned unless code changes again.
- `README.md` says the live app and preview endpoint were verified and that a real Drive upload worked on the deployed site.
- The new regression harness added `vitest` to `package.json`, created `vitest.config.ts` and `tests/setup.ts`, added sanitized X fixtures under `tests/fixtures/x`, and introduced `tests/x.parse-source.test.ts`, `tests/exporter.test.ts`, and `tests/google-drive.test.ts`.
- The exporter and Drive test seams landed with minimal source changes: `src/lib/exporter.ts` accepts an optional injected `pdfRenderer`, and `src/lib/google-drive.ts` now exports `buildDriveUploadPlan(job)` which `uploadJobToDrive(...)` consumes internally.

## Lessons Learned
- `HANDOFF.md` says to prefer the Next.js repo over the legacy Python repo for new work.
- `HANDOFF.md` also says not to undo the folderized export structure without a very good reason.
- Real sample URLs matter: `HANDOFF.md` calls out specific tweet/article cases that already exposed extraction edge cases.
- Documentation drift was a real issue here, but the current export-structure notes have been refreshed and now match `src/lib/exporter.ts`; re-check them after future exporter/job changes.
- App Hosting-specific failures became diagnosable only after adding targeted runtime logs. The hosted PDF fix required following the chain from missing asset discovery to Playwright launch typing to missing `libnspr4.so`, rather than treating it as one generic browser problem.
- The Drive flow really does need two separate proofs: server-side export generation and a signed-in browser upload check. Treat them as separate milestones in future verification work.
- Node-side regression coverage is a good fit for this repo's riskiest logic. The tests are fast enough to run routinely, and small seams in `src/lib/exporter.ts` and `src/lib/google-drive.ts` were enough to avoid brittle browser-heavy test setup.
