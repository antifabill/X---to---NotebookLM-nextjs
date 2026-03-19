#!/usr/bin/env python3
"""Local web app for exporting X.com tweets and article previews for NotebookLM."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import subprocess
import sys
import textwrap
import threading
import time
import webbrowser
import zipfile
from collections import deque
from dataclasses import asdict, dataclass, field
from html import escape, unescape
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)
X_BEARER_TOKEN = (
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
)
X_TWEET_RESULT_QUERY_ID = "zy39CwTyYhU-_0LP7dljjg"
X_TWEET_RESULT_FEATURES = {
    "creator_subscriptions_tweet_preview_api_enabled": True,
    "premium_content_api_read_enabled": False,
    "communities_web_enable_tweet_community_results_fetch": True,
    "c9s_tweet_anatomy_moderator_badge_enabled": True,
    "responsive_web_grok_analyze_button_fetch_trends_enabled": False,
    "responsive_web_grok_analyze_post_followups_enabled": False,
    "responsive_web_jetfuel_frame": True,
    "responsive_web_grok_share_attachment_enabled": True,
    "responsive_web_grok_annotations_enabled": True,
    "articles_preview_enabled": True,
    "responsive_web_edit_tweet_api_enabled": True,
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled": True,
    "view_counts_everywhere_api_enabled": True,
    "longform_notetweets_consumption_enabled": True,
    "responsive_web_twitter_article_tweet_consumption_enabled": True,
    "tweet_awards_web_tipping_enabled": False,
    "content_disclosure_indicator_enabled": True,
    "content_disclosure_ai_generated_indicator_enabled": True,
    "responsive_web_grok_show_grok_translated_post": False,
    "responsive_web_grok_analysis_button_from_backend": True,
    "post_ctas_fetch_enabled": False,
    "freedom_of_speech_not_reach_fetch_enabled": True,
    "standardized_nudges_misinfo": True,
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled": True,
    "longform_notetweets_rich_text_read_enabled": True,
    "longform_notetweets_inline_media_enabled": False,
    "profile_label_improvements_pcf_label_in_post_enabled": True,
    "responsive_web_profile_redirect_enabled": False,
    "rweb_tipjar_consumption_enabled": False,
    "verified_phone_label_enabled": False,
    "responsive_web_grok_image_annotation_enabled": True,
    "responsive_web_grok_imagine_annotation_enabled": True,
    "responsive_web_grok_community_note_auto_translation_is_enabled": False,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": False,
    "responsive_web_graphql_timeline_navigation_enabled": True,
    "responsive_web_enhance_cards_enabled": False,
}
X_TWEET_RESULT_FIELD_TOGGLES = {
    "withArticleRichContentState": True,
    "withArticlePlainText": False,
    "withArticleSummaryText": True,
    "withArticleVoiceOver": True,
}
HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_OUTPUT_DIR = "notebooklm_sources"
DEFAULT_EXPORTS = ("txt", "md", "pdf")
DEFAULT_CREDENTIALS_FILE = "credentials.json"
NOTEBOOKLM_URL = "https://notebooklm.google.com/"
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]

STATUS_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}
RECENT_JOB_IDS = deque(maxlen=8)
X_GUEST_TOKEN: str | None = None


@dataclass
class MediaAsset:
    source_url: str
    label: str
    local_path: str | None = None
    kind: str = "image"


@dataclass
class SourceContent:
    url: str
    kind: str
    title: str
    author: str | None
    published: str | None
    body: str
    note: str | None = None
    media: list[MediaAsset] = field(default_factory=list)


@dataclass
class SourceRecord:
    url: str
    kind: str
    title: str
    author: str | None
    published: str | None
    output_files: list[str] = field(default_factory=list)
    media_files: list[str] = field(default_factory=list)
    note: str | None = None
    drive_files: dict[str, str] = field(default_factory=dict)


@dataclass
class DriveUpload:
    folder_id: str
    folder_url: str
    uploaded_files: dict[str, str] = field(default_factory=dict)
    note: str | None = None


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self._skip_depth = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg", "head"}:
            self._skip_depth += 1
        elif tag in {"p", "div", "br", "li", "section", "article", "main", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg", "head"} and self._skip_depth:
            self._skip_depth -= 1
        elif tag in {"p", "div", "li", "section", "article", "main", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth:
            return
        text = unescape(data).strip()
        if text:
            self._parts.append(text)

    def text(self) -> str:
        raw = " ".join(self._parts)
        raw = re.sub(r"[ \t\r\f\v]+", " ", raw)
        raw = re.sub(r"\n\s*\n+", "\n\n", raw)
        lines = [line.strip() for line in raw.splitlines()]
        lines = [line for line in lines if line]
        return "\n".join(lines).strip()


def slugify(value: str, max_length: int = 90) -> str:
    value = unescape(value)
    value = re.sub(r"[^\w\s-]", "", value, flags=re.UNICODE)
    value = re.sub(r"[\s-]+", "-", value).strip("-_")
    return (value or "source")[:max_length]


def credentials_default_path() -> Path:
    return Path(__file__).with_name(DEFAULT_CREDENTIALS_FILE)


def configured_drive_credentials_path() -> Path | None:
    candidate = credentials_default_path()
    return candidate if candidate.exists() else None


def drive_support_available() -> tuple[bool, str | None]:
    try:
        import google.oauth2.credentials  # noqa: F401
        import googleapiclient.discovery  # noqa: F401
        import google_auth_oauthlib.flow  # noqa: F401
    except ModuleNotFoundError:
        return False, (
            "Google Drive upload needs optional packages. Run "
            "`pip install -r requirements.txt` to enable it."
        )
    return True, None


def drive_token_path(credentials_path: Path) -> Path:
    state_dir = Path(__file__).with_name(".auth")
    state_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(str(credentials_path.resolve()).encode("utf-8")).hexdigest()[:12]
    return state_dir / f"google-drive-token-{digest}.json"


def drive_connection_status() -> dict[str, str | bool | None]:
    ok, message = drive_support_available()
    if not ok:
        return {
            "available": False,
            "configured": False,
            "connected": False,
            "message": message,
            "account_label": None,
        }

    credentials_path = configured_drive_credentials_path()
    if not credentials_path:
        return {
            "available": True,
            "configured": False,
            "connected": False,
            "message": (
                "Google Drive sign-in needs a one-time app credential setup on this machine. "
                "Place a Desktop app `credentials.json` next to the app, then use Connect Google Drive."
            ),
            "account_label": None,
        }

    token_path = drive_token_path(credentials_path)
    if not token_path.exists():
        return {
            "available": True,
            "configured": True,
            "connected": False,
            "message": "Ready to connect. Sign in once in your browser and future jobs can reuse that connection.",
            "account_label": None,
        }

    try:
        from google.auth.transport.requests import Request as GoogleRequest
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build

        creds = Credentials.from_authorized_user_file(str(token_path), DRIVE_SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())
            token_path.write_text(creds.to_json(), encoding="utf-8")

        account_label = None
        if creds and creds.valid:
            service = build("drive", "v3", credentials=creds)
            about = service.about().get(fields="user(displayName,emailAddress)").execute()
            user = about.get("user") or {}
            account_label = user.get("emailAddress") or user.get("displayName")

        return {
            "available": True,
            "configured": True,
            "connected": True,
            "message": "Connected. Future jobs can upload to Google Drive without asking you to sign in again.",
            "account_label": account_label,
        }
    except Exception:
        return {
            "available": True,
            "configured": True,
            "connected": True,
            "message": "A saved Drive session was found. If upload fails later, reconnect once to refresh it.",
            "account_label": None,
        }


def parse_drive_folder_id(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    match = re.search(r"/folders/([a-zA-Z0-9_-]+)", candidate)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{10,}", candidate):
        return candidate
    raise ValueError("Could not understand the Google Drive folder ID or folder URL.")


def best_mime_type(path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(path.name)
    return mime_type or "application/octet-stream"


MOJIBAKE_REPLACEMENTS = {
    "â€™": "’",
    "â€˜": "‘",
    "â€œ": "“",
    "â€\x9d": "”",
    "â€”": "—",
    "â€“": "–",
    "â€¦": "…",
    "Â ": " ",
    "Â·": "·",
    "Â": "",
    "\ufeff": "",
    "\u200b": "",
    "\u200c": "",
    "\u200d": "",
    "\u00a0": " ",
}

UTF8_LATIN1_REPLACEMENTS = {
    b"\xe2\x80\x98".decode("latin1"): "‘",
    b"\xe2\x80\x99".decode("latin1"): "’",
    b"\xe2\x80\x9c".decode("latin1"): "“",
    b"\xe2\x80\x9d".decode("latin1"): "”",
    b"\xe2\x80\x93".decode("latin1"): "–",
    b"\xe2\x80\x94".decode("latin1"): "—",
    b"\xe2\x80\xa6".decode("latin1"): "…",
    b"\xe2\x86\x92".decode("latin1"): "→",
}


def text_artifact_score(text: str) -> int:
    suspicious_fragments = (
        "â€™",
        "â€",
        "â†",
        "Ã",
        "Â",
        "�",
    )
    score = sum(text.count(fragment) for fragment in suspicious_fragments)
    score += text.count("\ufffd") * 3
    return score


def repair_text_artifacts(text: str | None) -> str:
    if not text:
        return ""

    repaired = text
    for bad, good in UTF8_LATIN1_REPLACEMENTS.items():
        repaired = repaired.replace(bad, good)
    for bad, good in MOJIBAKE_REPLACEMENTS.items():
        repaired = repaired.replace(bad, good)

    baseline_score = text_artifact_score(repaired)
    if baseline_score:
        for encoding in ("cp1252", "latin1"):
            try:
                candidate = repaired.encode(encoding, errors="ignore").decode("utf-8", errors="ignore")
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            if text_artifact_score(candidate) < baseline_score:
                repaired = candidate
                baseline_score = text_artifact_score(candidate)

    repaired = re.sub(r"[ \t]+\n", "\n", repaired)
    repaired = re.sub(r"\n{3,}", "\n\n", repaired)
    return repaired.strip()


def fetch(url: str, accept: str = "text/html,application/json") -> tuple[str, str]:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urlopen(req, timeout=30) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace"), resp.headers.get_content_type()


def fetch_json(url: str) -> dict:
    text, content_type = fetch(url)
    if "json" not in content_type and not text.lstrip().startswith("{"):
        raise ValueError("Expected JSON response")
    return json.loads(text)


def post_json(url: str, headers: dict[str, str], data: bytes = b"") -> dict:
    req = Request(url, headers=headers, method="POST", data=data)
    with urlopen(req, timeout=30) as resp:
        text = resp.read().decode(resp.headers.get_content_charset() or "utf-8", errors="replace")
    return json.loads(text)


def x_guest_token() -> str:
    global X_GUEST_TOKEN
    if X_GUEST_TOKEN:
        return X_GUEST_TOKEN

    data = post_json(
        "https://api.x.com/1.1/guest/activate.json",
        headers={
            "authorization": f"Bearer {X_BEARER_TOKEN}",
            "content-type": "application/json",
            "user-agent": USER_AGENT,
        },
    )
    token = data.get("guest_token")
    if not token:
        raise ValueError("Could not acquire X guest token")
    X_GUEST_TOKEN = token
    return token


def x_api_json(url: str) -> dict:
    req = Request(
        url,
        headers={
            "authorization": f"Bearer {X_BEARER_TOKEN}",
            "x-guest-token": x_guest_token(),
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "en",
            "user-agent": USER_AGENT,
            "referer": "https://x.com/",
        },
    )
    with urlopen(req, timeout=60) as resp:
        text = resp.read().decode(resp.headers.get_content_charset() or "utf-8", errors="replace")
    return json.loads(text)


def download_bytes(url: str) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=60) as resp:
        return resp.read()


def google_drive_service(credentials_path: Path):
    ok, message = drive_support_available()
    if not ok:
        raise RuntimeError(message or "Google Drive support is not available.")
    if not credentials_path.exists():
        raise FileNotFoundError(
            f"Could not find Google OAuth client file at {credentials_path}. "
            "Download a Desktop app credentials JSON from Google Cloud and point the app to it."
        )

    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    token_path = drive_token_path(credentials_path)
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), DRIVE_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), DRIVE_SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    return build("drive", "v3", credentials=creds)


def upload_directory_to_google_drive(out_dir: Path, credentials_path: Path, parent_folder_id: str | None = None) -> DriveUpload:
    from googleapiclient.http import MediaFileUpload

    service = google_drive_service(credentials_path)
    folder_mime = "application/vnd.google-apps.folder"
    folder_map: dict[Path, str] = {}
    uploaded_files: dict[str, str] = {}

    def create_folder(name: str, parent_id: str | None) -> str:
        metadata = {"name": name, "mimeType": folder_mime}
        if parent_id:
            metadata["parents"] = [parent_id]
        result = service.files().create(body=metadata, fields="id").execute()
        return result["id"]

    root_folder_id = create_folder(out_dir.name, parent_folder_id)
    folder_map[out_dir.resolve()] = root_folder_id

    for path in sorted(out_dir.rglob("*")):
        if not path.is_dir():
            continue
        parent_id = folder_map[path.parent.resolve()]
        folder_map[path.resolve()] = create_folder(path.name, parent_id)

    for path in sorted(out_dir.rglob("*")):
        if not path.is_file():
            continue
        parent_id = folder_map[path.parent.resolve()]
        metadata = {"name": path.name, "parents": [parent_id]}
        media = MediaFileUpload(str(path), mimetype=best_mime_type(path), resumable=False)
        result = service.files().create(body=metadata, media_body=media, fields="id,webViewLink").execute()
        uploaded_files[path.relative_to(out_dir).as_posix()] = result.get("webViewLink") or f"https://drive.google.com/file/d/{result['id']}/view"

    return DriveUpload(
        folder_id=root_folder_id,
        folder_url=f"https://drive.google.com/drive/folders/{root_folder_id}",
        uploaded_files=uploaded_files,
        note="Uploaded through the Google Drive API using your local desktop OAuth session.",
    )


def normalize_url(url: str) -> str:
    url = url.strip()
    if not url:
        raise ValueError("Empty URL")
    if not re.match(r"^https?://", url, flags=re.IGNORECASE):
        url = "https://" + url
    return url


def classify_url(url: str) -> str:
    path = urlparse(url).path.lower()
    if "/status/" in path:
        return "tweet"
    if "/i/article/" in path or "/article/" in path:
        return "article"
    return "page"


def strip_tags(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    parser.close()
    return repair_text_artifacts(parser.text())


def extract_meta(html: str, name: str) -> str | None:
    patterns = [
        rf'<meta[^>]+property=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)["\']',
        rf'<meta[^>]+name=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)["\']',
    ]
    for pattern in patterns:
        match = re.search(pattern, html, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return repair_text_artifacts(unescape(match.group(1)).strip())
    return None


def tweet_id_from_url(url: str) -> str:
    match = re.search(r"/status/(\d+)", urlparse(url).path)
    if not match:
        raise ValueError("Could not find tweet id in URL")
    return match.group(1)


def canonical_article_tweet_id(url: str) -> str | None:
    match = re.search(r"^/[^/]+/article/(\d+)$", urlparse(url).path)
    return match.group(1) if match else None


def expand_urls(text: str, entities: dict) -> str:
    for item in entities.get("urls", []):
        short = item.get("url")
        expanded = item.get("expanded_url") or item.get("display_url")
        if short and expanded:
            text = text.replace(short, expanded)
    return repair_text_artifacts(text)


def fetch_tweet_payload(tweet_id: str) -> dict:
    url = f"https://cdn.syndication.twimg.com/tweet-result?id={tweet_id}&lang=en&token=1"
    data = fetch_json(url)
    if not data or not data.get("id_str"):
        raise ValueError("X returned an empty tweet payload")
    return data


def fetch_tweet_graphql(tweet_id: str) -> dict:
    params = {
        "variables": json.dumps(
            {
                "tweetId": str(tweet_id),
                "includePromotedContent": True,
                "withBirdwatchNotes": True,
                "withVoice": True,
                "withCommunity": True,
            },
            separators=(",", ":"),
        ),
        "features": json.dumps(X_TWEET_RESULT_FEATURES, separators=(",", ":")),
        "fieldToggles": json.dumps(X_TWEET_RESULT_FIELD_TOGGLES, separators=(",", ":")),
    }
    url = (
        f"https://api.x.com/graphql/{X_TWEET_RESULT_QUERY_ID}/TweetResultByRestId?"
        + urlencode(params)
    )
    data = x_api_json(url)
    result = (((data.get("data") or {}).get("tweetResult") or {}).get("result")) or {}
    if result.get("__typename") != "Tweet":
        raise ValueError("Could not fetch X tweet GraphQL payload")
    return result


def article_entities_to_media(article_result: dict) -> list[MediaAsset]:
    media: list[MediaAsset] = []
    seen: set[str] = set()

    cover = (((article_result.get("cover_media") or {}).get("media_info")) or {}).get("original_img_url")
    if cover and cover not in seen:
        seen.add(cover)
        media.append(MediaAsset(source_url=cover, label="article-cover", kind="image"))

    for item in article_result.get("media_entities") or []:
        media_url = (((item.get("media_info") or {}).get("original_img_url")) or "")
        if media_url and media_url not in seen:
            seen.add(media_url)
            media.append(MediaAsset(source_url=media_url, label=Path(urlparse(media_url).path).name, kind="image"))

    return media


def article_blocks_to_text(blocks: list[dict]) -> str:
    lines: list[str] = []
    paragraph_parts: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_parts:
            lines.extend([" ".join(paragraph_parts).strip(), ""])
            paragraph_parts.clear()

    for block in blocks:
        block_type = block.get("type")
        text = repair_text_artifacts((block.get("text") or "").strip())
        if block_type == "atomic":
            flush_paragraph()
            continue
        if not text:
            flush_paragraph()
            continue
        if block_type == "header-two":
            flush_paragraph()
            lines.extend(["", text, "-" * len(text), ""])
        elif block_type == "header-three":
            flush_paragraph()
            lines.extend([f"### {text}", ""])
        elif block_type == "unordered-list-item":
            flush_paragraph()
            lines.append(f"- {text}")
        elif block_type == "ordered-list-item":
            flush_paragraph()
            lines.append(f"1. {text}")
        else:
            paragraph_parts.append(text)
    flush_paragraph()
    body = "\n".join(lines)
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body.strip()


def article_source_from_graphql(tweet_result: dict, url: str) -> SourceContent | None:
    article_result = ((((tweet_result.get("article") or {}).get("article_results")) or {}).get("result")) or {}
    if not article_result or not article_result.get("content_state"):
        return None

    user_result = ((((tweet_result.get("core") or {}).get("user_results")) or {}).get("result")) or {}
    legacy = tweet_result.get("legacy") or {}
    blocks = (article_result.get("content_state") or {}).get("blocks") or []
    body = article_blocks_to_text(blocks)
    title = repair_text_artifacts(article_result.get("title") or "X Article")
    user_core = user_result.get("core") or {}
    screen_name = user_core.get("screen_name") or legacy.get("screen_name")
    user_name = user_core.get("name") or user_result.get("legacy", {}).get("name") or user_result.get("name")
    author = None
    if user_name and screen_name:
        author = repair_text_artifacts(f"{user_name} (@{screen_name})")
    elif screen_name:
        author = repair_text_artifacts(f"@{screen_name}")

    published = None
    metadata = article_result.get("metadata") or {}
    if metadata.get("first_published_at_secs"):
        published = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(metadata["first_published_at_secs"]))
    elif legacy.get("created_at"):
        published = legacy["created_at"]

    note = f"Captured from X article attached to tweet: {url}"
    return SourceContent(
        url=url,
        kind="article",
        title=title,
        author=author,
        published=published,
        body=body,
        note=note,
        media=article_entities_to_media(article_result),
    )


def build_tweet_media(payload: dict) -> list[MediaAsset]:
    media: list[MediaAsset] = []
    seen: set[str] = set()

    for item in payload.get("mediaDetails") or []:
        media_url = item.get("media_url_https")
        if media_url and media_url not in seen:
            seen.add(media_url)
            media.append(
                MediaAsset(
                    source_url=media_url,
                    label=item.get("display_url") or Path(urlparse(media_url).path).name,
                    kind=item.get("type") or "image",
                )
            )

    article = payload.get("article") or {}
    cover = (((article.get("cover_media") or {}).get("media_info")) or {}).get("original_img_url")
    if cover and cover not in seen:
        seen.add(cover)
        media.append(MediaAsset(source_url=cover, label="article-cover", kind="image"))

    return media


def parse_tweet(url: str) -> SourceContent:
    try:
        tweet_result = fetch_tweet_graphql(tweet_id_from_url(url))
        article_source = article_source_from_graphql(tweet_result, url)
        if article_source:
            try:
                payload = fetch_tweet_payload(tweet_id_from_url(url))
            except Exception:
                payload = None
            if payload:
                existing = {asset.source_url for asset in article_source.media}
                for asset in build_tweet_media(payload):
                    if asset.source_url not in existing:
                        article_source.media.append(asset)
            return article_source
    except Exception:
        tweet_result = None

    payload = fetch_tweet_payload(tweet_id_from_url(url))

    user = payload.get("user") or {}
    screen_name = user.get("screen_name")
    author_name = user.get("name")
    author = f"{author_name} (@{screen_name})" if author_name and screen_name else author_name or screen_name

    text = repair_text_artifacts(payload.get("text") or "")
    text = expand_urls(text, payload.get("entities") or {})

    sections = [text.strip()]
    article = payload.get("article") or {}
    if article.get("title") and article.get("preview_text"):
        sections.append(
            "\n".join(
                [
                    "Attached X Article",
                    "------------------",
                    repair_text_artifacts(article["title"].strip()),
                    "",
                    repair_text_artifacts(article["preview_text"].strip()),
                    "",
                    f"Article URL: https://x.com/i/article/{article['rest_id']}",
                ]
            )
        )

    note = None
    if article.get("title") and article.get("preview_text"):
        note = (
            "X exposed the attached Article preview and cover image from the public tweet payload. "
            "The full Article body was not available from the fallback export path."
        )

    return SourceContent(
        url=url,
        kind="tweet",
        title=repair_text_artifacts(f"Tweet by @{screen_name}" if screen_name else "X tweet"),
        author=author,
        published=payload.get("created_at"),
        body=repair_text_artifacts("\n\n".join(part for part in sections if part.strip())),
        note=note,
        media=build_tweet_media(payload),
    )


def edge_binary() -> str | None:
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def dump_dom_with_edge(url: str, timeout: int = 60) -> str | None:
    edge = edge_binary()
    if not edge:
        return None

    result = subprocess.run(
        [
            edge,
            "--headless",
            "--disable-gpu",
            "--virtual-time-budget=12000",
            "--dump-dom",
            url,
        ],
        capture_output=True,
        timeout=timeout,
    )
    if result.returncode != 0 or not result.stdout:
        return None
    return result.stdout.decode("utf-8", errors="ignore")


def parse_x_article(url: str) -> SourceContent:
    article_tweet_id = canonical_article_tweet_id(url)
    if article_tweet_id:
        tweet_result = fetch_tweet_graphql(article_tweet_id)
        article_source = article_source_from_graphql(tweet_result, url)
        if article_source:
            return article_source

    dom = dump_dom_with_edge(url)
    note = None
    title = f"X Article {urlparse(url).path.rsplit('/', 1)[-1]}"
    body = ""

    if dom:
        page_title = extract_meta(dom, "og:title")
        if page_title and page_title != "X":
            title = page_title

        candidate = strip_tags(dom)
        unsupported_markers = [
            "There is no support for this page",
            "You must visit the author's profile in the latest version of X",
            "אין תמיכה בדף הזה",
        ]
        if candidate and not any(marker in candidate for marker in unsupported_markers):
            body = candidate
        else:
            note = (
                "This X Article did not expose its full body in the public page response on this machine. "
                "X appears to gate the real Article content behind a richer browser or session flow."
            )

    if not body:
        html, _ = fetch(url)
        title = extract_meta(html, "og:title") or title
        description = extract_meta(html, "og:description")
        if description:
            body = description
        elif note is None:
            note = "Could not extract a readable body from the public Article response."
        if not body:
            body = "The full X Article body was not available from the public response."

    return SourceContent(
        url=url,
        kind="article",
        title=title,
        author=None,
        published=None,
        body=body,
        note=note,
        media=[],
    )


def parse_generic_page(url: str) -> SourceContent:
    html, _ = fetch(url)
    title = extract_meta(html, "og:title")
    if not title:
        match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
        title = unescape(match.group(1)).strip() if match else url

    author = extract_meta(html, "author") or extract_meta(html, "article:author")
    published = extract_meta(html, "article:published_time") or extract_meta(html, "date")
    body = strip_tags(html)
    return SourceContent(
        url=url,
        kind="page",
        title=repair_text_artifacts(title),
        author=repair_text_artifacts(author) if author else None,
        published=published,
        body=repair_text_artifacts(body),
    )


def parse_source(url: str) -> SourceContent:
    kind = classify_url(url)
    if kind == "tweet":
        return parse_tweet(url)
    if kind == "article":
        return parse_x_article(url)
    return parse_generic_page(url)


def source_preview(url: str) -> dict[str, str | int | bool | None]:
    normalized = normalize_url(url)
    source = parse_source(normalized)
    compact_body = re.sub(r"\s+", " ", source.body).strip()
    excerpt = compact_body[:420].rstrip()
    if len(compact_body) > len(excerpt):
        excerpt += "..."
    return {
        "ok": True,
        "url": normalized,
        "kind": source.kind,
        "title": source.title,
        "author": source.author,
        "published": source.published,
        "excerpt": excerpt,
        "media_count": len(source.media),
        "note": source.note,
    }


def safe_extension_from_url(url: str, fallback: str = ".jpg") -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    return suffix if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp"} else fallback


def download_media_assets(source: SourceContent, asset_dir: Path) -> list[str]:
    saved: list[str] = []
    if not source.media:
        return saved

    asset_dir.mkdir(parents=True, exist_ok=True)
    for index, asset in enumerate(source.media, start=1):
        ext = safe_extension_from_url(asset.source_url)
        destination = asset_dir / f"image-{index:02d}{ext}"
        destination.write_bytes(download_bytes(asset.source_url))
        asset.local_path = str(destination)
        saved.append(str(destination))
    return saved


def build_header(source: SourceContent) -> list[str]:
    lines = [source.title, "=" * len(source.title), "", "Metadata", "--------", f"Source: {source.url}"]
    if source.author:
        lines.append(f"Author: {source.author}")
    if source.published:
        lines.append(f"Published: {source.published}")
    if source.note:
        lines.append(f"Note: {source.note}")
    lines.extend(["", "Content", "-------", ""])
    return lines


def make_txt_content(source: SourceContent) -> str:
    lines = build_header(source)
    lines.append(source.body.strip())
    if source.media:
        lines.extend(["", "Images", "------"])
        for asset in source.media:
            lines.append(f"- {asset.local_path or asset.source_url}")
    return "\n".join(lines).strip() + "\n"


def relative_media_paths(source: SourceContent, base_dir: Path) -> list[str]:
    paths: list[str] = []
    for asset in source.media:
        if asset.local_path:
            try:
                paths.append(Path(asset.local_path).relative_to(base_dir).as_posix())
            except ValueError:
                paths.append(Path(asset.local_path).name)
    return paths


def make_md_content(source: SourceContent, base_dir: Path) -> str:
    lines = [
        "---",
        f'title: "{source.title.replace(chr(34), chr(39))}"',
        f'kind: "{source.kind}"',
        f'source_url: "{source.url}"',
    ]
    if source.author:
        lines.append(f'author: "{source.author.replace(chr(34), chr(39))}"')
    if source.published:
        lines.append(f'published: "{source.published.replace(chr(34), chr(39))}"')
    lines.extend(["---", "", f"# {source.title}", "", "## Source Metadata", "", f"- Source: {source.url}"])
    if source.author:
        lines.append(f"- Author: {source.author}")
    if source.published:
        lines.append(f"- Published: {source.published}")
    if source.note:
        lines.append(f"- Note: {source.note}")
    lines.extend(["", "## Content", "", source.body.strip()])
    media_paths = relative_media_paths(source, base_dir)
    if media_paths:
        lines.extend(["", "## Images"])
    for index, rel_path in enumerate(relative_media_paths(source, base_dir), start=1):
        lines.extend(["", f"![Image {index}]({rel_path})"])
    return "\n".join(lines).strip() + "\n"


def body_text_to_html(body: str) -> str:
    lines = body.splitlines()
    parts: list[str] = []
    paragraph: list[str] = []
    list_items: list[str] = []
    ordered_list = False

    def flush_paragraph() -> None:
        if paragraph:
            parts.append(f"<p>{' '.join(paragraph)}</p>")
            paragraph.clear()

    def flush_list() -> None:
        nonlocal ordered_list
        if not list_items:
            return
        tag = "ol" if ordered_list else "ul"
        items = "".join(f"<li>{item}</li>" for item in list_items)
        parts.append(f"<{tag}>{items}</{tag}>")
        list_items.clear()
        ordered_list = False

    index = 0
    while index < len(lines):
        line = lines[index].strip()
        next_line = lines[index + 1].strip() if index + 1 < len(lines) else ""

        if not line:
            flush_paragraph()
            flush_list()
            index += 1
            continue

        if next_line and re.fullmatch(r"-{3,}", next_line):
            flush_paragraph()
            flush_list()
            parts.append(f"<h2>{escape(line)}</h2>")
            index += 2
            continue

        if line.startswith("### "):
            flush_paragraph()
            flush_list()
            parts.append(f"<h3>{escape(line[4:])}</h3>")
            index += 1
            continue

        unordered = re.match(r"^- (.+)", line)
        ordered = re.match(r"^1\. (.+)", line)
        if unordered or ordered:
            flush_paragraph()
            is_ordered = bool(ordered)
            if list_items and ordered_list != is_ordered:
                flush_list()
            ordered_list = is_ordered
            list_items.append(escape((ordered or unordered).group(1)))
            index += 1
            continue

        flush_list()
        paragraph.append(escape(line))
        index += 1

    flush_paragraph()
    flush_list()
    return "\n".join(parts)


def make_html_snapshot(source: SourceContent, base_dir: Path) -> str:
    title = escape(source.title)
    body = body_text_to_html(source.body)
    metadata = [f'<p class="source">Source: <a href="{escape(source.url, quote=True)}">{escape(source.url)}</a></p>']
    if source.author:
        metadata.append(f"<p><strong>Author:</strong> {escape(source.author)}</p>")
    if source.published:
        metadata.append(f"<p><strong>Published:</strong> {escape(source.published)}</p>")
    if source.note:
        metadata.append(f'<p class="note"><strong>Note:</strong> {escape(source.note)}</p>')

    images = []
    for index, rel_path in enumerate(relative_media_paths(source, base_dir), start=1):
        images.append(
            f"""
            <figure>
              <img src="{escape(rel_path, quote=True)}" alt="Image {index}">
              <figcaption>Image {index}</figcaption>
            </figure>
            """
        )

    return textwrap.dedent(
        f"""\
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>{title}</title>
          <style>
            :root {{
              --ink: #1e2330;
              --muted: #596579;
              --paper: #f5efe4;
              --panel: rgba(255,255,255,0.78);
              --line: #d6c8b5;
              --accent: #cb5f34;
            }}
            body {{
              margin: 0;
              background:
                radial-gradient(circle at top left, rgba(203, 95, 52, 0.16), transparent 30%),
                linear-gradient(180deg, #efe4d1 0%, #f5efe4 100%);
              color: var(--ink);
              font: 17px/1.7 "Iowan Old Style", "Palatino Linotype", Georgia, serif;
            }}
            main {{
              max-width: 860px;
              margin: 0 auto;
              padding: 42px 24px 72px;
            }}
            h1 {{
              margin: 0 0 18px;
              font-size: 2.6rem;
              line-height: 1.05;
            }}
            .meta {{
              padding: 18px 20px;
              background: var(--panel);
              border: 1px solid var(--line);
              border-radius: 18px;
              margin-bottom: 24px;
            }}
            .source, .note {{
              color: var(--muted);
            }}
            article {{
              padding: 24px;
              border-radius: 22px;
              background: var(--panel);
              border: 1px solid var(--line);
            }}
            h2, h3 {{
              margin-top: 1.8rem;
              color: var(--accent);
            }}
            p {{ margin: 0 0 1rem; }}
            ul, ol {{ margin: 0 0 1rem 1.4rem; }}
            figure {{
              margin: 24px 0;
              padding: 12px;
              background: rgba(255,255,255,0.84);
              border: 1px solid var(--line);
              border-radius: 18px;
            }}
            img {{
              display: block;
              max-width: 100%;
              margin: 0 auto;
              border-radius: 12px;
            }}
            figcaption {{
              margin-top: 10px;
              color: var(--muted);
              text-align: center;
              font-size: 0.95rem;
            }}
          </style>
        </head>
        <body>
          <main>
            <h1>{title}</h1>
            <section class="meta">
              {''.join(metadata)}
            </section>
            <article>
              {body}
              {''.join(images)}
            </article>
          </main>
        </body>
        </html>
        """
    ).strip() + "\n"


def html_to_pdf(html_path: Path, pdf_path: Path) -> bool:
    edge = edge_binary()
    if not edge:
        return False

    result = subprocess.run(
        [
            edge,
            "--headless",
            "--disable-gpu",
            "--allow-file-access-from-files",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_path.resolve()}",
            html_path.resolve().as_uri(),
        ],
        capture_output=True,
        timeout=120,
    )
    return result.returncode == 0 and pdf_path.exists()


def write_source_outputs(source: SourceContent, out_dir: Path, export_formats: set[str], include_media: bool) -> SourceRecord:
    base_name = slugify(f"{source.title}-{urlparse(source.url).path.split('/')[-1]}")
    asset_dir = out_dir / f"{base_name}_assets"

    media_files = download_media_assets(source, asset_dir) if include_media else []
    generated_files: list[str] = []

    if "txt" in export_formats:
        txt_path = out_dir / f"{base_name}.txt"
        txt_path.write_text(make_txt_content(source), encoding="utf-8")
        generated_files.append(str(txt_path))

    html_path: Path | None = None
    if "html" in export_formats or "pdf" in export_formats:
        html_path = out_dir / f"{base_name}.html"
        html_path.write_text(make_html_snapshot(source, out_dir), encoding="utf-8")
        if "html" in export_formats:
            generated_files.append(str(html_path))

    if "md" in export_formats:
        md_path = out_dir / f"{base_name}.md"
        md_path.write_text(make_md_content(source, out_dir), encoding="utf-8")
        generated_files.append(str(md_path))

    if "pdf" in export_formats and html_path:
        pdf_path = out_dir / f"{base_name}.pdf"
        if html_to_pdf(html_path, pdf_path):
            generated_files.append(str(pdf_path))
        else:
            source.note = (source.note + " " if source.note else "") + "PDF export was requested, but Edge PDF generation was not available."

    return SourceRecord(
        url=source.url,
        kind=source.kind,
        title=source.title,
        author=source.author,
        published=source.published,
        output_files=generated_files,
        media_files=media_files,
        note=source.note,
    )


def build_manifest(records: Iterable[SourceRecord], out_dir: Path) -> Path:
    manifest = out_dir / "manifest.json"
    manifest.write_text(json.dumps([asdict(record) for record in records], indent=2, ensure_ascii=False), encoding="utf-8")
    return manifest


def build_batch_guide(records: list[SourceRecord], failures: list[tuple[str, str]], out_dir: Path) -> Path:
    lines = [
        "# NotebookLM Import Guide",
        "",
        "This folder was generated by the local X-to-NotebookLM app.",
        "",
        "## Recommended upload flow",
        "",
        "1. Open NotebookLM.",
        "2. Create a notebook or open an existing one.",
        "3. Add the `.md`, `.txt`, or `.pdf` files from this folder.",
        "4. If you uploaded this batch to Google Drive, use NotebookLM's Google Drive source picker.",
        "",
        "## Sources in this batch",
        "",
    ]
    if records:
        for record in records:
            lines.append(f"### {record.title}")
            lines.append("")
            lines.append(f"- Source URL: {record.url}")
            if record.author:
                lines.append(f"- Author: {record.author}")
            if record.published:
                lines.append(f"- Published: {record.published}")
            lines.append("- Files:")
            for file_path in record.output_files:
                lines.append(f"  - {Path(file_path).name}")
            for media_path in record.media_files:
                lines.append(f"  - {Path(media_path).relative_to(out_dir).as_posix()}")
            if record.note:
                lines.append(f"- Note: {record.note}")
            lines.append("")
    else:
        lines.extend(["No source files were generated.", ""])

    if failures:
        lines.extend(["## Failed URLs", ""])
        for url, reason in failures:
            lines.append(f"- {url}: {reason}")
        lines.append("")

    guide_path = out_dir / "README-IMPORT.md"
    guide_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return guide_path


def build_zip(out_dir: Path, zip_name: str = "notebooklm_sources.zip") -> Path:
    zip_path = out_dir / zip_name
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(out_dir.rglob("*")):
            if path.is_file() and path.name != zip_name:
                archive.write(path, arcname=path.relative_to(out_dir).as_posix())
    return zip_path


def run_batch(
    urls: list[str],
    out_dir: Path,
    export_formats: set[str],
    include_media: bool,
    upload_to_drive: bool = False,
    drive_credentials_path: Path | None = None,
    drive_parent_id: str | None = None,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    records: list[SourceRecord] = []
    failures: list[tuple[str, str]] = []

    for url in urls:
        try:
            source = parse_source(url)
            records.append(write_source_outputs(source, out_dir, export_formats, include_media))
        except (HTTPError, URLError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
            failures.append((url, f"{type(exc).__name__}: {exc}"))

    manifest = build_manifest(records, out_dir)
    guide = build_batch_guide(records, failures, out_dir)
    drive_upload: DriveUpload | None = None
    drive_error: str | None = None
    if upload_to_drive:
        if not drive_credentials_path:
            drive_error = "Google Drive upload was requested, but no credentials file was provided."
        else:
            try:
                drive_upload = upload_directory_to_google_drive(out_dir, drive_credentials_path, drive_parent_id)
                for record in records:
                    for file_path in [*record.output_files, *record.media_files]:
                        rel_path = Path(file_path).relative_to(out_dir).as_posix()
                        if rel_path in drive_upload.uploaded_files:
                            record.drive_files[rel_path] = drive_upload.uploaded_files[rel_path]
            except Exception as exc:
                drive_error = f"{type(exc).__name__}: {exc}"
    bundle = build_zip(out_dir)
    return {
        "records": records,
        "failures": failures,
        "manifest": manifest,
        "guide": guide,
        "bundle": bundle,
        "out_dir": out_dir,
        "drive_upload": drive_upload,
        "drive_error": drive_error,
    }


def make_job_id() -> str:
    return f"job-{int(time.time() * 1000)}"


def register_job(job: dict) -> str:
    job_id = make_job_id()
    job["job_id"] = job_id
    with STATUS_LOCK:
        JOBS[job_id] = job
        RECENT_JOB_IDS.appendleft(job_id)
    return job_id


def get_job(job_id: str) -> dict | None:
    with STATUS_LOCK:
        return JOBS.get(job_id)


def parse_urls_text(text: str) -> list[str]:
    urls: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            urls.append(normalize_url(line))
    deduped: list[str] = []
    for url in urls:
        if url not in deduped:
            deduped.append(url)
    return deduped


def render_page(title: str, body: str) -> str:
    return textwrap.dedent(
        f"""\
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>{escape(title)}</title>
          <style>
            :root {{
              --bg: #f4ead8;
              --bg2: #f8f2e8;
              --panel: rgba(255, 251, 244, 0.84);
              --panel-strong: rgba(255, 248, 239, 0.94);
              --text: #1e2430;
              --muted: #5f6979;
              --line: rgba(66, 53, 38, 0.14);
              --accent: #c75d2c;
              --accent-2: #0f766e;
              --accent-3: #d7a83d;
              --good: #12715b;
              --warn: #9a6700;
              --shadow: 0 24px 80px rgba(76, 49, 18, 0.12);
            }}
            * {{ box-sizing: border-box; }}
            body {{
              margin: 0;
              min-height: 100vh;
              color: var(--text);
              font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
              background:
                radial-gradient(circle at top left, rgba(199, 93, 44, 0.16), transparent 30%),
                radial-gradient(circle at top right, rgba(15, 118, 110, 0.12), transparent 26%),
                radial-gradient(circle at bottom left, rgba(215, 168, 61, 0.1), transparent 24%),
                linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
            }}
            a {{ color: var(--accent-2); text-decoration: none; }}
            a:hover {{ text-decoration: underline; }}
            .shell {{ max-width: 1180px; margin: 0 auto; padding: 32px 18px 72px; }}
            .hero {{
              display: grid;
              grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
              gap: 18px;
              align-items: stretch;
            }}
            .title {{
              margin: 0;
              font-size: clamp(2.4rem, 5vw, 5rem);
              line-height: 0.9;
              letter-spacing: -0.03em;
            }}
            .eyebrow {{
              display: inline-flex;
              margin-bottom: 14px;
              padding: 6px 12px;
              border-radius: 999px;
              background: rgba(199, 93, 44, 0.1);
              color: var(--accent);
              font-size: 0.86rem;
              font-weight: 700;
              letter-spacing: 0.03em;
              text-transform: uppercase;
            }}
            .subtitle {{
              color: var(--muted);
              margin: 14px 0 0;
              max-width: 65ch;
              font-size: 1.05rem;
            }}
            .card {{
              background: var(--panel);
              border: 1px solid var(--line);
              border-radius: 24px;
              backdrop-filter: blur(18px);
              box-shadow: var(--shadow);
            }}
            .pad {{ padding: 22px; }}
            .grid {{
              display: grid;
              grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
              gap: 18px;
            }}
            .stack {{ display: grid; gap: 14px; }}
            label {{
              display: block;
              margin-bottom: 8px;
              color: var(--muted);
              font-size: 0.92rem;
            }}
            textarea, input[type="text"] {{
              width: 100%;
              padding: 14px 16px;
              border-radius: 16px;
              border: 1px solid rgba(66, 53, 38, 0.18);
              background: rgba(255, 255, 255, 0.78);
              color: var(--text);
              outline: none;
            }}
            textarea {{
              min-height: 260px;
              resize: vertical;
              line-height: 1.55;
            }}
            textarea:focus, input[type="text"]:focus {{
              border-color: rgba(15, 118, 110, 0.64);
              box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
            }}
            .checks {{
              display: grid;
              gap: 10px;
              padding: 14px 16px;
              border-radius: 16px;
              border: 1px solid rgba(66, 53, 38, 0.12);
              background: rgba(255, 255, 255, 0.62);
            }}
            .checks label {{
              margin: 0;
              color: var(--text);
            }}
            .drop-zone {{
              position: relative;
              padding: 16px;
              border-radius: 24px;
              background: rgba(255, 255, 255, 0.52);
              border: 1px dashed rgba(15, 118, 110, 0.26);
              transition: border-color 180ms ease, transform 180ms ease, background 180ms ease;
            }}
            .drop-zone.dragging {{
              border-color: rgba(199, 93, 44, 0.7);
              background: rgba(255, 248, 239, 0.9);
              transform: translateY(-2px);
            }}
            .drop-zone textarea {{
              min-height: 300px;
            }}
            .drop-header {{
              display: flex;
              justify-content: space-between;
              gap: 12px;
              align-items: center;
              flex-wrap: wrap;
              margin-bottom: 10px;
            }}
            .drop-tools {{
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
            }}
            .btn.small {{
              padding: 9px 14px;
              font-size: 0.92rem;
            }}
            .drop-hint {{
              margin-top: 10px;
              color: var(--muted);
              font-size: 0.92rem;
            }}
            .field-note {{
              margin-top: 8px;
              color: var(--muted);
              font-size: 0.9rem;
              line-height: 1.45;
            }}
            .row {{
              display: flex;
              flex-wrap: wrap;
              align-items: center;
              gap: 12px;
              margin-top: 16px;
            }}
            .btn {{
              display: inline-flex;
              align-items: center;
              justify-content: center;
              border: 0;
              border-radius: 999px;
              padding: 12px 18px;
              font-weight: 700;
              cursor: pointer;
              color: #fff8f0;
              background: linear-gradient(135deg, var(--accent), #de7b35);
              text-decoration: none;
              box-shadow: 0 10px 30px rgba(199, 93, 44, 0.22);
            }}
            .btn.secondary {{
              color: var(--text);
              background: rgba(255, 255, 255, 0.56);
              border: 1px solid rgba(66, 53, 38, 0.16);
              box-shadow: none;
            }}
            .btn.ghost {{
              color: var(--accent-2);
              background: rgba(15, 118, 110, 0.08);
              border: 1px solid rgba(15, 118, 110, 0.16);
              box-shadow: none;
            }}
            .panel {{
              margin-top: 20px;
              background: var(--panel-strong);
              border: 1px solid var(--line);
              border-radius: 20px;
              padding: 18px;
            }}
            .pill {{
              display: inline-flex;
              border-radius: 999px;
              padding: 4px 10px;
              font-size: 0.8rem;
              font-weight: 700;
              background: rgba(15, 118, 110, 0.1);
              color: var(--accent-2);
            }}
            .pill.ok {{ background: rgba(128, 237, 153, 0.14); color: var(--good); }}
            .pill.warn {{ background: rgba(154, 103, 0, 0.12); color: var(--warn); }}
            .muted {{ color: var(--muted); }}
            .files {{
              display: grid;
              gap: 10px;
              margin-top: 14px;
            }}
            .file {{
              display: flex;
              justify-content: space-between;
              gap: 12px;
              align-items: center;
              padding: 14px 16px;
              border-radius: 14px;
              background: rgba(255, 255, 255, 0.56);
              border: 1px solid rgba(66, 53, 38, 0.12);
            }}
            .stat-grid {{
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 12px;
            }}
            .stat {{
              padding: 16px;
              border-radius: 16px;
              background: rgba(255, 255, 255, 0.6);
              border: 1px solid rgba(66, 53, 38, 0.12);
            }}
            .stat strong {{
              display: block;
              margin-bottom: 4px;
              font-size: 1.5rem;
            }}
            .mini-grid {{
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 12px;
              margin-top: 18px;
            }}
            .mini-card {{
              padding: 16px;
              border-radius: 18px;
              background: rgba(255, 255, 255, 0.6);
              border: 1px solid rgba(66, 53, 38, 0.12);
            }}
            .mini-card strong {{
              display: block;
              margin-bottom: 6px;
              font-size: 1rem;
            }}
            .preview-card {{
              padding: 18px;
              border-radius: 18px;
              background: rgba(255, 255, 255, 0.62);
              border: 1px solid rgba(66, 53, 38, 0.12);
            }}
            .preview-label {{
              color: var(--muted);
              font-size: 0.84rem;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }}
            .preview-title {{
              margin: 8px 0 0;
              font-size: 1.18rem;
              line-height: 1.2;
            }}
            .preview-meta {{
              margin-top: 10px;
              color: var(--muted);
              font-size: 0.92rem;
              line-height: 1.5;
            }}
            .preview-snippet {{
              margin-top: 12px;
              line-height: 1.6;
            }}
            .status-row {{
              display: flex;
              align-items: center;
              gap: 8px;
              color: var(--muted);
              font-size: 0.92rem;
            }}
            .status-dot {{
              width: 10px;
              height: 10px;
              border-radius: 999px;
              background: var(--accent-3);
              flex: 0 0 auto;
            }}
            .status-dot.ok {{ background: var(--good); }}
            .status-dot.warn {{ background: var(--accent); }}
            .actions {{
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              margin-top: 16px;
            }}
            .link-row {{
              display: flex;
              flex-wrap: wrap;
              gap: 10px;
              align-items: center;
            }}
            .link-badge {{
              display: inline-flex;
              padding: 7px 10px;
              border-radius: 999px;
              background: rgba(15, 118, 110, 0.08);
              border: 1px solid rgba(15, 118, 110, 0.14);
              color: var(--accent-2);
              font-weight: 700;
              font-size: 0.86rem;
            }}
            .inline-code {{
              font-family: "Cascadia Code", Consolas, monospace;
              font-size: 0.92rem;
            }}
            code {{
              white-space: pre-wrap;
              word-break: break-word;
            }}
            .steps {{
              margin: 14px 0 0;
              padding-left: 20px;
              color: var(--muted);
            }}
            .steps li + li {{ margin-top: 8px; }}
            @media (max-width: 900px) {{
              .hero, .grid, .stat-grid, .mini-grid {{ grid-template-columns: 1fr; }}
            }}
          </style>
        </head>
        <body>
          <div class="shell">{body}</div>
          <script>
            (() => {{
              const textarea = document.getElementById("urls");
              const dropZone = document.getElementById("drop-zone");
              const hint = document.getElementById("drop-hint");
              const count = document.getElementById("url-count");
              const pasteButton = document.getElementById("paste-clipboard");
              const clearButton = document.getElementById("clear-urls");
              const sampleButton = document.getElementById("load-sample");
              const previewTitle = document.getElementById("preview-title");
              const previewMeta = document.getElementById("preview-meta");
              const previewBody = document.getElementById("preview-body");
              const previewNote = document.getElementById("preview-note");
              const previewStatus = document.getElementById("preview-status");
              const defaultHint = hint ? hint.textContent : "";
              const sampleUrl = "https://x.com/itsolelehmann/status/2033919415771713715?s=20";
              let previewTimer = null;
              let previewController = null;

              if (!textarea) {{
                return;
              }}

              const setHint = (message) => {{
                if (hint) {{
                  hint.textContent = message;
                }}
              }};

              const setPreview = (payload = null) => {{
                if (!previewTitle || !previewMeta || !previewBody || !previewStatus || !previewNote) {{
                  return;
                }}
                if (!payload) {{
                  previewTitle.textContent = "No preview yet";
                  previewMeta.textContent = "Paste or drag in a URL and the app will preview the first source here.";
                  previewBody.textContent = "The preview card shows the title, source type, metadata, and a short excerpt before export.";
                  previewStatus.innerHTML = '<span class="status-dot"></span><span>Waiting for a URL</span>';
                  previewNote.textContent = "";
                  return;
                }}
                if (!payload.ok) {{
                  previewTitle.textContent = "Preview unavailable";
                  previewMeta.textContent = payload.url || "Could not parse the first URL.";
                  previewBody.textContent = payload.error || "The app could not build a preview for that source.";
                  previewStatus.innerHTML = '<span class="status-dot warn"></span><span>Preview failed</span>';
                  previewNote.textContent = "";
                  return;
                }}

                const meta = [payload.kind];
                if (payload.author) meta.push(payload.author);
                if (payload.published) meta.push(payload.published);
                if (typeof payload.media_count === "number") meta.push(`${{payload.media_count}} image${{payload.media_count === 1 ? "" : "s"}}`);
                previewTitle.textContent = payload.title || "Untitled source";
                previewMeta.textContent = meta.join(" • ");
                previewBody.textContent = payload.excerpt || "No preview text returned.";
                previewStatus.innerHTML = '<span class="status-dot ok"></span><span>Preview ready</span>';
                previewNote.textContent = payload.note || "";
              }};

              const updateCount = () => {{
                if (!count) {{
                  return;
                }}
                const lines = textarea.value
                  .split(/\\r?\\n/)
                  .map((line) => line.trim())
                  .filter(Boolean);
                count.textContent = `${{lines.length}} URL${{lines.length === 1 ? "" : "s"}} ready`;
              }};

              const firstUrl = () => textarea.value
                .split(/\\r?\\n/)
                .map((line) => line.trim())
                .find(Boolean) || "";

              const queuePreview = () => {{
                if (!previewTitle) {{
                  return;
                }}
                const url = firstUrl();
                if (!url) {{
                  if (previewController) {{
                    previewController.abort();
                    previewController = null;
                  }}
                  setPreview(null);
                  return;
                }}
                if (previewTimer) {{
                  window.clearTimeout(previewTimer);
                }}
                previewTimer = window.setTimeout(async () => {{
                  try {{
                    if (previewController) {{
                      previewController.abort();
                    }}
                    previewController = new AbortController();
                    previewStatus.innerHTML = '<span class="status-dot"></span><span>Loading preview...</span>';
                    const response = await fetch(`/preview?url=${{encodeURIComponent(url)}}`, {{ signal: previewController.signal }});
                    const payload = await response.json();
                    setPreview(payload);
                  }} catch (error) {{
                    if (error.name !== "AbortError") {{
                      setPreview({{ ok: false, url, error: "Could not load the preview right now." }});
                    }}
                  }}
                }}, 450);
              }};

              const mergeText = (text, replace = false) => {{
                const normalized = (text || "").replace(/\\r\\n/g, "\\n").trim();
                if (!normalized) {{
                  setHint("No URL text found.");
                  return;
                }}
                textarea.value = replace || !textarea.value.trim()
                  ? normalized
                  : `${{textarea.value.trimEnd()}}\\n${{normalized}}`;
                updateCount();
                queuePreview();
              }};

              const readTextFile = (file) => new Promise((resolve, reject) => {{
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ""));
                reader.onerror = () => reject(reader.error || new Error("Could not read file."));
                reader.readAsText(file);
              }});

              textarea.addEventListener("input", () => {{
                updateCount();
                queuePreview();
              }});
              updateCount();
              setPreview(null);

              pasteButton?.addEventListener("click", async () => {{
                try {{
                  const text = await navigator.clipboard.readText();
                  mergeText(text);
                  setHint("Pasted from clipboard.");
                }} catch (error) {{
                  setHint("Clipboard paste is blocked in this browser. Paste directly into the box instead.");
                }}
              }});

              clearButton?.addEventListener("click", () => {{
                textarea.value = "";
                updateCount();
                setHint(defaultHint);
                setPreview(null);
              }});

              sampleButton?.addEventListener("click", () => {{
                mergeText(sampleUrl, true);
                setHint("Loaded the sample tweet.");
              }});

              if (dropZone) {{
                ["dragenter", "dragover"].forEach((eventName) => {{
                  dropZone.addEventListener(eventName, (event) => {{
                    event.preventDefault();
                    dropZone.classList.add("dragging");
                  }});
                }});

                ["dragleave", "dragend", "drop"].forEach((eventName) => {{
                  dropZone.addEventListener(eventName, () => {{
                    dropZone.classList.remove("dragging");
                  }});
                }});

                dropZone.addEventListener("drop", async (event) => {{
                  event.preventDefault();
                  const file = event.dataTransfer?.files?.[0];
                  if (file && (file.type.startsWith("text/") || /\\.(txt|md)$/i.test(file.name))) {{
                    try {{
                      mergeText(await readTextFile(file));
                      setHint(`Loaded URLs from ${{file.name}}.`);
                    }} catch (error) {{
                      setHint("Could not read the dropped file.");
                    }}
                    return;
                  }}

                  const uriList = event.dataTransfer?.getData("text/uri-list") || "";
                  const plainText = event.dataTransfer?.getData("text/plain") || "";
                  mergeText(uriList || plainText);
                  setHint("Added dropped text.");
                }});
              }}
            }})();
          </script>
        </body>
        </html>
        """
    ).strip()


def render_index() -> str:
    drive_state = drive_connection_status()
    recent = []
    with STATUS_LOCK:
        for job_id in list(RECENT_JOB_IDS):
            job = JOBS.get(job_id)
            if job:
                recent.append(job)

    recent_items = "\n".join(
        f"""<div class="file"><div><strong>{escape(job['job_id'])}</strong><div class="muted">{escape(str(job['out_dir']))}</div></div><a class="btn secondary" href="/job?job={escape(job['job_id'])}">Open</a></div>"""
        for job in recent[:5]
    ) or '<div class="muted">No recent jobs yet.</div>'

    if drive_state["connected"]:
        drive_card = f"""
        <div class="mini-card">
          <strong>Google Drive connected</strong>
          <div class="muted">{escape(str(drive_state["account_label"] or drive_state["message"]))}</div>
        </div>
        """
    elif drive_state["configured"]:
        drive_card = f"""
        <div class="mini-card">
          <strong>Google Drive ready</strong>
          <div class="muted">{escape(str(drive_state["message"]))}</div>
        </div>
        """
    else:
        drive_card = f"""
        <div class="mini-card">
          <strong>Google Drive setup</strong>
          <div class="muted">{escape(str(drive_state["message"]))}</div>
        </div>
        """

    body = f"""
      <div class="hero">
        <div>
          <div class="eyebrow">NotebookLM Source Builder</div>
          <h1 class="title">X to NotebookLM</h1>
          <p class="subtitle">Turn X posts and article-backed tweets into clean NotebookLM sources, keep the media with them, and optionally hand the whole batch off to Google Drive for the final upload into NotebookLM.</p>
          <div class="mini-grid">
            <div class="mini-card">
              <strong>1. Paste URLs</strong>
              <div class="muted">Tweet URLs work best, especially when the tweet contains an attached X Article.</div>
            </div>
            <div class="mini-card">
              <strong>2. Choose exports</strong>
              <div class="muted">TXT, Markdown, PDF, HTML, and images can all land in one batch folder.</div>
            </div>
            {drive_card}
          </div>
        </div>
        <div class="card pad">
          <div class="pill">Best handoff</div>
          <p style="margin:12px 0 0; line-height:1.6;">For article posts, start from the tweet URL. The app can pull the richer X article payload from the tweet result and produce cleaner Markdown and PDFs than the public article page alone.</p>
          <ol class="steps">
            <li>Paste one or more X URLs.</li>
            <li>Generate local files and review the batch.</li>
            <li>Open NotebookLM and add the local files or the uploaded Drive files.</li>
          </ol>
        </div>
      </div>

      <form class="card pad" method="post" action="/process">
        <div class="grid">
          <div>
            <div class="drop-zone" id="drop-zone">
              <div class="drop-header">
                <label for="urls" style="margin:0;">X URLs, one per line</label>
                <div class="drop-tools">
                  <button class="btn ghost small" id="paste-clipboard" type="button">Paste clipboard</button>
                  <button class="btn ghost small" id="load-sample" type="button">Load sample</button>
                  <button class="btn secondary small" id="clear-urls" type="button">Clear</button>
                </div>
              </div>
              <textarea id="urls" name="urls" placeholder="https://x.com/itsolelehmann/status/2033919415771713715?s=20&#10;https://x.com/jack/status/20"></textarea>
              <div class="drop-hint" id="drop-hint">Drag URLs, copied text, or a `.txt` file into this box.</div>
              <div class="field-note" id="url-count">0 URLs ready</div>
            </div>
            <div class="field-note">Tweet URLs are the most reliable way to capture the full X Article body when one is attached.</div>
          </div>
          <div class="stack">
            <div class="preview-card">
              <div class="preview-label">Preview</div>
              <div class="status-row" id="preview-status"><span class="status-dot"></span><span>Waiting for a URL</span></div>
              <h3 class="preview-title" id="preview-title">No preview yet</h3>
              <div class="preview-meta" id="preview-meta">Paste or drag in a URL and the app will preview the first source here.</div>
              <div class="preview-snippet" id="preview-body">The preview card shows the title, source type, metadata, and a short excerpt before export.</div>
              <div class="field-note" id="preview-note"></div>
            </div>
            <div>
              <label for="output_dir">Output folder</label>
              <input id="output_dir" name="output_dir" type="text" value="{escape(DEFAULT_OUTPUT_DIR)}">
            </div>
            <div>
              <label for="folder_name">Subfolder name</label>
              <input id="folder_name" name="folder_name" type="text" value="">
            </div>
            <div>
              <label>Formats</label>
              <div class="checks">
                <label><input type="checkbox" name="fmt_txt" checked> TXT</label>
                <label><input type="checkbox" name="fmt_md" checked> Markdown</label>
                <label><input type="checkbox" name="fmt_pdf" checked> PDF</label>
                <label><input type="checkbox" name="fmt_html"> HTML snapshot</label>
              </div>
            </div>
            <div>
              <label>Extras</label>
              <div class="checks">
                <label><input type="checkbox" name="include_media" checked> Download images</label>
                <label><input type="checkbox" name="open_folder" checked> Open output folder</label>
                <label><input type="checkbox" name="open_notebooklm"> Open NotebookLM after export</label>
              </div>
            </div>
            <div>
              <label>Google Drive</label>
              <div class="checks">
                <label><input type="checkbox" name="upload_drive"> Upload batch to Google Drive</label>
              </div>
              <div class="field-note">{escape(str(drive_state["message"]))}</div>
              <div class="actions">
                <a class="btn secondary" href="/drive-connect">Connect Google Drive</a>
                <a class="btn ghost" href="/drive-disconnect">Disconnect</a>
              </div>
            </div>
            <div>
              <label for="drive_parent">Drive parent folder ID or folder URL</label>
              <input id="drive_parent" name="drive_parent" type="text" value="" placeholder="Optional">
              <div class="field-note">Leave blank to create a new top-level batch folder in your Drive. Once connected, the saved session is reused for future jobs on this machine.</div>
            </div>
            <div>
              <label>NotebookLM handoff</label>
              <div class="checks">
                <div class="muted">There is no documented one-click source-import link for NotebookLM, so this app prepares the batch and then gives you an honest handoff: open NotebookLM, or open the Drive folder if you uploaded it.</div>
              </div>
            </div>
          </div>
        </div>
        <div class="row">
          <button class="btn" type="submit">Convert sources</button>
          <a class="btn secondary" href="/">Reset</a>
        </div>
      </form>

      <div class="panel">
        <div class="pill">Recent jobs</div>
        <div class="files">{recent_items}</div>
      </div>
    """
    return render_page("X to NotebookLM", body)


def render_results(job: dict) -> str:
    records: list[SourceRecord] = job["records"]
    failures: list[tuple[str, str]] = job["failures"]
    out_dir: Path = job["out_dir"]
    bundle: Path = job["bundle"]
    manifest: Path = job["manifest"]
    guide: Path = job["guide"]
    drive_upload: DriveUpload | None = job.get("drive_upload")
    drive_error: str | None = job.get("drive_error")

    rows = []
    for record in records:
        links = []
        for file_path in record.output_files:
            file_name = Path(file_path).relative_to(out_dir).as_posix()
            ext_label = Path(file_name).suffix.upper().lstrip(".")
            links.append(f'<a class="link-badge" href="/download?job={job["job_id"]}&file={quote(file_name)}">{escape(ext_label)}</a>')
        for media_path in record.media_files:
            file_name = Path(media_path).relative_to(out_dir).as_posix()
            links.append(f'<a class="link-badge" href="/download?job={job["job_id"]}&file={quote(file_name)}">IMG</a>')
        drive_links = [
            f'<a class="link-badge" href="{escape(drive_url, quote=True)}" target="_blank" rel="noreferrer">Drive</a>'
            for drive_url in record.drive_files.values()
        ]
        rows.append(
            f"""
            <div class="file">
              <div>
                <strong>{escape(record.title)}</strong>
                <div class="muted">{escape(record.url)}</div>
                {f'<div class="muted">{escape(record.note)}</div>' if record.note else ''}
              </div>
              <div class="link-row">{''.join(links + drive_links) or '<span class="muted">No files</span>'}</div>
            </div>
            """
        )

    failure_rows = "\n".join(
        f"<div class='file'><div><strong>{escape(url)}</strong><div class='muted'>{escape(reason)}</div></div></div>"
        for url, reason in failures
    )

    drive_panel = ""
    if drive_upload:
        drive_panel = f"""
          <div class="panel">
            <div class="pill ok">Google Drive</div>
            <p class="subtitle" style="margin-top:12px;">This batch was uploaded to Drive, so NotebookLM can pick the sources up from Google Drive instead of manual local file selection.</p>
            <div class="actions">
              <a class="btn" href="{escape(drive_upload.folder_url, quote=True)}" target="_blank" rel="noreferrer">Open Drive folder</a>
              <a class="btn secondary" href="{NOTEBOOKLM_URL}" target="_blank" rel="noreferrer">Open NotebookLM</a>
            </div>
            {f'<div class="field-note">{escape(drive_upload.note)}</div>' if drive_upload.note else ''}
          </div>
        """
    elif drive_error:
        drive_panel = f"""
          <div class="panel">
            <div class="pill warn">Google Drive</div>
            <div class="muted" style="margin-top:12px;">{escape(drive_error)}</div>
          </div>
        """

    body = f"""
      <div class="hero">
        <div>
          <div class="eyebrow">Batch Complete</div>
          <h1 class="title">Export ready</h1>
          <p class="subtitle">Your files were written locally and organized for NotebookLM. The batch includes cleaner Markdown, richer PDF snapshots, a manifest, and an import guide so the handoff is much smoother.</p>
        </div>
        <div class="card pad">
          <div class="muted">Output path</div>
          <div style="margin-top:8px; font-weight:700; word-break:break-word;">{escape(str(out_dir))}</div>
          <div class="actions">
            <a class="btn" href="/open-folder?job={job['job_id']}">Open folder</a>
            <a class="btn secondary" href="/bundle?job={job['job_id']}">Download zip</a>
            <a class="btn secondary" href="{NOTEBOOKLM_URL}" target="_blank" rel="noreferrer">Open NotebookLM</a>
            <a class="btn secondary" href="/">New batch</a>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="stat-grid">
          <div class="stat"><strong>{len(records)}</strong><div class="muted">Sources converted</div></div>
          <div class="stat"><strong>{len(failures)}</strong><div class="muted">Failed URLs</div></div>
          <div class="stat"><strong>{escape(out_dir.name)}</strong><div class="muted">Output folder</div></div>
          <div class="stat"><strong>{escape(bundle.name)}</strong><div class="muted">Zip bundle</div></div>
        </div>
      </div>

      <div class="panel">
        <div class="pill">Next step</div>
        <ol class="steps">
          <li>Open NotebookLM.</li>
          <li>Add the generated <span class="inline-code">.md</span>, <span class="inline-code">.txt</span>, or <span class="inline-code">.pdf</span> files from this batch.</li>
          <li>If Drive upload succeeded, choose Google Drive inside NotebookLM and select files from the uploaded batch folder.</li>
        </ol>
      </div>

      {drive_panel}

      <div class="panel">
        <div class="pill ok">Generated files</div>
        <div class="files">{''.join(rows) or '<div class="muted">No files were created.</div>'}</div>
      </div>

      <div class="panel">
        <div class="pill">Batch metadata</div>
        <div class="files">
          <div class="file">
            <div>
              <strong>Manifest</strong>
              <div class="muted">{escape(str(manifest))}</div>
            </div>
            <a class="btn secondary" href="/download?job={job['job_id']}&file={quote(manifest.name)}">Download</a>
          </div>
          <div class="file">
            <div>
              <strong>Import guide</strong>
              <div class="muted">{escape(str(guide))}</div>
            </div>
            <a class="btn secondary" href="/download?job={job['job_id']}&file={quote(guide.name)}">Download</a>
          </div>
        </div>
      </div>
    """
    if failures:
        body += f"""
          <div class="panel">
            <div class="pill warn">Failed URLs</div>
            <div class="files">{failure_rows}</div>
          </div>
        """
    return render_page("Conversion complete", body)


def render_not_found(message: str = "Not found") -> tuple[HTTPStatus, str]:
    return HTTPStatus.NOT_FOUND, render_page("Not found", f"<div class='panel'>{escape(message)}</div>")


class NotebookLMHandler(BaseHTTPRequestHandler):
    server_version = "XToNotebookLM/2.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_GET(self):
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)

        if parsed.path == "/":
            self._send_html(HTTPStatus.OK, render_index())
            return
        if parsed.path == "/preview":
            self._serve_preview(query)
            return
        if parsed.path == "/job":
            job = get_job(query.get("job", [""])[0])
            if not job:
                self._send_html(*render_not_found("Unknown job"))
                return
            self._send_html(HTTPStatus.OK, render_results(job))
            return
        if parsed.path == "/download":
            self._serve_job_file(query)
            return
        if parsed.path == "/bundle":
            self._serve_bundle(query)
            return
        if parsed.path == "/open-folder":
            self._open_folder(query)
            return
        if parsed.path == "/drive-connect":
            self._connect_drive()
            return
        if parsed.path == "/drive-disconnect":
            self._disconnect_drive()
            return
        self._send_html(*render_not_found())

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/process":
            self._send_html(*render_not_found())
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        form = parse_qs(self.rfile.read(content_length).decode("utf-8", errors="replace"))

        urls_text = form.get("urls", [""])[0]
        output_dir = form.get("output_dir", [DEFAULT_OUTPUT_DIR])[0].strip() or DEFAULT_OUTPUT_DIR
        folder_name = form.get("folder_name", [""])[0].strip()
        export_formats = {
            fmt
            for key, fmt in {
                "fmt_txt": "txt",
                "fmt_md": "md",
                "fmt_pdf": "pdf",
                "fmt_html": "html",
            }.items()
            if key in form
        }
        if not export_formats:
            export_formats = {"txt"}
        include_media = "include_media" in form
        open_folder = "open_folder" in form
        open_notebooklm = "open_notebooklm" in form
        upload_drive = "upload_drive" in form
        drive_parent_raw = form.get("drive_parent", [""])[0].strip()

        try:
            urls = parse_urls_text(urls_text)
        except ValueError as exc:
            self._send_html(HTTPStatus.BAD_REQUEST, render_page("Invalid URLs", f"<div class='panel'>{escape(str(exc))}</div>"))
            return
        if not urls:
            self._send_html(HTTPStatus.BAD_REQUEST, render_page("No URLs", "<div class='panel'>Paste at least one URL before converting.</div>"))
            return

        base_dir = Path(output_dir).expanduser().resolve()
        safe_folder = slugify(folder_name, max_length=80) if folder_name else time.strftime("batch-%Y%m%d-%H%M%S")
        out_dir = base_dir / safe_folder

        drive_credentials_path = configured_drive_credentials_path() if upload_drive else None
        try:
            drive_parent_id = parse_drive_folder_id(drive_parent_raw)
        except ValueError as exc:
            self._send_html(HTTPStatus.BAD_REQUEST, render_page("Invalid Drive folder", f"<div class='panel'>{escape(str(exc))}</div>"))
            return

        job = {
            "created_at": time.time(),
            "urls": urls,
            "out_dir": out_dir,
            "export_formats": sorted(export_formats),
            "include_media": include_media,
            "upload_drive": upload_drive,
        }
        register_job(job)

        result = run_batch(
            urls,
            out_dir,
            export_formats,
            include_media,
            upload_to_drive=upload_drive,
            drive_credentials_path=drive_credentials_path,
            drive_parent_id=drive_parent_id,
        )
        job.update(result)
        job["status"] = "done"
        job["completed_at"] = time.time()

        if open_folder:
            try:
                webbrowser.open(out_dir.as_uri())
            except Exception:
                pass
        if open_notebooklm:
            try:
                webbrowser.open(NOTEBOOKLM_URL)
            except Exception:
                pass

        self._send_html(HTTPStatus.OK, render_results(job))

    def _send_html(self, status: HTTPStatus, html_text: str) -> None:
        data = html_text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, status: HTTPStatus, data: bytes, content_type: str, filename: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def _serve_job_file(self, query: dict[str, list[str]]) -> None:
        job = get_job(query.get("job", [""])[0])
        if not job:
            self._send_html(*render_not_found("Unknown job"))
            return

        safe_name = query.get("file", [""])[0].replace("\\", "/")
        candidate = (job["out_dir"] / safe_name).resolve()
        try:
            candidate.relative_to(job["out_dir"].resolve())
        except ValueError:
            self._send_html(*render_not_found("Invalid file path"))
            return
        if not candidate.exists() or not candidate.is_file():
            self._send_html(*render_not_found("File not found"))
            return

        content_type = "application/octet-stream"
        if candidate.suffix in {".txt", ".md"}:
            content_type = "text/plain; charset=utf-8"
        elif candidate.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif candidate.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        elif candidate.suffix == ".pdf":
            content_type = "application/pdf"
        elif candidate.suffix in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif candidate.suffix == ".png":
            content_type = "image/png"
        elif candidate.suffix == ".webp":
            content_type = "image/webp"

        self._send_bytes(HTTPStatus.OK, candidate.read_bytes(), content_type, filename=candidate.name)

    def _serve_preview(self, query: dict[str, list[str]]) -> None:
        raw_url = query.get("url", [""])[0].strip()
        if not raw_url:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "No URL was provided."})
            return
        try:
            self._send_json(HTTPStatus.OK, source_preview(raw_url))
        except Exception as exc:
            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": False,
                    "url": raw_url,
                    "error": f"{type(exc).__name__}: {exc}",
                },
            )

    def _serve_bundle(self, query: dict[str, list[str]]) -> None:
        job = get_job(query.get("job", [""])[0])
        if not job or not job.get("bundle") or not job["bundle"].exists():
            self._send_html(*render_not_found("Bundle not found"))
            return
        bundle = job["bundle"]
        self._send_bytes(HTTPStatus.OK, bundle.read_bytes(), "application/zip", filename=bundle.name)

    def _open_folder(self, query: dict[str, list[str]]) -> None:
        job = get_job(query.get("job", [""])[0])
        if not job:
            self._send_html(*render_not_found("Unknown job"))
            return
        try:
            webbrowser.open(job["out_dir"].as_uri())
        except Exception:
            pass
        self._send_html(
            HTTPStatus.OK,
            render_page(
                "Folder opened",
                f"<div class='panel'><div class='pill ok'>Opened</div><p>{escape(str(job['out_dir']))}</p></div><div class='panel'><a class='btn secondary' href='/job?job={escape(job['job_id'])}'>Back to results</a></div>",
            ),
        )

    def _connect_drive(self) -> None:
        credentials_path = configured_drive_credentials_path()
        if not credentials_path:
            self._send_html(
                HTTPStatus.BAD_REQUEST,
                render_page(
                    "Drive setup needed",
                    "<div class='panel'><div class='pill warn'>Setup needed</div><p>To enable one-click Google Drive sign-in for this app, place a Desktop app <code>credentials.json</code> next to <code>x_to_notebooklm.py</code>, then try again.</p><div class='actions'><a class='btn secondary' href='/'>Back</a></div></div>",
                ),
            )
            return

        try:
            service = google_drive_service(credentials_path)
            about = service.about().get(fields="user(displayName,emailAddress)").execute()
            user = about.get("user") or {}
            label = user.get("emailAddress") or user.get("displayName") or "your Google Drive account"
            self._send_html(
                HTTPStatus.OK,
                render_page(
                    "Drive connected",
                    f"<div class='panel'><div class='pill ok'>Connected</div><p>You are connected as <strong>{escape(label)}</strong>. Future jobs on this machine can reuse this saved Drive session without asking you to log in again.</p><div class='actions'><a class='btn secondary' href='/'>Back to app</a></div></div>",
                ),
            )
        except Exception as exc:
            self._send_html(
                HTTPStatus.BAD_REQUEST,
                render_page(
                    "Drive connection failed",
                    f"<div class='panel'><div class='pill warn'>Connection failed</div><p>{escape(type(exc).__name__ + ': ' + str(exc))}</p><div class='actions'><a class='btn secondary' href='/'>Back</a></div></div>",
                ),
            )

    def _disconnect_drive(self) -> None:
        credentials_path = configured_drive_credentials_path()
        if not credentials_path:
            self._send_html(
                HTTPStatus.OK,
                render_page(
                    "Drive disconnected",
                    "<div class='panel'><div class='pill'>Nothing to remove</div><p>No configured Google Drive credentials were found for this app.</p><div class='actions'><a class='btn secondary' href='/'>Back</a></div></div>",
                ),
            )
            return

        token_path = drive_token_path(credentials_path)
        try:
            if token_path.exists():
                token_path.unlink()
        except Exception as exc:
            self._send_html(
                HTTPStatus.BAD_REQUEST,
                render_page(
                    "Drive disconnect failed",
                    f"<div class='panel'><div class='pill warn'>Could not disconnect</div><p>{escape(type(exc).__name__ + ': ' + str(exc))}</p><div class='actions'><a class='btn secondary' href='/'>Back</a></div></div>",
                ),
            )
            return

        self._send_html(
            HTTPStatus.OK,
            render_page(
                "Drive disconnected",
                "<div class='panel'><div class='pill ok'>Disconnected</div><p>The saved Google Drive session for this app was removed. The next time you connect, the browser sign-in flow will run again.</p><div class='actions'><a class='btn secondary' href='/'>Back to app</a></div></div>",
            ),
        )


def serve_app(host: str, port: int, open_browser: bool) -> int:
    server = ThreadingHTTPServer((host, port), NotebookLMHandler)
    url = f"http://{host}:{port}/"
    print(f"Serving at {url}")
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()
    return 0


def load_urls(args: argparse.Namespace) -> list[str]:
    urls = list(args.urls or [])
    if args.input:
        for line in Path(args.input).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)
    return parse_urls_text("\n".join(urls))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export X tweets and article previews to NotebookLM-friendly files.")
    parser.add_argument("urls", nargs="*", help="X.com URLs")
    parser.add_argument("-i", "--input", help="Text file with one URL per line")
    parser.add_argument("-o", "--out", default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument("--serve", action="store_true", help="Start the local web app")
    parser.add_argument("--host", default=HOST, help="Host to bind when serving")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to bind when serving")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically when serving")
    parser.add_argument("--txt-only", action="store_true", help="Only generate .txt files")
    parser.add_argument("--md", action="store_true", help="Generate Markdown too")
    parser.add_argument("--html", action="store_true", help="Generate HTML snapshot too")
    parser.add_argument("--pdf", action="store_true", help="Generate PDF too")
    parser.add_argument("--no-media", action="store_true", help="Do not download images")
    parser.add_argument("--open-folder", action="store_true", help="Open the output folder when finished")
    parser.add_argument("--open-notebooklm", action="store_true", help="Open NotebookLM when finished")
    parser.add_argument("--upload-drive", action="store_true", help="Upload the batch to Google Drive")
    parser.add_argument("--drive-credentials", help="Path to Google Desktop OAuth credentials.json")
    parser.add_argument("--drive-parent", help="Optional Google Drive parent folder ID or folder URL")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.serve or (not args.urls and not args.input):
        return serve_app(args.host, args.port, open_browser=not args.no_browser)

    urls = load_urls(args)
    if not urls:
        print("No URLs provided.", file=sys.stderr)
        return 2

    export_formats = {"txt"} if args.txt_only else set(DEFAULT_EXPORTS)
    if args.md:
        export_formats.add("md")
    if args.html:
        export_formats.add("html")
    if args.pdf:
        export_formats.add("pdf")

    out_dir = Path(args.out).resolve()
    drive_credentials_path = Path(args.drive_credentials).expanduser().resolve() if args.drive_credentials else None
    drive_parent_id = parse_drive_folder_id(args.drive_parent or "")
    result = run_batch(
        urls,
        out_dir,
        export_formats,
        include_media=not args.no_media,
        upload_to_drive=args.upload_drive,
        drive_credentials_path=drive_credentials_path,
        drive_parent_id=drive_parent_id,
    )

    for record in result["records"]:
        names = ", ".join(Path(path).name for path in record.output_files)
        print(f"OK  {record.url} -> {names}")
    for url, reason in result["failures"]:
        print(f"ERR {url} -> {reason}", file=sys.stderr)

    print(f"\nWrote {len(result['records'])} source file(s) to {out_dir}")
    print(f"Manifest: {result['manifest']}")
    print(f"Import guide: {result['guide']}")
    if result.get("drive_upload"):
        print(f"Drive folder: {result['drive_upload'].folder_url}")
    if result.get("drive_error"):
        print(f"Drive upload error: {result['drive_error']}", file=sys.stderr)
    if args.open_folder:
        webbrowser.open(out_dir.as_uri())
    if args.open_notebooklm:
        webbrowser.open(NOTEBOOKLM_URL)
    return 1 if result["failures"] and not result["records"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
