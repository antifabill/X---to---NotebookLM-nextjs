const MOJIBAKE_REPLACEMENTS: Record<string, string> = {
  "â€™": "’",
  "â€˜": "‘",
  "â€œ": "“",
  "â€\u009d": "”",
  "â€”": "—",
  "â€“": "–",
  "â€¦": "…",
  "Â ": " ",
  "Â·": "·",
  Â: "",
  "\ufeff": "",
  "\u200b": "",
  "\u200c": "",
  "\u200d": "",
  "\u00a0": " ",
};

const UTF8_LATIN1_REPLACEMENTS: Record<string, string> = {
  [Buffer.from([0xe2, 0x80, 0x98]).toString("latin1")]: "‘",
  [Buffer.from([0xe2, 0x80, 0x99]).toString("latin1")]: "’",
  [Buffer.from([0xe2, 0x80, 0x9c]).toString("latin1")]: "“",
  [Buffer.from([0xe2, 0x80, 0x9d]).toString("latin1")]: "”",
  [Buffer.from([0xe2, 0x80, 0x93]).toString("latin1")]: "–",
  [Buffer.from([0xe2, 0x80, 0x94]).toString("latin1")]: "—",
  [Buffer.from([0xe2, 0x80, 0xa6]).toString("latin1")]: "…",
  [Buffer.from([0xe2, 0x86, 0x92]).toString("latin1")]: "→",
};

function textArtifactScore(text: string) {
  const fragments = ["â€™", "â€", "â†", "Ã", "Â", "�"];
  return fragments.reduce((sum, fragment) => sum + (text.match(new RegExp(fragment, "g")) || []).length, 0);
}

export function repairTextArtifacts(text?: string | null) {
  if (!text) {
    return "";
  }

  let repaired = text;
  for (const [bad, good] of Object.entries(UTF8_LATIN1_REPLACEMENTS)) {
    repaired = repaired.replaceAll(bad, good);
  }
  for (const [bad, good] of Object.entries(MOJIBAKE_REPLACEMENTS)) {
    repaired = repaired.replaceAll(bad, good);
  }

  const baseline = textArtifactScore(repaired);
  if (baseline) {
    try {
      const candidate = Buffer.from(repaired, "latin1").toString("utf8");
      const score = textArtifactScore(candidate);
      if (score < baseline) {
        repaired = candidate;
      }
    } catch {}
  }

  return repaired.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function slugify(value: string, maxLength = 90) {
  return repairTextArtifacts(value)
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, maxLength) || "source";
}
