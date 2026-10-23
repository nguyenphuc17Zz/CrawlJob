import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

from ..database import SessionLocal
from ..engine.pipeline import execute_crawl_pipeline, init_pipeline_nodes
from ..models import CrawlRun, SavedSource, utc_now
from ..schemas import NodeConfigOverride, StartCrawlRequest

logger = logging.getLogger(__name__)

_SCHEDULER_RUNNING = False


async def scheduler_loop() -> None:
    """
    Background loop checking active SavedSource items every 60 seconds and triggering
    the 6-Node Crawl Pipeline when their cron interval is due.
    """
    global _SCHEDULER_RUNNING
    if _SCHEDULER_RUNNING:
        return
    _SCHEDULER_RUNNING = True
    logger.info("Background Cron Scheduler started.")

    while _SCHEDULER_RUNNING:
        await asyncio.sleep(60)
        db = SessionLocal()
        try:
            now = utc_now()
            sources = db.query(SavedSource).filter(SavedSource.is_active.is_(True)).all()
            for src in sources:
                due = False
                if src.last_run_at is None:
                    due = True
                else:
                    last_dt = src.last_run_at
                    if last_dt.tzinfo is None:
                        last_dt = last_dt.replace(tzinfo=timezone.utc)
                    if now - last_dt >= timedelta(minutes=max(5, src.cron_interval_minutes)):
                        due = True

                if due:
                    src.last_run_at = now
                    platforms = []
                    try:
                        platforms = json.loads(src.platforms_json or "[]")
                    except Exception:
                        pass

                    req = StartCrawlRequest(
                        mode="keyword_search" if src.source_type == "keyword" else "single_url",
                        urls=[src.url_or_keyword] if src.source_type == "url" else [],
                        keyword=src.url_or_keyword if src.source_type == "keyword" else "",
                        platforms=platforms,
                        node_config=NodeConfigOverride(
                            bypass_mode=src.bypass_mode or "auto",
                            enable_deep_crawl=bool(src.deep_crawl_enabled),
                            max_pages=src.max_pages or 1,
                        ),
                    )
                    run_obj = CrawlRun(
                        mode="cron",
                        input_summary=f"[Cron] {src.name}: {src.url_or_keyword}",
                        urls_json=json.dumps([src.url_or_keyword]),
                        status="running",
                        node_configs_json=json.dumps(req.node_config.model_dump()),
                    )
                    db.add(run_obj)
                    db.commit()
                    db.refresh(run_obj)
                    init_pipeline_nodes(db, run_obj.id)
                    asyncio.create_task(execute_crawl_pipeline(run_obj.id, req))
        except Exception as exc:
            logger.debug("Scheduler tick error: %s", exc)
        finally:
            db.close()
