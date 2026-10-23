from typing import Any, Dict, List, Tuple
from sqlalchemy.orm import Session

from ..models import FilterRule


DEFAULT_FILTER_RULES = [
    {
        "rule_type": "keyword_exclude",
        "pattern": "đa cấp",
        "note": "Chặn các tin tuyển dụng đa cấp lừa đảo",
    },
    {
        "rule_type": "keyword_whitelist",
        "pattern": "Remote",
        "note": "Ưu tiên đánh dấu nổi bật các công việc Remote",
    },
    {
        "rule_type": "keyword_whitelist",
        "pattern": "Python",
        "note": "Ưu tiên công việc Python / AI / Backend",
    },
]


def seed_default_filters(db: Session) -> None:
    if db.query(FilterRule).count() == 0:
        for item in DEFAULT_FILTER_RULES:
            db.add(
                FilterRule(
                    rule_type=item["rule_type"],
                    pattern=item["pattern"],
                    note=item["note"],
                    is_active=True,
                )
            )
        db.commit()


def evaluate_job_against_filters(
    job_data: Dict[str, Any],
    active_rules: List[FilterRule],
) -> Tuple[bool, str, bool, List[str]]:
    """
    Evaluate a raw job item against active FilterRules:
    Returns: (is_blocked, block_reason, is_highlighted, matched_whitelist_keywords)
    """
    company = (job_data.get("company_name") or "").lower()
    title = (job_data.get("title") or "").lower()
    summary = (job_data.get("summary") or "").lower()
    url = (job_data.get("url") or "").lower()
    combined_text = f"{title} {company} {summary}"

    matched_whitelist: List[str] = []

    for rule in active_rules:
        if not rule.is_active or not rule.pattern:
            continue
        pat = rule.pattern.strip().lower()
        if not pat:
            continue

        if rule.rule_type == "company_blacklist":
            if pat in company or pat in url:
                return True, f"Company Blacklist: '{rule.pattern}'", False, []

        elif rule.rule_type == "keyword_exclude":
            if pat in combined_text:
                return True, f"Excluded Keyword: '{rule.pattern}'", False, []

        elif rule.rule_type == "keyword_whitelist":
            if pat in combined_text:
                matched_whitelist.append(rule.pattern.strip())

    return False, "", len(matched_whitelist) > 0, matched_whitelist
