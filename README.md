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
- recent local job history

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
- Google Drive auth has not been ported yet in this first Next.js migration slice.
- This app stores local batch jobs in `.data/jobs`.

## Next migration steps

1. Port Google Drive auth to a proper web flow.
2. Replace local filesystem assumptions with deployment-friendly storage.
3. Add Firebase-friendly auth and deployment plumbing.
4. Keep improving preview quality and article extraction parity.
