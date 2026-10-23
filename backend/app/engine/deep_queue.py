import asyncio
import json
import logging
import random
import time
from typing import Dict, List, Optional

from bs4 import BeautifulSoup

from ..database import SessionLocal
from ..models import CrawlRun, JobPost, PipelineNodeLog, utc_now
from .cleaner import clean_html_for_offline_reader, html_to_clean_markdown
from .fetcher import smart_multi_tier_fetch
from .interceptor import sniff_structured_data
from .normalizer import (
    extract_hr_and_company_contacts,
    extract_skills_from_text,
    infer_seniority,
    infer_work_mode,
    normalize_salary,
)

logger = logging.getLogger(__name__)


async def enrich_single_job_detail(
    job_id: int,
    bypass_mode: str,
    settings: Dict[str, str],
    proxy_url: Optional[str] = None,
) -> bool:
    """
    Fetch an individual job detail URL to extract the full JD (Markdown + sanitized HTML),
    skills array, HR email/phone/name, company size, and refined salary if missing.
    """
    db = SessionLocal()
    try:
        job = db.query(JobPost).filter(JobPost.id == job_id).first()
        if not job:
            return False

        job.deep_crawl_status = "running"
        db.commit()

        # Fetch detail page (use fast_tls first in auto mode, no screenshot needed for background queue)
        fetch_res = await smart_multi_tier_fetch(
            job.url,
            bypass_mode=bypass_mode,
            scroll_times=1,
            settings=settings,
            proxy_url=proxy_url,
            take_screenshot=False,
        )
        raw_html = fetch_res.get("html") or ""
        if not raw_html or len(raw_html) < 200:
            job.deep_crawl_status = "failed"
            db.commit()
            return False

        # Check if JSON-LD JobPosting exists on detail page for rich metadata
        sniffed = sniff_structured_data(raw_html, job.url)
        sniffed_jobs = sniffed.get("jobs") or []
        if sniffed_jobs:
            first_ld = sniffed_jobs[0]
            if first_ld.get("company_name") and job.company_name in ("Unknown Company", "") or "Portal" in job.company_name:
                job.company_name = first_ld["company_name"]
            if first_ld.get("salary_raw") and job.is_negotiable and first_ld["salary_raw"] != "Thỏa thuận":
                sal_info = normalize_salary(first_ld["salary_raw"])
                job.salary_raw = sal_info["salary_raw"]
                job.salary_min = sal_info["salary_min"]
                job.salary_max = sal_info["salary_max"]
                job.salary_currency = sal_info["salary_currency"]
                job.salary_vnd_normalized = sal_info["salary_vnd_normalized"]
                job.is_negotiable = sal_info["is_negotiable"]
            if first_ld.get("posted_at") and not job.posted_at:
                job.posted_at = first_ld["posted_at"]
            if first_ld.get("deadline_at") and not job.deadline_at:
                job.deadline_at = first_ld["deadline_at"]

        # Extract main JD container or full page clean Markdown & HTML
        soup = BeautifulSoup(raw_html, "html.parser")
        main_el = (
            soup.select_one(
                ".job-description, .job-detail-content, .job-details, .jd-content, "
                "#job-description, article, main"
            )
            or soup.body
            or soup
        )
        main_html = str(main_el)
        md_content = html_to_clean_markdown(main_html, base_url=job.url, max_chars=35000)
        safe_html = clean_html_for_offline_reader(main_html, base_url=job.url)

        job.full_jd_markdown = md_content
        job.full_jd_html = safe_html[:65000]
        if not job.summary and md_content:
            plain_lines = [
                line.lstrip("#-* ").strip()
                for line in md_content.splitlines()
                if len(line.strip()) > 35 and not line.strip().startswith("[")
            ]
            job.summary = " ".join(plain_lines[:3])[:450]

        # Enrich skills, HR contacts, work mode, seniority
        existing_skills = []
        try:
            existing_skills = json.loads(job.skills_json or "[]")
        except Exception:
            pass
        enriched_skills = extract_skills_from_text(md_content, existing_skills)
        job.skills_json = json.dumps(enriched_skills, ensure_ascii=False)

        contacts = extract_hr_and_company_contacts(md_content)
        if contacts.get("hr_email") and not job.hr_email:
            job.hr_email = contacts["hr_email"]
        if contacts.get("hr_phone") and not job.hr_phone:
            job.hr_phone = contacts["hr_phone"]
        if contacts.get("hr_name") and not job.hr_name:
            job.hr_name = contacts["hr_name"]
        if contacts.get("company_size") and not job.company_size:
            job.company_size = contacts["company_size"]

        job.work_mode = infer_work_mode(f"{job.title} {job.location_city} {md_content[:1500]}")
        job.seniority = infer_seniority(job.title, md_content[:1000])
        job.deep_crawl_status = "completed"
        job.updated_at = utc_now()
        db.commit()
        return True
    except Exception as exc:
        logger.debug("Deep crawl failed for job %s: %s", job_id, exc)
        try:
            job = db.query(JobPost).filter(JobPost.id == job_id).first()
            if job:
                job.deep_crawl_status = "failed"
                db.commit()
        except Exception:
            pass
        return False
    finally:
        db.close()


