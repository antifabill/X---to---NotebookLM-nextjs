import path from "node:path";

import * as cheerio from "cheerio";

import { repairTextArtifacts } from "@/lib/text";
import type { MediaAsset, PreviewPayload, SourceContent } from "@/lib/types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36";
const X_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const X_TWEET_RESULT_QUERY_ID = "zy39CwTyYhU-_0LP7dljjg";
const X_TWEET_RESULT_FEATURES = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};
const X_TWEET_RESULT_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: true,
  withArticleVoiceOver: true,
};

let guestToken: string | null = null;

type TweetPayload = {
  id_str?: string;
  text?: string;
  created_at?: string;
  user?: { screen_name?: string; name?: string };
  entities?: { urls?: Array<{ url?: string; expanded_url?: string; display_url?: string }> };
  mediaDetails?: Array<{ media_url_https?: string; display_url?: string; type?: string }>;
  article?: {
    title?: string;
    preview_text?: string;
    rest_id?: string;
    cover_media?: { media_info?: { original_img_url?: string } };
  };
};

type ArticleBlock = {
  type?: string;
  text?: string;
};

type ArticleResult = {
  title?: string;
  content_state?: { blocks?: ArticleBlock[] };
  metadata?: { first_published_at_secs?: number };
  cover_media?: { media_info?: { original_img_url?: string } };
  media_entities?: Array<{ media_info?: { original_img_url?: string } }>;
};

type UserResult = {
  core?: { screen_name?: string; name?: string };
  legacy?: { name?: string };
  name?: string;
};

type TweetGraphqlResult = {
  __typename?: string;
  article?: { article_results?: { result?: ArticleResult } };
  core?: { user_results?: { result?: UserResult } };
  legacy?: { screen_name?: string; created_at?: string };
};

async function fetchText(url: string, init?: RequestInit, accept = "text/html,application/json") {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return {
    text: await response.text(),
    contentType: response.headers.get("content-type") || "",
  };
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const { text, contentType } = await fetchText(url, init);
  if (!contentType.includes("json") && !text.trim().startsWith("{")) {
    throw new Error("Expected JSON response");
  }
  return JSON.parse(text) as T;
}

async function postJson<T>(url: string, headers: Record<string, string>) {
  return fetchJson<T>(url, {
    method: "POST",
    headers,
  });
}

async function xGuestToken() {
  if (guestToken) return guestToken;
  const data = await postJson<{ guest_token?: string }>("https://api.x.com/1.1/guest/activate.json", {
    authorization: `Bearer ${X_BEARER_TOKEN}`,
    "content-type": "application/json",
    "user-agent": USER_AGENT,
  });
  if (!data.guest_token) throw new Error("Could not acquire X guest token");
  guestToken = data.guest_token;
  return guestToken;
}

async function xApiJson<T>(url: string) {
  return fetchJson<T>(url, {
    headers: {
      authorization: `Bearer ${X_BEARER_TOKEN}`,
      "x-guest-token": await xGuestToken(),
      "x-twitter-active-user": "yes",
      "x-twitter-client-language": "en",
      "user-agent": USER_AGENT,
      referer: "https://x.com/",
    },
  });
}

export async function downloadBytes(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Could not download media: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Empty URL");
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function classifyUrl(url: string): SourceContent["kind"] {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.includes("/status/")) return "tweet";
  if (pathname.includes("/i/article/") || pathname.includes("/article/")) return "article";
  return "page";
}

function extractMeta(html: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return repairTextArtifacts(match[1]);
  }
  return null;
}

function stripTags(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, head").remove();
  return repairTextArtifacts(
    $("body")
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
  );
}

function tweetIdFromUrl(url: string) {
  const match = /\/status\/(\d+)/.exec(new URL(url).pathname);
  if (!match) throw new Error("Could not find tweet id in URL");
  return match[1];
}

function canonicalArticleTweetId(url: string) {
  const match = /^\/[^/]+\/article\/(\d+)$/.exec(new URL(url).pathname);
  return match?.[1] || null;
}

function expandUrls(text: string, entities: { urls?: Array<{ url?: string; expanded_url?: string; display_url?: string }> }) {
  let expanded = text;
  for (const item of entities.urls || []) {
    if (item.url && (item.expanded_url || item.display_url)) {
      expanded = expanded.replaceAll(item.url, item.expanded_url || item.display_url || item.url);
    }
  }
  return repairTextArtifacts(expanded);
}

