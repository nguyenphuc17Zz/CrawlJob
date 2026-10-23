import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from ..security import validate_local_service_url

logger = logging.getLogger(__name__)

JOB_LINK_PATTERNS = re.compile(
    r"(/jobs?/|/viec-lam/|/tuyen-dung/|/it-jobs/|/careers?/|/positions?/|/openings?/|/roles?/|/opportunities/|/jd/|job_id=|jobId=)",
    re.IGNORECASE,
)

NON_JOB_LINK_PATTERNS = re.compile(
    r"(/login|/register|/sign-in|/signup|/blog|/news|/about|/contact|/privacy|/terms|/pricing|/employer|/post-a-job|/forgot|/tag/|/category/)",
    re.IGNORECASE,
)


def _extract_json_block(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    cleaned = text.strip()
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
    if fence_match:
        cleaned = fence_match.group(1)
    else:
        brace_start = cleaned.find("{")
        brace_end = cleaned.rfind("}")
        if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
            cleaned = cleaned[brace_start : brace_end + 1]
    try:
        return json.loads(cleaned)
    except Exception:
        return None


async def call_multi_provider_llm(
    prompt: str,
    settings: Dict[str, str],
) -> Optional[Dict[str, Any]]:
    """
    Call the user's configured AI provider:
    - 'gemini' (Google Gemini API)
    - 'openai' (OpenAI API)
    - 'groq' (Groq Fast API)
    - 'openrouter' (OpenRouter API)
    - 'ollama' (Local Ollama API at 127.0.0.1:11434)
    """
    provider = (settings.get("ai_provider") or "gemini").lower()
    model = settings.get("ai_model") or ""

    async with httpx.AsyncClient(timeout=45.0) as client:
        if provider == "gemini":
            api_key = (settings.get("gemini_api_key") or "").strip()
            if not api_key:
                return None
            model_name = model or "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            resp = await client.post(
                url,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"},
                },
            )
            resp.raise_for_status()
            data = resp.json()
            candidates = data.get("candidates") or []
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return _extract_json_block(parts[0].get("text", ""))

        elif provider in ("openai", "groq", "openrouter"):
            key_map = {
                "openai": settings.get("openai_api_key", ""),
                "groq": settings.get("groq_api_key", ""),
                "openrouter": settings.get("openrouter_api_key", ""),
            }
            url_map = {
                "openai": "https://api.openai.com/v1/chat/completions",
                "groq": "https://api.groq.com/openai/v1/chat/completions",
                "openrouter": "https://openrouter.ai/api/v1/chat/completions",
            }
            default_models = {
                "openai": "gpt-4o-mini",
                "groq": "llama-3.3-70b-versatile",
                "openrouter": "google/gemini-2.5-flash",
            }
            api_key = (key_map.get(provider) or "").strip()
            if not api_key:
                return None
            resp = await client.post(
                url_map[provider],
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model or default_models[provider],
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert job scraping & DOM selector extraction engine. Return valid JSON only.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.1,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices") or []
            if choices:
                content = choices[0].get("message", {}).get("content", "")
                return _extract_json_block(content)

        elif provider == "ollama":
            ollama_base = validate_local_service_url(
                settings.get("ollama_base_url") or "http://127.0.0.1:11434"
            ).rstrip("/")
            resp = await client.post(
                f"{ollama_base}/api/chat",
                json={
                    "model": model or "llama3.1",
                    "messages": [{"role": "user", "content": prompt}],
                    "format": "json",
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            return _extract_json_block(content)

    return None


async def ai_extract_jobs_and_learn_recipe(
    markdown_text: str,
    html_snippet: str,
    base_url: str,
    settings: Dict[str, str],
    custom_instruction: str = "",
) -> Dict[str, Any]:
    """
    Use LLM to extract all job postings from the cleaned Markdown AND generate a
    reusable CSS Selector Recipe (`learned_recipe`) for Self-Healing caching.
    """
    extra_rule = f"\nAdditional user filter/instruction: {custom_instruction}\n" if custom_instruction else ""
    prompt = f"""Extract all job openings from this webpage ({base_url}) and also infer CSS selectors for recurring job cards if visible in the HTML snippet.
{extra_rule}
Return strictly a JSON object matching this schema:
{{
  "jobs": [
    {{
      "title": "Job title",
      "company_name": "Company name",
      "salary_raw": "Salary text or Thỏa thuận",
      "location_city": "City or Remote",
      "work_mode": "Remote | Hybrid | Onsite",
      "seniority": "Intern | Fresher | Junior | Mid-Level | Senior | Lead | Manager",
      "url": "Absolute URL to the job detail page",
      "skills": ["skill1", "skill2"],
      "summary": "1-2 sentence summary if available",
      "hr_email": "HR email if present else null",
      "hr_phone": "HR phone if present else null"
    }}
  ],
  "learned_recipe": {{
    "card_selector": "CSS selector for each repeating job item container or empty string",
    "title_selector": "Relative CSS selector for job title inside card",
    "company_selector": "Relative CSS selector for company name inside card",
    "salary_selector": "Relative CSS selector for salary inside card",
    "location_selector": "Relative CSS selector for location inside card",
    "link_selector": "Relative CSS selector for job detail anchor tag"
  }}
}}

--- HTML STRUCTURE SAMPLE (first 6000 chars) ---
{html_snippet[:6000]}

--- PAGE MARKDOWN CONTENT ---
{markdown_text[:28000]}
"""
    parsed = await call_multi_provider_llm(prompt, settings)
    if not parsed or not isinstance(parsed, dict):
        return {"jobs": [], "learned_recipe": None}

    raw_jobs = parsed.get("jobs") or []
    valid_jobs: List[Dict[str, Any]] = []
    for item in raw_jobs:
        if isinstance(item, dict) and item.get("title"):
            item["url"] = urljoin(base_url, str(item.get("url") or base_url))
            item["extraction_method"] = "ai_llm"
            valid_jobs.append(item)

    return {
        "jobs": valid_jobs,
        "learned_recipe": parsed.get("learned_recipe"),
    }


def extract_jobs_heuristic_dom(html: str, base_url: str) -> List[Dict[str, Any]]:
    """
    Layer 4: Smart DOM Heuristic Extractor (0 API Key required).
    Automatically discovers job postings on ANY career page or job board by:
    1. Scanning anchors matching job URL patterns or job-related headings
    2. Inspecting parent card containers for company name, salary, and location tokens
    3. Fallback to single-page job detail extraction if the URL itself is a single JD page.
    """
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    jobs: List[Dict[str, Any]] = []
    seen_urls = set()

    # Step 1: Look for anchor links that look like job detail links
    for a_tag in soup.find_all("a", href=True):
        href = str(a_tag.get("href", "")).strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        if NON_JOB_LINK_PATTERNS.search(href):
            continue

        abs_url = urljoin(base_url, href)
        if abs_url in seen_urls or abs_url.rstrip("/") == base_url.rstrip("/"):
            continue

        link_text = " ".join(a_tag.get_text(" ", strip=True).split())
        # Check if inside a heading or matches job link pattern
        in_heading = a_tag.find_parent(["h1", "h2", "h3", "h4"]) is not None or bool(
            a_tag.find(["h2", "h3", "h4"])
        )
        is_job_href = bool(JOB_LINK_PATTERNS.search(href))

        if not (is_job_href or in_heading):
            continue

        # Clean title
        if not link_text or len(link_text) < 5 or len(link_text) > 180:
            heading_el = a_tag.find(["h2", "h3", "h4"]) or a_tag.find_parent(["h2", "h3", "h4"])
            if heading_el:
                link_text = " ".join(heading_el.get_text(" ", strip=True).split())
        if not link_text or len(link_text) < 5 or len(link_text) > 180:
            continue

        lower_title = link_text.lower()
        if lower_title in ("apply now", "xem thêm", "view all", "read more", "chi tiết", "ứng tuyển ngay", "jobs", "careers"):
            continue

        # Locate enclosing card container (up to 3 levels up)
        card = a_tag.find_parent(["article", "li", "tr", "div"])
        card_text = " ".join(card.get_text(" | ", strip=True).split()) if card else link_text

        # Extract salary if visible inside the card
        sal_match = re.search(
            r"(\$\s?\d[\d,\.]*(?:\s*[-–]\s*\$?\s?\d[\d,\.]*)?(?:\s*USD)?|\d+(?:\s*[-–]\s*\d+)?\s*(?:triệu|tr|M| triệu VNĐ|VND)|(?:up to|tới|trên)\s*\$?\d[\d,\.]*\s*(?:triệu|M|USD)?|thỏa thuận|negotiable)",
            card_text,
            re.IGNORECASE,
        )
        salary_raw = sal_match.group(1).strip() if sal_match else "Thỏa thuận"

        # Extract location if visible inside the card
        loc_match = re.search(
            r"\b(Hà Nội|Ha Noi|Hanoi|Hồ Chí Minh|Ho Chi Minh|TP\.?\s*HCM|Đà Nẵng|Da Nang|Cần Thơ|Hải Phòng|Bình Dương|Remote|Hybrid|Worldwide|Vietnam)\b",
            card_text,
            re.IGNORECASE,
        )
        location_city = loc_match.group(1).strip() if loc_match else "Vietnam"

        # Try to infer company name from card or domain
        company_name = ""
        if card:
            comp_el = card.find(attrs={"class": re.compile(r"(company|employer|org|subtitle)", re.I)})
            if comp_el:
                comp_candidate = " ".join(comp_el.get_text(" ", strip=True).split())
                if 2 <= len(comp_candidate) <= 100 and comp_candidate != link_text:
                    company_name = comp_candidate

        if not company_name:
            host = (urlparse(base_url).hostname or "").replace("www.", "").split(".")[0].capitalize()
            company_name = f"{host} Portal" if host else "Unknown Company"

        seen_urls.add(abs_url)
        jobs.append(
            {
                "title": link_text,
                "company_name": company_name,
                "salary_raw": salary_raw,
                "location_city": location_city,
                "url": abs_url,
                "extraction_method": "heuristic",
            }
        )
        if len(jobs) >= 80:
            break

    # Step 2: If no listing links were found, check if the page itself is a Single Job Detail Page
    if not jobs:
        h1 = soup.find("h1")
        page_title = " ".join(h1.get_text(" ", strip=True).split()) if h1 else (
            soup.title.string.strip() if soup.title and soup.title.string else ""
        )
        if page_title and len(page_title) >= 4:
            body_text = soup.get_text(" ", strip=True)
            sal_match = re.search(
                r"(\$\s?\d[\d,\.]*(?:\s*[-–]\s*\$?\s?\d[\d,\.]*)?|\d+(?:\s*[-–]\s*\d+)?\s*(?:triệu|tr|M|VND)|thỏa thuận|negotiable)",
                body_text[:4000],
                re.IGNORECASE,
            )
            host = (urlparse(base_url).hostname or "").replace("www.", "").split(".")[0].capitalize()
            jobs.append(
                {
                    "title": page_title[:200],
                    "company_name": f"{host}" if host else "Direct Company Page",
                    "salary_raw": sal_match.group(1).strip() if sal_match else "Thỏa thuận",
                    "location_city": "Vietnam",
                    "url": base_url,
                    "extraction_method": "heuristic_single_jd",
                }
            )

    return jobs