async def run_phase2_deep_crawl_queue(
    crawl_run_id: int,
    job_ids: List[int],
    bypass_mode: str,
    delay_min: float,
    delay_max: float,
    settings: Dict[str, str],
    proxies: List[str],
) -> None:
    """
    Node 5 Background Worker: Processes queued job detail URLs sequentially with random jitter
    delay to avoid IP rate-limiting while updating `CrawlRun` and `PipelineNodeLog` in real time.
    """
    start_ts = time.time()
    completed = 0
    failed = 0
    log_lines: List[str] = [
        f"[Phase 2 Queue] Starting background deep crawl for {len(job_ids)} job(s) "
        f"(Random jitter delay: {delay_min:.1f}s - {delay_max:.1f}s)..."
    ]

    for idx, jid in enumerate(job_ids):
        proxy = random.choice(proxies) if proxies else None
        ok = await enrich_single_job_detail(jid, bypass_mode, settings, proxy)
        if ok:
            completed += 1
            log_lines.append(f"  ✓ [{idx + 1}/{len(job_ids)}] Enriched Job ID #{jid} (Full JD + Skills + HR Contacts)")
        else:
            failed += 1
            log_lines.append(f"  ⚠ [{idx + 1}/{len(job_ids)}] Could not enrich Job ID #{jid} (kept Phase 1 listing data)")

        # Update progress in DB
        db = SessionLocal()
        try:
            run_obj = db.query(CrawlRun).filter(CrawlRun.id == crawl_run_id).first()
            if run_obj:
                run_obj.deep_crawl_completed = completed + failed
            node5 = (
                db.query(PipelineNodeLog)
                .filter(
                    PipelineNodeLog.crawl_run_id == crawl_run_id,
                    PipelineNodeLog.node_id == "node_5_deep_queue",
                )
                .first()
            )
            if node5:
                node5.duration_ms = int((time.time() - start_ts) * 1000)
                node5.logs_text = "\n".join(log_lines[-30:])
                node5.output_json = json.dumps(
                    {
                        "queued": len(job_ids),
                        "completed": completed,
                        "failed": failed,
                        "progress_percent": int(((completed + failed) / max(1, len(job_ids))) * 100),
                    },
                    ensure_ascii=False,
                )
                if completed + failed >= len(job_ids):
                    node5.status = "success" if completed > 0 else "warning"
            db.commit()
        finally:
            db.close()

        if idx < len(job_ids) - 1:
            sleep_sec = random.uniform(min(delay_min, delay_max), max(delay_min, delay_max))
            await asyncio.sleep(sleep_sec)
