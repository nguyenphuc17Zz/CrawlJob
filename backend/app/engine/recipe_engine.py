from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from ..models import DomainRecipe, utc_now


BUILTIN_RECIPES: List[Dict[str, str]] = [
    {
        "domain": "topcv.vn",
        "recipe_name": "TopCV Vietnam Job Cards",
        "card_selector": ".job-item-search-result, .job-item-2, .job-item, .box-header",
        "title_selector": "h3.title a, .title-block a, a[href*='/viec-lam/']",
        "company_selector": "a.company, .company-name",
        "salary_selector": ".title-salary, .salary, .label-content",
        "location_selector": ".address, .city",
        "link_selector": "h3.title a, a[href*='/viec-lam/']",
        "next_page_selector": "a[rel='next'], .pagination li.active + li a",
        "detail_jd_selector": ".job-description, .job-data, #box-job-information-detail",
    },
    {
        "domain": "itviec.com",
        "recipe_name": "ITViec Tech Jobs",
        "card_selector": ".job-card, div[data-search--job-selection-job-url-value], .ipy-2",
        "title_selector": "h3 a, a[href*='/it-jobs/']",
        "company_selector": ".ims-2 a, a[href*='/companies/']",
        "salary_selector": ".salary, .ips-2",
        "location_selector": ".city, .text-rich-grey",
        "link_selector": "h3 a, a[href*='/it-jobs/']",
        "next_page_selector": "a[rel='next'], .page.next a",
        "detail_jd_selector": ".job-details, .jd-content, main",
    },
    {
        "domain": "linkedin.com",
        "recipe_name": "LinkedIn Public Job Search",
        "card_selector": ".base-card, .job-search-card, li .base-search-card",
        "title_selector": ".base-search-card__title, h3",
        "company_selector": ".base-search-card__subtitle, h4",
        "salary_selector": ".job-search-card__salary-info",
        "location_selector": ".job-search-card__location",
        "link_selector": "a.base-card__full-link, a[href*='/jobs/view/']",
        "next_page_selector": "",
        "detail_jd_selector": ".show-more-less-html__markup, .description__text",
    },
    {
        "domain": "remoteok.com",
        "recipe_name": "RemoteOK Job Board",
        "card_selector": "tr.job",
        "title_selector": "h2[itemprop='title'], td.company_and_position h2",
        "company_selector": "h3[itemprop='name']",
        "salary_selector": ".location",
        "location_selector": ".location",
        "link_selector": "a.preventLink, a[href*='/remote-jobs/']",
        "next_page_selector": "",
        "detail_jd_selector": ".description, .markdown",
    },
    {
        "domain": "careerviet.vn",
        "recipe_name": "CareerViet Portal",
        "card_selector": ".job-item, .figcaption",
        "title_selector": ".title a, h2 a",
        "company_selector": ".company-name",
        "salary_selector": ".salary p, .salary",
        "location_selector": ".location li, .location",
        "link_selector": ".title a, h2 a",
        "next_page_selector": "li.next-page a",
        "detail_jd_selector": ".detail-row, .job-detail-content",
    },
]


def seed_builtin_recipes(db: Session) -> None:
    """Populate initial domain selector recipes if not already present."""
    for item in BUILTIN_RECIPES:
        existing = db.query(DomainRecipe).filter(DomainRecipe.domain == item["domain"]).first()
        if not existing:
            db.add(
                DomainRecipe(
                    domain=item["domain"],
                    recipe_name=item["recipe_name"],
                    card_selector=item["card_selector"],
                    title_selector=item["title_selector"],
                    company_selector=item.get("company_selector", ""),
                    salary_selector=item.get("salary_selector", ""),
                    location_selector=item.get("location_selector", ""),
                    link_selector=item.get("link_selector", "a"),
                    next_page_selector=item.get("next_page_selector", ""),
                    detail_jd_selector=item.get("detail_jd_selector", ""),
                    learned_by="builtin",
                )
            )
    db.commit()


