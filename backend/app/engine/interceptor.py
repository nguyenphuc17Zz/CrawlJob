import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def _extract_job_from_dict(obj: Dict[str, Any], base_url: str) -> Optional[Dict[str, Any]]:
    """
    Attempt to map a generic JSON object (from JSON-LD, __NEXT_DATA__, or XHR API)
    into a standardized raw job dictionary if it looks like a job posting.
    """
    if not isinstance(obj, dict):
        return None

    # Check JSON-LD @type == JobPosting
    ld_type = obj.get("@type")
    if ld_type == "JobPosting" or (isinstance(ld_type, list) and "JobPosting" in ld_type):
        title = obj.get("title") or obj.get("name")
        if not title:
            return None
        org = obj.get("hiringOrganization") or {}
        company = org.get("name") if isinstance(org, dict) else str(org or "")
        logo = org.get("logo") if isinstance(org, dict) else ""

        loc = obj.get("jobLocation")
        location_str = ""
        if isinstance(loc, list) and loc:
            loc = loc[0]
        if isinstance(loc, dict):
            addr = loc.get("address") or {}
            if isinstance(addr, dict):
                location_str = (
                    addr.get("addressLocality")
                    or addr.get("addressRegion")
                    or addr.get("streetAddress")
                    or ""
                )
        base_sal = obj.get("baseSalary")
        salary_str = ""
        if isinstance(base_sal, dict):
            currency = base_sal.get("currency", "")
            val = base_sal.get("value")
            if isinstance(val, dict):
                min_v = val.get("minValue") or val.get("value")
                max_v = val.get("maxValue")
                if min_v and max_v:
                    salary_str = f"{min_v} - {max_v} {currency}".strip()
                elif min_v:
                    salary_str = f"{min_v} {currency}".strip()
        url_val = obj.get("url") or obj.get("sameAs") or base_url
        desc = obj.get("description") or ""
        return {
            "title": str(title).strip(),
            "company_name": str(company or "Unknown Company").strip(),
            "company_logo": str(logo or ""),
            "location_city": str(location_str or "Vietnam").strip(),
            "salary_raw": str(salary_str or "Thỏa thuận").strip(),
            "url": urljoin(base_url, str(url_val)),
            "posted_at": str(obj.get("datePosted") or ""),
            "deadline_at": str(obj.get("validThrough") or ""),
            "full_jd_html": str(desc),
            "extraction_method": "json_ld",
        }

    # Check generic API / Next.js / GraphQL job item shape
    title = (
        obj.get("title")
        or obj.get("jobTitle")
        or obj.get("job_title")
        or obj.get("position")
        or obj.get("positionName")
    )
    if not title or not isinstance(title, str) or len(title.strip()) < 4 or len(title.strip()) > 220:
        return None

    # Must also have at least one job-identifying key to avoid matching arbitrary UI items
    job_keys = {
        "company",
        "companyName",
        "company_name",
        "employer",
        "salary",
        "salaryRange",
        "jobUrl",
        "job_url",
        "applyUrl",
        "slug",
        "jobId",
        "job_id",
        "skills",
        "locations",
    }
    if not any(k in obj for k in job_keys):
        return None

    company_val = (
        obj.get("companyName")
        or obj.get("company_name")
        or obj.get("employerName")
        or obj.get("company")
        or ""
    )
    if isinstance(company_val, dict):
        company_val = company_val.get("name") or company_val.get("title") or ""

    salary_val = (
        obj.get("salary")
        or obj.get("salaryRange")
        or obj.get("salary_range")
        or obj.get("prettySalary")
        or "Thỏa thuận"
    )
    if isinstance(salary_val, dict):
        s_min = salary_val.get("min") or salary_val.get("from")
        s_max = salary_val.get("max") or salary_val.get("to")
        s_cur = salary_val.get("currency") or "VND"
        if s_min or s_max:
            salary_val = f"{s_min or ''} - {s_max or ''} {s_cur}".strip()
        else:
            salary_val = salary_val.get("label") or "Thỏa thuận"

    loc_val = obj.get("location") or obj.get("city") or obj.get("locations") or "Vietnam"
    if isinstance(loc_val, list) and loc_val:
        first_loc = loc_val[0]
        loc_val = first_loc.get("name") if isinstance(first_loc, dict) else str(first_loc)
    elif isinstance(loc_val, dict):
        loc_val = loc_val.get("name") or loc_val.get("city") or "Vietnam"

    raw_link = (
        obj.get("url")
        or obj.get("jobUrl")
        or obj.get("job_url")
        or obj.get("applyUrl")
        or obj.get("canonicalUrl")
        or obj.get("slug")
        or ""
    )
    if raw_link and not str(raw_link).startswith("http"):
        if not str(raw_link).startswith("/"):
            raw_link = "/" + str(raw_link)
        full_url = urljoin(base_url, str(raw_link))
    else:
        full_url = str(raw_link) if raw_link else base_url

    skills_val = obj.get("skills") or obj.get("tags") or obj.get("techStack") or []
    skills_list: List[str] = []
    if isinstance(skills_val, list):
        for s in skills_val[:15]:
            if isinstance(s, str):
                skills_list.append(s)
            elif isinstance(s, dict) and s.get("name"):
                skills_list.append(str(s["name"]))

    return {
        "title": title.strip(),
        "company_name": str(company_val or "Unknown Company").strip(),
        "company_logo": str(obj.get("companyLogo") or obj.get("logo") or ""),
        "location_city": str(loc_val or "Vietnam").strip(),
        "salary_raw": str(salary_val or "Thỏa thuận").strip(),
        "url": full_url,
        "skills": skills_list,
        "posted_at": str(obj.get("publishedAt") or obj.get("createdAt") or obj.get("postedAt") or ""),
        "full_jd_html": str(obj.get("description") or obj.get("jobDescription") or ""),
        "extraction_method": "xhr_or_state_json",
    }


