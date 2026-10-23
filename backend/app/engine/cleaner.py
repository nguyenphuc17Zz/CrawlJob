import re
from typing import List, Tuple
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Comment


NOISE_TAGS = [
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "source",
    "track",
    "map",
    "area",
]


def clean_html_for_offline_reader(raw_html: str, base_url: str = "") -> str:
    """
    Sanitize HTML on the backend before storing in `full_jd_html` for offline reading.
    Strips scripts, iframes, event handlers, and javascript: URIs.
    (Frontend also sanitizes with DOMPurify as defense-in-depth).
    """
    if not raw_html:
        return ""

    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup.find_all(NOISE_TAGS):
        tag.decompose()

    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()

    for el in soup.find_all(True):
        attrs_to_remove = []
        for attr_name, attr_val in el.attrs.items():
            lower_attr = attr_name.lower()
            if lower_attr.startswith("on") or lower_attr in ("style", "srcdoc"):
                attrs_to_remove.append(attr_name)
            elif lower_attr in ("href", "src"):
                val_str = str(attr_val).strip()
                if val_str.lower().startswith(("javascript:", "vbscript:", "data:text/html")):
                    attrs_to_remove.append(attr_name)
                elif base_url and val_str and not val_str.startswith(("http://", "https://", "mailto:", "tel:")):
                    el.attrs[attr_name] = urljoin(base_url, val_str)
        for attr_name in attrs_to_remove:
            del el.attrs[attr_name]

    return str(soup)


def html_to_clean_markdown(raw_html: str, base_url: str = "", max_chars: int = 45000) -> str:
    """
    Convert raw page HTML into compact, structured Markdown preserving absolute URLs
    and headings/lists for AI extraction and offline reading.
    """
    if not raw_html:
        return ""

    soup = BeautifulSoup(raw_html, "html.parser")
    for tag in soup.find_all(NOISE_TAGS + ["nav", "footer"]):
        tag.decompose()

    lines: List[str] = []

    # Title
    if soup.title and soup.title.string:
        lines.append(f"# {soup.title.string.strip()}\n")

    body = soup.body or soup

    # Convert links to markdown format [text](absolute_url) in place
    for a_tag in body.find_all("a", href=True):
        href = str(a_tag.get("href", "")).strip()
        text = " ".join(a_tag.get_text(" ", strip=True).split())
        if href and text and not href.lower().startswith(("javascript:", "#")):
            abs_url = urljoin(base_url, href) if base_url else href
            a_tag.replace_with(f" [{text}]({abs_url}) ")

    for h_tag in body.find_all(["h1", "h2", "h3", "h4"]):
        level = int(h_tag.name[1])
        h_text = " ".join(h_tag.get_text(" ", strip=True).split())
        if h_text:
            h_tag.replace_with(f"\n{'#' * level} {h_text}\n")

    for li_tag in body.find_all("li"):
        li_text = " ".join(li_tag.get_text(" ", strip=True).split())
        if li_text:
            li_tag.replace_with(f"\n- {li_text}")

    raw_text = body.get_text("\n", strip=True)
    cleaned_lines = []
    for line in raw_text.splitlines():
        stripped = " ".join(line.split())
        if stripped:
            cleaned_lines.append(stripped)

    markdown = "\n".join(cleaned_lines)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown[:max_chars]
