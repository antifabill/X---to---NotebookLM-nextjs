# X to NotebookLM

Local web app for turning X.com posts and article-backed tweets into cleaner NotebookLM source files.

## What it does

- pulls tweet content from X syndication and GraphQL endpoints
- exports local source files as `.txt`, `.md`, `.pdf`, and optional `.html`
- downloads tweet and article images into a matching asset folder
- creates a `manifest.json` and `README-IMPORT.md` guide for each batch
- can optionally upload the whole batch to Google Drive
- supports drag-and-drop URL input, clipboard paste, and quick sample loading
- applies conservative text cleanup for common mojibake artifacts
- gives you a direct "Open NotebookLM" handoff from the results page

## Why tweet URLs are best

If a post links to an X Article, start from the tweet URL when you can.

That path is the most reliable way for the app to capture the full article body instead of just the article preview or summary.

## Run the web app

```powershell
python .\x_to_notebooklm.py
```

Then open:

```text
http://127.0.0.1:8765/
```

## Optional Google Drive support

Install the optional packages:

```powershell
pip install -r .\requirements.txt
```

To enable the app's Google Drive sign-in flow, you also need a one-time Google Desktop OAuth client JSON file.

Recommended filename:

```text
credentials.json
```

If you place that file next to `x_to_notebooklm.py`, the web app can use its built-in `Connect Google Drive` flow.

After you connect once in the browser, the saved Drive session is reused for future jobs on the same machine.

## Export flow

1. Paste one or more X URLs.
2. Choose the formats you want.
3. Optionally enable image download.
4. Optionally upload the batch to Google Drive.
5. Open NotebookLM and import the generated files or the uploaded Drive files.

## CLI usage

Single URL:

```powershell
python .\x_to_notebooklm.py "https://x.com/itsolelehmann/status/2033919415771713715?s=20"
```

Custom output folder:

```powershell
python .\x_to_notebooklm.py --out .\sources "https://x.com/jack/status/20"
```

Upload a CLI batch to Google Drive:

```powershell
python .\x_to_notebooklm.py `
  --upload-drive `
  --drive-credentials .\credentials.json `
  "https://x.com/itsolelehmann/status/2033919415771713715?s=20"
```

## Output files

Each batch can include:

- one `.txt` file per source
- one `.md` file per source
- one `.pdf` file per source
- optional `.html` snapshots
- an asset folder with downloaded images
- `manifest.json`
- `README-IMPORT.md`
- `notebooklm_sources.zip`

## Current limitation

I did not find an official public NotebookLM deep link that imports files directly into a notebook.

Because of that, the app's NotebookLM button opens NotebookLM itself, and the Drive integration is used as the cleanest supported handoff when you want cloud-based import.