def _walk_json_for_jobs(node: Any, base_url: str, collected: List[Dict[str, Any]], depth: int = 0) -> None:
    if depth > 14 or len(collected) >= 120:
        return
    if isinstance(node, dict):
        extracted = _extract_job_from_dict(node, base_url)
        if extracted:
            collected.append(extracted)
        for val in node.values():
            if isinstance(val, (dict, list)):
                _walk_json_for_jobs(val, base_url, collected, depth + 1)
    elif isinstance(node, list):
        for item in node[:150]:
            if isinstance(item, (dict, list)):
                _walk_json_for_jobs(item, base_url, collected, depth + 1)


def sniff_structured_data(
    html: str,
    base_url: str,
    xhr_payloads: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Node 3: Inspect HTML for JSON-LD (`JobPosting` / `ItemList`), Next.js `__NEXT_DATA__`,
    Nuxt `__NUXT__`, RSS/XML feeds, and captured Playwright XHR/GraphQL responses.
    """
    found_jobs: List[Dict[str, Any]] = []
    sources_detected: List[str] = []

    if not html:
        return {"jobs": [], "sources_detected": []}

    soup = BeautifulSoup(html, "html.parser")

    # 1. Check JSON-LD scripts
    for script in soup.find_all("script", attrs={"type": re.compile(r"application/ld\+json", re.I)}):
        raw_text = (script.string or script.get_text() or "").strip()
        if not raw_text:
            continue
        try:
            data = json.loads(raw_text)
            before_count = len(found_jobs)
            _walk_json_for_jobs(data, base_url, found_jobs)
            if len(found_jobs) > before_count:
                sources_detected.append("JSON-LD (Schema.org JobPosting)")
        except Exception:
            pass

    # 2. Check Next.js __NEXT_DATA__
    next_script = soup.find("script", attrs={"id": "__NEXT_DATA__"})
    if next_script:
        raw_next = (next_script.string or next_script.get_text() or "").strip()
        if raw_next:
            try:
                next_data = json.loads(raw_next)
                before_count = len(found_jobs)
                _walk_json_for_jobs(next_data, base_url, found_jobs)
                if len(found_jobs) > before_count:
                    sources_detected.append("Next.js (__NEXT_DATA__ Hydration State)")
            except Exception:
                pass

    # 3. Check captured XHR/Fetch/GraphQL JSON payloads
    if xhr_payloads:
        before_count = len(found_jobs)
        for payload_item in xhr_payloads:
            _walk_json_for_jobs(payload_item.get("data"), base_url, found_jobs)
        if len(found_jobs) > before_count:
            for j in found_jobs[before_count:]:
                j["extraction_method"] = "xhr_api"
            sources_detected.append(f"XHR/GraphQL Network API ({len(xhr_payloads)} packets)")

    # Deduplicate by URL or title
    unique_jobs: List[Dict[str, Any]] = []
    seen_keys = set()
    for job in found_jobs:
        key = f"{job.get('url', '')}::{job.get('title', '').lower()}"
        if key not in seen_keys:
            seen_keys.add(key)
            unique_jobs.append(job)

    return {
        "jobs": unique_jobs,
        "sources_detected": list(dict.fromkeys(sources_detected)),
    }
