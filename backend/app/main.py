import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from .config import ALLOWED_ORIGINS, SCREENSHOTS_DIR
from .database import Base, SessionLocal, engine, get_db
from .engine.deep_queue import enrich_single_job_detail
from .engine.multi_search import SUPPORTED_PLATFORMS
from .engine.pipeline import execute_crawl_pipeline, init_pipeline_nodes, load_all_settings
from .engine.recipe_engine import seed_builtin_recipes
from .models import (
    AppSetting,
    CrawlRun,
    DomainRecipe,
    FilterRule,
    JobPost,
    PipelineNodeLog,
    ProxyServer,
    SavedSource,
    utc_now,
)
from .schemas import (
    DomainRecipeCreate,
    FilterRuleCreate,
    JobStatusUpdateRequest,
    ProxyServerCreate,
    SavedSourceCreate,
    SettingsUpdateRequest,
    StartCrawlRequest,
)
from .security import (
    check_rate_limit,
    generate_csrf_token,
    is_masked_secret,
    mask_secret,
    safe_resolve_path,
    validate_target_url,
    verify_csrf_token,
)
from .services.exporter import export_jobs_to_csv_bytes, export_jobs_to_xlsx_bytes
from .services.filter_service import seed_default_filters
from .services.scheduler import scheduler_loop

logger = logging.getLogger(__name__)

SECRET_SETTING_KEYS = {
    "gemini_api_key",
    "openai_api_key",
    "groq_api_key",
    "openrouter_api_key",
    "capsolver_api_key",
    "twocaptcha_api_key",
    "telegram_bot_token",
    "discord_webhook_url",
    "sheets_webhook_url",
    "custom_cookie_header",
}

