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

Recent important state:
- Quote-tweets that reference tweets with attached X Articles were fixed so they now export the full quoted article body instead of only the outer tweet text.
- Exports were restructured so each source gets its own folder:
  <batch>/<source-slug>/source.txt
  <batch>/<source-slug>/source.md
  <batch>/<source-slug>/source.html
  <batch>/<source-slug>/source.pdf
  <batch>/<source-slug>/assets/...
- The Drive uploader is expected to preserve that relative folder structure.

Important test URLs:
- Quote-tweet/article case:
  https://x.com/LLMJunky/status/2031802820924436506?s=20
- Existing article-backed tweet case:
  https://x.com/itsolelehmann/status/2033919415771713715?s=20
- Plain tweet case:
  https://x.com/jack/status/20

Current priority:
1. Verify the live Google Drive upload flow end to end with a multi-source batch and confirm nested source folders in Drive.
2. Add regression coverage for:
   - quote-tweets that reference article-backed tweets
   - folderized exports
   - Drive path preservation
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