async function fetchTweetPayload(tweetId: string) {
  const data = await fetchJson<TweetPayload>(
    `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&lang=en&token=1`,
  );
  if (!data?.id_str) throw new Error("X returned an empty tweet payload");
  return data;
}

async function fetchTweetGraphql(tweetId: string) {
  const params = new URLSearchParams({
    variables: JSON.stringify({
      tweetId: String(tweetId),
      includePromotedContent: true,
      withBirdwatchNotes: true,
      withVoice: true,
      withCommunity: true,
    }),
    features: JSON.stringify(X_TWEET_RESULT_FEATURES),
    fieldToggles: JSON.stringify(X_TWEET_RESULT_FIELD_TOGGLES),
  });
  const data = await xApiJson<{ data?: { tweetResult?: { result?: TweetGraphqlResult } } }>(
    `https://api.x.com/graphql/${X_TWEET_RESULT_QUERY_ID}/TweetResultByRestId?${params.toString()}`,
  );
  const result = data?.data?.tweetResult?.result;
  if (!result || result.__typename !== "Tweet") throw new Error("Could not fetch X tweet GraphQL payload");
  return result;
}

function articleEntitiesToMedia(articleResult: ArticleResult): MediaAsset[] {
  const media: MediaAsset[] = [];
  const seen = new Set<string>();
  const cover = articleResult?.cover_media?.media_info?.original_img_url;
  if (cover && !seen.has(cover)) {
    seen.add(cover);
    media.push({ sourceUrl: cover, label: "article-cover", kind: "image" });
  }
  for (const item of articleResult.media_entities || []) {
    const mediaUrl = item?.media_info?.original_img_url;
    if (mediaUrl && !seen.has(mediaUrl)) {
      seen.add(mediaUrl);
      media.push({ sourceUrl: mediaUrl, label: path.basename(new URL(mediaUrl).pathname), kind: "image" });
    }
  }
  return media;
}