DEFAULT_SETTINGS = {
    "ai_provider": "gemini",
    "ai_model": "gemini-2.5-flash",
    "gemini_api_key": "",
    "openai_api_key": "",
    "groq_api_key": "",
    "openrouter_api_key": "",
    "ollama_base_url": "http://127.0.0.1:11434",
    "flaresolverr_url": "http://127.0.0.1:8191/v1",
    "chrome_cdp_url": "http://127.0.0.1:9222",
    "capsolver_api_key": "",
    "twocaptcha_api_key": "",
    "custom_cookie_header": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    "discord_webhook_url": "",
    "sheets_webhook_url": "",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_builtin_recipes(db)
        seed_default_filters(db)
        for k, v in DEFAULT_SETTINGS.items():
            existing = db.query(AppSetting).filter(AppSetting.key == k).first()
            if not existing:
                db.add(AppSetting(key=k, value=v, is_secret=(k in SECRET_SETTING_KEYS)))
        db.commit()
    finally:
        db.close()

    asyncio.create_task(scheduler_loop())
    yield


app = FastAPI(
    title="Universal Job Crawler API (n8n-Inspired Pipeline)",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def security_and_csrf_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "127.0.0.1"
    check_rate_limit(client_ip)

    # Enforce CSRF protection on all state-changing HTTP methods
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        csrf_header = request.headers.get("X-CSRF-Token")
        if not verify_csrf_token(csrf_header):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Invalid or missing CSRF token."},
            )

    response: Response = await call_next(request)

    # Mandatory security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self' http://127.0.0.1:8000 http://localhost:8000; "
        "frame-ancestors 'none'; object-src 'none';"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"

    return response


def _serialize_job(j: JobPost, include_full_jd: bool = False) -> Dict[str, Any]:
    try:
        skills = json.loads(j.skills_json or "[]")
    except Exception:
        skills = []
    try:
        matched_kw = json.loads(j.matched_keywords_json or "[]")
    except Exception:
        matched_kw = []

    data = {
        "id": j.id,
        "url": j.url,
        "source_domain": j.source_domain,
        "crawl_run_id": j.crawl_run_id,
        "deep_crawl_status": j.deep_crawl_status,
        "title": j.title,
        "company_name": j.company_name,
        "company_logo": j.company_logo,
        "location_city": j.location_city,
        "work_mode": j.work_mode,
        "seniority": j.seniority,
        "salary_raw": j.salary_raw,
        "salary_min": j.salary_min,
        "salary_max": j.salary_max,
        "salary_currency": j.salary_currency,
        "salary_vnd_normalized": j.salary_vnd_normalized,
        "is_negotiable": j.is_negotiable,
        "skills": skills,
        "summary": j.summary or "",
        "has_offline_jd": bool(j.full_jd_markdown or j.full_jd_html),
        "hr_name": j.hr_name,
        "hr_email": j.hr_email,
        "hr_phone": j.hr_phone,
        "company_size": j.company_size,
        "posted_at": j.posted_at,
        "deadline_at": j.deadline_at,
        "status": j.status,
        "is_highlighted": j.is_highlighted,
        "matched_keywords": matched_kw,
        "extraction_method": j.extraction_method,
        "created_at": j.created_at.isoformat() if j.created_at else None,
    }
    if include_full_jd:
        data["full_jd_markdown"] = j.full_jd_markdown or ""
        data["full_jd_html"] = j.full_jd_html or ""
    return data


@app.get("/api/auth/session")
def get_session_csrf(response: Response):
    """Issue a signed CSRF token and set a hardened session cookie."""
    token = generate_csrf_token()
    # Set hardened cookie (Note: TODO(security) add OAuth2/MFA for multi-user cloud deployments)
    response.set_cookie(
        key="__Secure-crawljob_session",
        value=token,
        httponly=True,
        secure=False,  # Localhost HTTP compatibility; set True behind TLS in prod
        samesite="lax",
        max_age=86400,
    )
    return {"csrf_token": token, "status": "authenticated_local"}


@app.get("/api/platforms")
def list_supported_platforms():
    return {"platforms": SUPPORTED_PLATFORMS}


@app.get("/api/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_jobs = db.query(JobPost).filter(JobPost.status != "hidden").count()
    highlighted_jobs = db.query(JobPost).filter(JobPost.is_highlighted.is_(True)).count()
    with_hr_contact = (
        db.query(JobPost)
        .filter((JobPost.hr_email.isnot(None)) | (JobPost.hr_phone.isnot(None)))
        .count()
    )
    offline_ready = db.query(JobPost).filter(JobPost.deep_crawl_status == "completed").count()
    recipes_count = db.query(DomainRecipe).filter(DomainRecipe.is_active.is_(True)).count()
    blacklist_count = db.query(FilterRule).filter(FilterRule.is_active.is_(True)).count()
    return {
        "total_jobs": total_jobs,
        "highlighted_jobs": highlighted_jobs,
        "with_hr_contact": with_hr_contact,
        "offline_ready": offline_ready,
        "recipes_count": recipes_count,
        "blacklist_count": blacklist_count,
    }


@app.post("/api/crawl/start")
async def start_crawl(req: StartCrawlRequest, db: Session = Depends(get_db)):
    if req.mode in ("single_url", "bulk_urls"):
        valid_urls = []
        for u in req.urls:
            u_clean = u.strip()
            if not u_clean:
                continue
            if not u_clean.startswith(("http://", "https://")):
                u_clean = "https://" + u_clean
            try:
                validate_target_url(u_clean)
                valid_urls.append(u_clean)
            except ValueError as err:
                raise HTTPException(status_code=400, detail=str(err))
        if not valid_urls:
            raise HTTPException(status_code=400, detail="Vui lòng nhập ít nhất 1 URL hợp lệ.")
        req.urls = valid_urls
        summary = valid_urls[0] if len(valid_urls) == 1 else f"{valid_urls[0]} (+{len(valid_urls) - 1} URLs)"
    else:
        if not req.keyword or not req.keyword.strip():
            raise HTTPException(status_code=400, detail="Vui lòng nhập từ khóa tìm kiếm công việc.")
        summary = f"Keyword: '{req.keyword.strip()}' ({req.location or 'Vietnam'}) across {len(req.platforms) or 4} portals"

    run_obj = CrawlRun(
        mode=req.mode,
        input_summary=summary,
        urls_json=json.dumps(req.urls, ensure_ascii=False),
        status="running",
        node_configs_json=json.dumps(req.node_config.model_dump(), ensure_ascii=False),
    )
    db.add(run_obj)
    db.commit()
    db.refresh(run_obj)

    init_pipeline_nodes(db, run_obj.id)
    asyncio.create_task(execute_crawl_pipeline(run_obj.id, req))

    return {"run_id": run_obj.id, "status": "running", "input_summary": summary}


@app.get("/api/crawl/runs")
def list_crawl_runs(limit: int = Query(default=15, ge=1, le=50), db: Session = Depends(get_db)):
    runs = db.query(CrawlRun).order_by(desc(CrawlRun.id)).limit(limit).all()
    return {
        "runs": [
            {
                "id": r.id,
                "mode": r.mode,
                "input_summary": r.input_summary,
                "status": r.status,
                "bypass_tier_used": r.bypass_tier_used,
                "extraction_layer_used": r.extraction_layer_used,
                "total_found": r.total_found,
                "new_jobs_saved": r.new_jobs_saved,
                "duplicates_skipped": r.duplicates_skipped,
                "blocked_by_filter": r.blocked_by_filter,
                "deep_crawl_total": r.deep_crawl_total,
                "deep_crawl_completed": r.deep_crawl_completed,
                "error_message": r.error_message,
                "started_at": r.started_at.isoformat() if r.started_at else None,
                "finished_at": r.finished_at.isoformat() if r.finished_at else None,
            }
            for r in runs
        ]
    }


@app.get("/api/crawl/runs/{run_id}")
def get_crawl_run_detail(run_id: int, db: Session = Depends(get_db)):
    run_obj = db.query(CrawlRun).filter(CrawlRun.id == run_id).first()
    if not run_obj:
        raise HTTPException(status_code=404, detail="CrawlRun not found.")

    nodes = (
        db.query(PipelineNodeLog)
        .filter(PipelineNodeLog.crawl_run_id == run_id)
        .order_by(PipelineNodeLog.id)
        .all()
    )
    return {
        "run": {
            "id": run_obj.id,
            "mode": run_obj.mode,
            "input_summary": run_obj.input_summary,
            "status": run_obj.status,
            "bypass_tier_used": run_obj.bypass_tier_used,
            "extraction_layer_used": run_obj.extraction_layer_used,
            "total_found": run_obj.total_found,
            "new_jobs_saved": run_obj.new_jobs_saved,
            "duplicates_skipped": run_obj.duplicates_skipped,
            "blocked_by_filter": run_obj.blocked_by_filter,
            "deep_crawl_total": run_obj.deep_crawl_total,
            "deep_crawl_completed": run_obj.deep_crawl_completed,
            "error_message": run_obj.error_message,
            "started_at": run_obj.started_at.isoformat() if run_obj.started_at else None,
            "finished_at": run_obj.finished_at.isoformat() if run_obj.finished_at else None,
        },
        "nodes": [
            {
                "node_id": n.node_id,
                "node_name": n.node_name,
                "status": n.status,
                "duration_ms": n.duration_ms,
                "input_json": n.input_json,
                "output_json": n.output_json,
                "logs_text": n.logs_text,
                "screenshot_filename": n.screenshot_filename,
                "markdown_preview": n.markdown_preview,
                "updated_at": n.updated_at.isoformat() if n.updated_at else None,
            }
            for n in nodes
        ],
    }


@app.get("/api/screenshots/{filename}")
def get_screenshot(filename: str):
    try:
        safe_path = safe_resolve_path(SCREENSHOTS_DIR, filename)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid screenshot filename.")
    if not safe_path.exists():
        raise HTTPException(status_code=404, detail="Screenshot not found.")
    return FileResponse(str(safe_path), media_type="image/png")


@app.get("/api/jobs")
def list_jobs(
    q: str = Query(default=""),
    domain: str = Query(default=""),
    work_mode: str = Query(default=""),
    seniority: str = Query(default=""),
    status_filter: str = Query(default=""),
    min_salary_vnd: float = Query(default=0.0),
    only_highlighted: bool = Query(default=False),
    only_with_hr: bool = Query(default=False),
    sort_by: str = Query(default="newest"),  # newest, salary_desc, salary_asc
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(JobPost)
    if status_filter:
        query = query.filter(JobPost.status == status_filter)
    else:
        query = query.filter(JobPost.status != "hidden")

    if q.strip():
        kw = f"%{q.strip()}%"
        query = query.filter(
            (JobPost.title.ilike(kw))
            | (JobPost.company_name.ilike(kw))
            | (JobPost.skills_json.ilike(kw))
            | (JobPost.location_city.ilike(kw))
        )
    if domain.strip():
        query = query.filter(JobPost.source_domain == domain.strip())
    if work_mode.strip():
        query = query.filter(JobPost.work_mode == work_mode.strip())
    if seniority.strip():
        query = query.filter(JobPost.seniority == seniority.strip())
    if min_salary_vnd > 0:
        query = query.filter(JobPost.salary_vnd_normalized >= min_salary_vnd)
    if only_highlighted:
        query = query.filter(JobPost.is_highlighted.is_(True))
    if only_with_hr:
        query = query.filter((JobPost.hr_email.isnot(None)) | (JobPost.hr_phone.isnot(None)))

    if sort_by == "salary_desc":
        query = query.order_by(desc(JobPost.salary_vnd_normalized), desc(JobPost.id))
    elif sort_by == "salary_asc":
        query = query.order_by(JobPost.salary_vnd_normalized.asc(), desc(JobPost.id))
    else:
        query = query.order_by(desc(JobPost.is_highlighted), desc(JobPost.id))

    jobs = query.limit(limit).all()
    domains = [r[0] for r in db.query(JobPost.source_domain).distinct().all() if r[0]]
    return {
        "jobs": [_serialize_job(j, include_full_jd=False) for j in jobs],
        "domains": sorted(domains),
    }


@app.get("/api/jobs/{job_id}")
def get_job_detail(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobPost).filter(JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"job": _serialize_job(job, include_full_jd=True)}


@app.post("/api/jobs/{job_id}/enrich")
async def trigger_single_job_deep_crawl(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobPost).filter(JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    settings = load_all_settings(db)
    ok = await enrich_single_job_detail(job_id, bypass_mode="auto", settings=settings)
    db.refresh(job)
    return {"success": ok, "job": _serialize_job(job, include_full_jd=True)}


@app.patch("/api/jobs/{job_id}/status")
def update_job_status(job_id: int, req: JobStatusUpdateRequest, db: Session = Depends(get_db)):
    job = db.query(JobPost).filter(JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    job.status = req.status
    job.updated_at = utc_now()
    db.commit()
    return {"id": job.id, "status": job.status}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(JobPost).filter(JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    db.delete(job)
    db.commit()
    return {"deleted": job_id}


@app.get("/api/export/{fmt}")
def export_jobs_endpoint(
    fmt: str,
    q: str = Query(default=""),
    domain: str = Query(default=""),
    work_mode: str = Query(default=""),
    min_salary_vnd: float = Query(default=0.0),
    db: Session = Depends(get_db),
):
    query = db.query(JobPost).filter(JobPost.status != "hidden")
    if q.strip():
        kw = f"%{q.strip()}%"
        query = query.filter((JobPost.title.ilike(kw)) | (JobPost.company_name.ilike(kw)))
    if domain.strip():
        query = query.filter(JobPost.source_domain == domain.strip())
    if work_mode.strip():
        query = query.filter(JobPost.work_mode == work_mode.strip())
    if min_salary_vnd > 0:
        query = query.filter(JobPost.salary_vnd_normalized >= min_salary_vnd)

    jobs = query.order_by(desc(JobPost.salary_vnd_normalized), desc(JobPost.id)).limit(1000).all()

    if fmt == "csv":
        csv_bytes = export_jobs_to_csv_bytes(jobs)
        return StreamingResponse(
            iter([csv_bytes]),
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="crawled_jobs.csv"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    elif fmt == "xlsx":
        xlsx_bytes = export_jobs_to_xlsx_bytes(jobs)
        return StreamingResponse(
            iter([xlsx_bytes]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": 'attachment; filename="crawled_jobs.xlsx"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    elif fmt == "json":
        payload = json.dumps([_serialize_job(j, include_full_jd=True) for j in jobs], ensure_ascii=False, indent=2)
        return StreamingResponse(
            iter([payload.encode("utf-8")]),
            media_type="application/json; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="crawled_jobs.json"',
                "X-Content-Type-Options": "nosniff",
            },
        )
    raise HTTPException(status_code=400, detail="Unsupported export format.")


# =====================================================================
# Filter Rules (Company Blacklist / Excluded Keywords / Whitelist)
# =====================================================================
@app.get("/api/filters")
def list_filter_rules(db: Session = Depends(get_db)):
    rules = db.query(FilterRule).order_by(desc(FilterRule.id)).all()
    return {
        "rules": [
            {
                "id": r.id,
                "rule_type": r.rule_type,
                "pattern": r.pattern,
                "note": r.note,
                "is_active": r.is_active,
            }
            for r in rules
        ]
    }


@app.post("/api/filters")
def create_filter_rule(req: FilterRuleCreate, db: Session = Depends(get_db)):
    rule = FilterRule(
        rule_type=req.rule_type,
        pattern=req.pattern.strip(),
        note=(req.note or "").strip(),
        is_active=True,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return {"id": rule.id, "rule_type": rule.rule_type, "pattern": rule.pattern}


@app.delete("/api/filters/{rule_id}")
def delete_filter_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.query(FilterRule).filter(FilterRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found.")
    db.delete(rule)
    db.commit()
    return {"deleted": rule_id}


# =====================================================================
# Self-Healing Domain Recipes
# =====================================================================
@app.get("/api/recipes")
def list_domain_recipes(db: Session = Depends(get_db)):
    recipes = db.query(DomainRecipe).order_by(DomainRecipe.domain).all()
    return {
        "recipes": [
            {
                "id": r.id,
                "domain": r.domain,
                "recipe_name": r.recipe_name,
                "card_selector": r.card_selector,
                "title_selector": r.title_selector,
                "company_selector": r.company_selector,
                "salary_selector": r.salary_selector,
                "location_selector": r.location_selector,
                "link_selector": r.link_selector,
                "next_page_selector": r.next_page_selector,
                "learned_by": r.learned_by,
                "success_count": r.success_count,
                "fail_count": r.fail_count,
                "last_healed_at": r.last_healed_at.isoformat() if r.last_healed_at else None,
            }
            for r in recipes
        ]
    }


@app.post("/api/recipes")
def upsert_domain_recipe(req: DomainRecipeCreate, db: Session = Depends(get_db)):
    domain_clean = req.domain.strip().lower().replace("https://", "").replace("http://", "").split("/")[0]
    if domain_clean.startswith("www."):
        domain_clean = domain_clean[4:]

    existing = db.query(DomainRecipe).filter(DomainRecipe.domain == domain_clean).first()
    if existing:
        existing.recipe_name = req.recipe_name
        existing.card_selector = req.card_selector
        existing.title_selector = req.title_selector
        existing.company_selector = req.company_selector or ""
        existing.salary_selector = req.salary_selector or ""
        existing.location_selector = req.location_selector or ""
        existing.link_selector = req.link_selector or "a"
        existing.next_page_selector = req.next_page_selector or ""
        existing.learned_by = "manual"
        existing.last_healed_at = utc_now()
        db.commit()
        return {"id": existing.id, "domain": existing.domain}

    new_rec = DomainRecipe(
        domain=domain_clean,
        recipe_name=req.recipe_name,
        card_selector=req.card_selector,
        title_selector=req.title_selector,
        company_selector=req.company_selector or "",
        salary_selector=req.salary_selector or "",
        location_selector=req.location_selector or "",
        link_selector=req.link_selector or "a",
        next_page_selector=req.next_page_selector or "",
        learned_by="manual",
    )
    db.add(new_rec)
    db.commit()
    db.refresh(new_rec)
    return {"id": new_rec.id, "domain": new_rec.domain}


@app.delete("/api/recipes/{recipe_id}")
def delete_domain_recipe(recipe_id: int, db: Session = Depends(get_db)):
    rec = db.query(DomainRecipe).filter(DomainRecipe.id == recipe_id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recipe not found.")
    db.delete(rec)
    db.commit()
    return {"deleted": recipe_id}


# =====================================================================
# Saved Sources (Cron Scheduler)
# =====================================================================
@app.get("/api/sources")
def list_saved_sources(db: Session = Depends(get_db)):
    sources = db.query(SavedSource).order_by(desc(SavedSource.id)).all()
    return {
        "sources": [
            {
                "id": s.id,
                "name": s.name,
                "url_or_keyword": s.url_or_keyword,
                "source_type": s.source_type,
                "cron_interval_minutes": s.cron_interval_minutes,
                "bypass_mode": s.bypass_mode,
                "deep_crawl_enabled": s.deep_crawl_enabled,
                "max_pages": s.max_pages,
                "is_active": s.is_active,
                "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
            }
            for s in sources
        ]
    }


@app.post("/api/sources")
def create_saved_source(req: SavedSourceCreate, db: Session = Depends(get_db)):
    if req.source_type == "url":
        try:
            validate_target_url(req.url_or_keyword)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))

    src = SavedSource(
        name=req.name.strip(),
        url_or_keyword=req.url_or_keyword.strip(),
        source_type=req.source_type,
        platforms_json=json.dumps(req.platforms),
        cron_interval_minutes=req.cron_interval_minutes,
        bypass_mode=req.bypass_mode,
        deep_crawl_enabled=req.deep_crawl_enabled,
        max_pages=req.max_pages,
        is_active=True,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return {"id": src.id, "name": src.name}


@app.delete("/api/sources/{source_id}")
def delete_saved_source(source_id: int, db: Session = Depends(get_db)):
    src = db.query(SavedSource).filter(SavedSource.id == source_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Source not found.")
    db.delete(src)
    db.commit()
    return {"deleted": source_id}


# =====================================================================
# Proxy Pool & Masked Settings
# =====================================================================
@app.get("/api/proxies")
def list_proxies(db: Session = Depends(get_db)):
    proxies = db.query(ProxyServer).order_by(desc(ProxyServer.id)).all()
    return {
        "proxies": [
            {
                "id": p.id,
                "proxy_url": mask_secret(p.proxy_url) if "@" in p.proxy_url else p.proxy_url,
                "protocol": p.protocol,
                "label": p.label,
                "is_active": p.is_active,
            }
            for p in proxies
        ]
    }


@app.post("/api/proxies")
def add_proxy(req: ProxyServerCreate, db: Session = Depends(get_db)):
    p = ProxyServer(
        proxy_url=req.proxy_url.strip(),
        protocol=req.protocol,
        label=(req.label or "").strip(),
        is_active=True,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return {"id": p.id}


@app.delete("/api/proxies/{proxy_id}")
def delete_proxy(proxy_id: int, db: Session = Depends(get_db)):
    p = db.query(ProxyServer).filter(ProxyServer.id == proxy_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Proxy not found.")
    db.delete(p)
    db.commit()
    return {"deleted": proxy_id}


@app.get("/api/settings")
def get_masked_settings(db: Session = Depends(get_db)):
    rows = db.query(AppSetting).all()
    out: Dict[str, str] = {}
    for r in rows:
        if r.is_secret or r.key in SECRET_SETTING_KEYS:
            out[r.key] = mask_secret(r.value)
        else:
            out[r.key] = r.value
    return {"settings": out}


@app.post("/api/settings")
def update_settings(req: SettingsUpdateRequest, db: Session = Depends(get_db)):
    for key, val in req.settings.items():
        if key not in DEFAULT_SETTINGS:
            continue
        # Do not overwrite stored secret if frontend sends back the masked placeholder
        if key in SECRET_SETTING_KEYS and is_masked_secret(val):
            continue
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        if row:
            row.value = val.strip()
            row.updated_at = utc_now()
        else:
            db.add(AppSetting(key=key, value=val.strip(), is_secret=(key in SECRET_SETTING_KEYS)))
    db.commit()
    return {"status": "saved"}
