import unicodedata
from typing import Dict, List, Optional
from urllib.parse import quote_plus


SUPPORTED_PLATFORMS: List[Dict[str, str]] = [
    # 12 Portals from Japanese_Jobs_2026-10-16.xlsx
    {"id": "itviec", "name": "ITviec", "region": "VN", "domain": "itviec.com", "group": "jp_excel"},
    {"id": "topcv", "name": "TopCV", "region": "VN", "domain": "topcv.vn", "group": "jp_excel"},
    {"id": "careerviet", "name": "CareerViet", "region": "VN", "domain": "careerviet.vn", "group": "jp_excel"},
    {"id": "careerlink", "name": "CareerLink", "region": "VN", "domain": "careerlink.vn", "group": "jp_excel"},
    {"id": "jobsgo", "name": "JobsGO", "region": "VN", "domain": "jobsgo.vn", "group": "jp_excel"},
    {"id": "viecoi", "name": "ViecOi", "region": "VN", "domain": "viecoi.vn", "group": "jp_excel"},
    {"id": "indeed", "name": "Indeed VN", "region": "VN", "domain": "vn.indeed.com", "group": "jp_excel"},
    {"id": "linkedin", "name": "LinkedIn VN", "region": "Global", "domain": "linkedin.com", "group": "jp_excel"},
    {"id": "joywork", "name": "JoyWork", "region": "VN", "domain": "joywork.vn", "group": "jp_excel"},
    {"id": "cvwork", "name": "CVWork", "region": "VN", "domain": "cvwork.vn", "group": "jp_excel"},
    {"id": "xemviec", "name": "XemViec", "region": "VN", "domain": "xemviec.com", "group": "jp_excel"},
    {"id": "joboko", "name": "Joboko", "region": "VN", "domain": "vn.joboko.com", "group": "jp_excel"},
    # Extended Portals
    {"id": "vietnamworks", "name": "VietnamWorks", "region": "VN", "domain": "vietnamworks.com", "group": "extended"},
    {"id": "glints", "name": "Glints VN", "region": "VN", "domain": "glints.com", "group": "extended"},
    {"id": "topdev", "name": "TopDev", "region": "VN", "domain": "topdev.vn", "group": "extended"},
    {"id": "remoteok", "name": "RemoteOK", "region": "Global", "domain": "remoteok.com", "group": "extended"},
]


def to_ascii_slug(text: str) -> str:
    normalized = unicodedata.normalize("NFD", (text or "").strip().lower())
    without_accents = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    without_accents = without_accents.replace("đ", "d")
    slug = "-".join(without_accents.split())
    return slug or "tieng-nhat"


def build_platform_url(platform_id: str, keyword: str, location: str = "Vietnam") -> str:
    kw_clean = (keyword or "Tiếng Nhật").strip()
    loc_clean = (location or "Vietnam").strip()
    kw_slug = to_ascii_slug(kw_clean)
    kw_encoded = quote_plus(kw_clean)
    loc_encoded = quote_plus(loc_clean)

    templates = {
        "itviec": f"https://itviec.com/it-jobs/{kw_slug}",
        "topcv": f"https://www.topcv.vn/tim-viec-lam-{kw_slug}",
        "careerviet": f"https://careerviet.vn/viec-lam/{kw_slug}-k-vi.html",
        "careerlink": f"https://www.careerlink.vn/viec-lam/k/{kw_encoded}",
        "jobsgo": f"https://jobsgo.vn/viec-lam-{kw_slug}.html",
        "viecoi": f"https://viecoi.vn/tim-viec/{kw_slug}.html",
        "indeed": f"https://vn.indeed.com/jobs?q={kw_encoded}&l={loc_encoded}",
        "linkedin": f"https://www.linkedin.com/jobs/search?keywords={kw_encoded}&location={loc_encoded}",
        "joywork": f"https://joywork.vn/viec-lam?q={kw_encoded}",
        "cvwork": f"https://cvwork.vn/viec-lam?keyword={kw_encoded}",
        "xemviec": f"https://xemviec.com/viec-lam?q={kw_encoded}",
        "joboko": f"https://vn.joboko.com/jobs?q={kw_encoded}",
        "vietnamworks": f"https://www.vietnamworks.com/viec-lam?q={kw_encoded}",
        "glints": f"https://glints.com/vn/opportunities/jobs/explore?keyword={kw_encoded}",
        "topdev": f"https://topdev.vn/viec-lam-it/{kw_slug}",
        "remoteok": f"https://remoteok.com/remote-{kw_slug}-jobs",
    }
    return templates.get(platform_id, f"https://www.google.com/search?q={kw_encoded}")


def build_multi_site_search_urls(
    keyword: str,
    location: str = "",
    platforms: Optional[List[str]] = None,
    platform_keywords: Optional[Dict[str, str]] = None,
    platform_urls: Optional[Dict[str, str]] = None,
) -> List[Dict[str, str]]:
    """
    Generate target search URLs across multiple job portals supporting both:
    - 1 global keyword across all selected sites
    - Per-site keyword override or custom URL override
    """
    selected = set(platforms) if platforms else {
        "itviec", "topcv", "careerviet", "careerlink", "jobsgo", "viecoi",
        "indeed", "linkedin", "joywork", "cvwork", "xemviec", "joboko"
    }
    kw_overrides = platform_keywords or {}
    url_overrides = platform_urls or {}
    results: List[Dict[str, str]] = []

    for platform_info in SUPPORTED_PLATFORMS:
        pid = platform_info["id"]
        if pid in selected:
            raw_kw = (kw_overrides.get(pid) or keyword or "Tiếng Nhật").strip()
            kw_parts = [p.strip() for p in re.split(r"[,;]+", raw_kw) if p.strip()]
            effective_kw_list = kw_parts if kw_parts else ["Tiếng Nhật"]
            custom_url = (url_overrides.get(pid) or "").strip()

            if custom_url:
                results.append(
                    {
                        "platform_id": pid,
                        "platform_name": platform_info["name"],
                        "domain": platform_info["domain"],
                        "keyword_used": raw_kw,
                        "url": custom_url,
                    }
                )
            else:
                for single_kw in effective_kw_list:
                    resolved_url = build_platform_url(pid, single_kw, location)
                    results.append(
                        {
                            "platform_id": pid,
                            "platform_name": platform_info["name"],
                            "domain": platform_info["domain"],
                            "keyword_used": single_kw,
                            "url": resolved_url,
                        }
                    )

    return results