function articleBlocksToText(blocks: ArticleBlock[]) {
  const lines: string[] = [];
  const paragraphParts: string[] = [];

  const flushParagraph = () => {
    if (paragraphParts.length) {
      lines.push(paragraphParts.join(" ").trim(), "");
      paragraphParts.length = 0;
    }
  };

  for (const block of blocks) {
    const type = block.type;
    const text = repairTextArtifacts((block.text || "").trim());
    if (type === "atomic" || !text) {
      flushParagraph();
      continue;
    }
    if (type === "header-two") {
      flushParagraph();
      lines.push("", text, "-".repeat(text.length), "");
      continue;
    }
    if (type === "header-three") {
      flushParagraph();
      lines.push(`### ${text}`, "");
      continue;
    }
    if (type === "unordered-list-item") {
      flushParagraph();
      lines.push(`- ${text}`);
      continue;
    }
    if (type === "ordered-list-item") {
      flushParagraph();
      lines.push(`1. ${text}`);
      continue;
    }
    paragraphParts.push(text);
  }

  flushParagraph();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function articleSourceFromGraphql(tweetResult: TweetGraphqlResult, url: string): SourceContent | null {
  const articleResult = tweetResult?.article?.article_results?.result;
  if (!articleResult?.content_state) return null;
  const userResult = tweetResult?.core?.user_results?.result || {};
  const legacy = tweetResult.legacy || {};
  const title = repairTextArtifacts(articleResult.title || "X Article");
  const screenName = userResult?.core?.screen_name || legacy?.screen_name;
  const userName = userResult?.core?.name || userResult?.legacy?.name || userResult?.name;
  const author = userName && screenName ? repairTextArtifacts(`${userName} (@${screenName})`) : screenName ? `@${screenName}` : null;
  const firstPublishedAt = articleResult?.metadata?.first_published_at_secs;
  const published = firstPublishedAt
    ? new Date(firstPublishedAt * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC")
    : legacy?.created_at || null;

  return {
    url,
    kind: "article",
    title,
    author,
    published,
    body: articleBlocksToText(articleResult?.content_state?.blocks || []),
    note: `Captured from X article attached to tweet: ${url}`,
    media: articleEntitiesToMedia(articleResult),
  };
}

function buildTweetMedia(payload: TweetPayload): MediaAsset[] {
  const media: MediaAsset[] = [];
  const seen = new Set<string>();
  for (const item of payload.mediaDetails || []) {
    const mediaUrl = item.media_url_https;
    if (mediaUrl && !seen.has(mediaUrl)) {
      seen.add(mediaUrl);
      media.push({
        sourceUrl: mediaUrl,
        label: item.display_url || path.basename(new URL(mediaUrl).pathname),
        kind: "image",
      });
    }
  }
  const cover = payload.article?.cover_media?.media_info?.original_img_url;
  if (cover && !seen.has(cover)) {
    seen.add(cover);
    media.push({ sourceUrl: cover, label: "article-cover", kind: "image" });
  }
  return media;
}

async function parseTweet(url: string): Promise<SourceContent> {
  try {
    const tweetResult = await fetchTweetGraphql(tweetIdFromUrl(url));
    const articleSource = articleSourceFromGraphql(tweetResult, url);
    if (articleSource) {
      try {
        const payload = await fetchTweetPayload(tweetIdFromUrl(url));
        const existing = new Set(articleSource.media.map((asset) => asset.sourceUrl));
        for (const asset of buildTweetMedia(payload)) {
          if (!existing.has(asset.sourceUrl)) {
            articleSource.media.push(asset);
          }
        }
      } catch {}
      return articleSource;
    }
  } catch {}

  const payload = await fetchTweetPayload(tweetIdFromUrl(url));
  const screenName = payload.user?.screen_name;
  const authorName = payload.user?.name;
  const author = authorName && screenName ? `${authorName} (@${screenName})` : authorName || screenName || null;
  const text = expandUrls(repairTextArtifacts(payload.text || ""), payload.entities || {});
  const sections = [text.trim()];
  let note: string | null = null;

  if (payload.article?.title && payload.article.preview_text) {
    sections.push(
      [
        "Attached X Article",
        "------------------",
        repairTextArtifacts(payload.article.title),
        "",
        repairTextArtifacts(payload.article.preview_text),
        "",
        `Article URL: https://x.com/i/article/${payload.article.rest_id}`,
      ].join("\n"),
    );
    note =
      "X exposed the attached Article preview and cover image from the public tweet payload. The full Article body was not available from the fallback export path.";
  }

  return {
    url,
    kind: "tweet",
    title: repairTextArtifacts(screenName ? `Tweet by @${screenName}` : "X tweet"),
    author,
    published: payload.created_at || null,
    body: repairTextArtifacts(sections.filter(Boolean).join("\n\n")),
    note,
    media: buildTweetMedia(payload),
  };
}

async function parseXArticle(url: string): Promise<SourceContent> {
  const articleTweetId = canonicalArticleTweetId(url);
  if (articleTweetId) {
    const tweetResult = await fetchTweetGraphql(articleTweetId);
    const articleSource = articleSourceFromGraphql(tweetResult, url);
    if (articleSource) {
      return articleSource;
    }
  }

  const { text: html } = await fetchText(url);
  const title = extractMeta(html, "og:title") || `X Article ${path.basename(new URL(url).pathname)}`;
  const description = extractMeta(html, "og:description");
  return {
    url,
    kind: "article",
    title,
    author: null,
    published: null,
    body: description || "The full X Article body was not available from the public response.",
    note: description
      ? "Only the public article summary was available from this direct article URL."
      : "Could not extract a readable body from the public Article response.",
    media: [],
  };
}

async function parseGenericPage(url: string): Promise<SourceContent> {
  const { text: html } = await fetchText(url);
  const title =
    extractMeta(html, "og:title") ||
    repairTextArtifacts(cheerio.load(html)("title").text().trim()) ||
    url;
  const author = extractMeta(html, "author") || extractMeta(html, "article:author");
  const published = extractMeta(html, "article:published_time") || extractMeta(html, "date");
  return {
    url,
    kind: "page",
    title,
    author,
    published,
    body: stripTags(html),
    media: [],
  };
}

export async function parseSource(url: string): Promise<SourceContent> {
  const normalized = normalizeUrl(url);
  const kind = classifyUrl(normalized);
  if (kind === "tweet") return parseTweet(normalized);
  if (kind === "article") return parseXArticle(normalized);
  return parseGenericPage(normalized);
}

export async function sourcePreview(url: string): Promise<PreviewPayload> {
  try {
    const source = await parseSource(url);
    const compactBody = source.body.replace(/\s+/g, " ").trim();
    const excerpt = compactBody.length > 420 ? `${compactBody.slice(0, 420).trimEnd()}...` : compactBody;
    return {
      ok: true,
      url: source.url,
      kind: source.kind,
      title: source.title,
      author: source.author,
      published: source.published,
      excerpt,
      mediaCount: source.media.length,
      note: source.note,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? `${error.name}: ${error.message}` : "Unknown preview error",
    };
  }
}
