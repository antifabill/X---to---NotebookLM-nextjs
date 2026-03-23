import quoteTweetArticleGraphql from "./fixtures/x/quote-tweet-article-graphql.json";
import quoteTweetArticlePayload from "./fixtures/x/quote-tweet-article-payload.json";
import directArticleGraphql from "./fixtures/x/direct-article-graphql.json";
import directArticlePayload from "./fixtures/x/direct-article-payload.json";
import plainTweetPayload from "./fixtures/x/plain-tweet-payload.json";

function jsonResponse(payload: unknown, init?: { ok?: boolean; status?: number; statusText?: string; contentType?: string }) {
  const text = JSON.stringify(payload);
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-type" ? init?.contentType ?? "application/json" : null;
      },
    },
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  } satisfies Partial<Response>;
}

describe("parseSource", () => {
  it("uses a quoted tweet article as the main article body and keeps quote tweet context", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("guest/activate.json")) return jsonResponse({ guest_token: "guest-token" });
      if (url.includes("TweetResultByRestId")) return jsonResponse(quoteTweetArticleGraphql);
      if (url.includes("cdn.syndication.twimg.com/tweet-result")) return jsonResponse(quoteTweetArticlePayload);
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { parseSource } = await import("@/lib/x");

    const source = await parseSource("https://x.com/LLMJunky/status/2031802820924436506?s=20");

    expect(source.kind).toBe("article");
    expect(source.title).toBe("Building Games With Codex");
    expect(source.author).toBe("Guide Builder (@Quoter)");
    expect(source.body).toContain("Codex can now generate playable game loops");
    expect(source.body).toContain("The guide walks through prompts");
    expect(source.body).not.toContain("This is one of the most impressive guides");
    expect(source.note).toContain("Quote-tweet context from am.will (@LLMJunky)");
    expect(source.note).toContain("This is one of the most impressive guides");
    expect(source.note).toContain("Quoted source: https://x.com/Quoter/status/2031802800000000000");
    expect(source.media.map((asset) => asset.sourceUrl)).toEqual(
      expect.arrayContaining([
        "https://pbs.twimg.com/media/guide-cover.jpg",
        "https://pbs.twimg.com/media/guide-inline.jpg",
        "https://pbs.twimg.com/media/context-image.jpg",
      ]),
    );
  });

  it("keeps direct article-backed tweets on the direct article path", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("guest/activate.json")) return jsonResponse({ guest_token: "guest-token" });
      if (url.includes("TweetResultByRestId")) return jsonResponse(directArticleGraphql);
      if (url.includes("cdn.syndication.twimg.com/tweet-result")) return jsonResponse(directArticlePayload);
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { parseSource } = await import("@/lib/x");

    const source = await parseSource("https://x.com/itsolelehmann/status/2033919415771713715?s=20");

    expect(source.kind).toBe("article");
    expect(source.title).toBe("How to 10x your Claude Skills");
    expect(source.author).toBe("Ole Lehmann (@itsolelehmann)");
    expect(source.body).toContain("Treat research, synthesis, and iteration as distinct prompt phases.");
    expect(source.body).toContain("- Draft fast");
    expect(source.media.map((asset) => asset.sourceUrl)).toEqual(
      expect.arrayContaining([
        "https://pbs.twimg.com/media/claude-cover.jpg",
        "https://pbs.twimg.com/media/claude-inline.jpg",
      ]),
    );
  });

  it("falls back to the syndicated tweet payload when GraphQL is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("guest/activate.json")) return jsonResponse({ guest_token: "guest-token" });
      if (url.includes("TweetResultByRestId")) {
        return jsonResponse({ error: "unavailable" }, { ok: false, status: 500, statusText: "Server Error" });
      }
      if (url.includes("cdn.syndication.twimg.com/tweet-result")) return jsonResponse(plainTweetPayload);
      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { parseSource } = await import("@/lib/x");

    const source = await parseSource("https://x.com/jack/status/20");

    expect(source.kind).toBe("tweet");
    expect(source.title).toBe("Tweet by @jack");
    expect(source.author).toBe("jack (@jack)");
    expect(source.body).toContain("https://example.com/original-post");
    expect(source.note).toBeNull();
  });
});