def execute_domain_recipe(
    html: str,
    base_url: str,
    recipe: DomainRecipe,
) -> Dict[str, Any]:
    """
    Execute a cached DomainRecipe (CSS selectors) against the HTML.
    Returns extracted jobs and optional next_page_url.
    """
    if not html or not recipe or not recipe.card_selector:
        return {"jobs": [], "next_page_url": None}

    soup = BeautifulSoup(html, "html.parser")
    try:
        cards = soup.select(recipe.card_selector)
    except Exception:
        return {"jobs": [], "next_page_url": None}

    jobs: List[Dict[str, Any]] = []
    seen_urls = set()

    for card in cards[:120]:
        try:
            title_el = card.select_one(recipe.title_selector) if recipe.title_selector else None
            if not title_el:
                continue
            title = " ".join(title_el.get_text(" ", strip=True).split())
            if not title or len(title) < 3:
                continue

            link_el = card.select_one(recipe.link_selector) if recipe.link_selector else title_el
            href = ""
            if link_el and link_el.has_attr("href"):
                href = str(link_el["href"]).strip()
            elif title_el.has_attr("href"):
                href = str(title_el["href"]).strip()
            else:
                any_a = card.find("a", href=True)
                if any_a:
                    href = str(any_a["href"]).strip()

            full_url = urljoin(base_url, href) if href else base_url
            if full_url in seen_urls and full_url != base_url:
                continue
            seen_urls.add(full_url)

            company = "Unknown Company"
            if recipe.company_selector:
                comp_el = card.select_one(recipe.company_selector)
                if comp_el:
                    company = " ".join(comp_el.get_text(" ", strip=True).split()) or company

            salary = "Thỏa thuận"
            if recipe.salary_selector:
                sal_el = card.select_one(recipe.salary_selector)
                if sal_el:
                    salary = " ".join(sal_el.get_text(" ", strip=True).split()) or salary

            location = "Vietnam"
            if recipe.location_selector:
                loc_el = card.select_one(recipe.location_selector)
                if loc_el:
                    location = " ".join(loc_el.get_text(" ", strip=True).split()) or location

            jobs.append(
                {
                    "title": title,
                    "company_name": company,
                    "salary_raw": salary,
                    "location_city": location,
                    "url": full_url,
                    "extraction_method": "domain_recipe",
                }
            )
        except Exception:
            continue

    next_page_url = None
    if recipe.next_page_selector:
        try:
            next_el = soup.select_one(recipe.next_page_selector)
            if next_el and next_el.has_attr("href"):
                next_page_url = urljoin(base_url, str(next_el["href"]).strip())
        except Exception:
            pass

    return {"jobs": jobs, "next_page_url": next_page_url}


def save_or_heal_domain_recipe(
    db: Session,
    domain: str,
    learned_data: Dict[str, Any],
    learned_by: str = "ai",
) -> Optional[DomainRecipe]:
    """
    Create or update (Self-Heal) a DomainRecipe in the database when AI learns a page structure.
    """
    card_sel = (learned_data.get("card_selector") or "").strip()
    title_sel = (learned_data.get("title_selector") or "").strip()
    if not domain or not card_sel or not title_sel:
        return None

    existing = db.query(DomainRecipe).filter(DomainRecipe.domain == domain).first()
    if existing:
        existing.card_selector = card_sel
        existing.title_selector = title_sel
        existing.company_selector = (learned_data.get("company_selector") or existing.company_selector or "").strip()
        existing.salary_selector = (learned_data.get("salary_selector") or existing.salary_selector or "").strip()
        existing.location_selector = (learned_data.get("location_selector") or existing.location_selector or "").strip()
        existing.link_selector = (learned_data.get("link_selector") or existing.link_selector or "a").strip()
        existing.next_page_selector = (learned_data.get("next_page_selector") or existing.next_page_selector or "").strip()
        existing.learned_by = learned_by
        existing.last_healed_at = utc_now()
        db.commit()
        db.refresh(existing)
        return existing

    new_recipe = DomainRecipe(
        domain=domain,
        recipe_name=f"Auto-Learned Recipe ({domain})",
        card_selector=card_sel,
        title_selector=title_sel,
        company_selector=(learned_data.get("company_selector") or "").strip(),
        salary_selector=(learned_data.get("salary_selector") or "").strip(),
        location_selector=(learned_data.get("location_selector") or "").strip(),
        link_selector=(learned_data.get("link_selector") or "a").strip(),
        next_page_selector=(learned_data.get("next_page_selector") or "").strip(),
        learned_by=learned_by,
        success_count=1,
    )
    db.add(new_recipe)
    db.commit()
    db.refresh(new_recipe)
    return new_recipe
