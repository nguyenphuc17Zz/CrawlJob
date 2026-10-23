import asyncio
import json
import logging
import random
import time
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import (
    AppSetting,
    CrawlRun,
    DomainRecipe,
    FilterRule,
    JobPost,
    PipelineNodeLog,
    ProxyServer,
    utc_now,
)
from ..schemas import NodeConfigOverride, StartCrawlRequest
from ..services.filter_service import evaluate_job_against_filters
from ..services.notifier import dispatch_new_jobs_notifications
from .cleaner import clean_html_for_offline_reader, html_to_clean_markdown
from .deep_queue import run_phase2_deep_crawl_queue
from .extractor import ai_extract_jobs_and_learn_recipe, extract_jobs_heuristic_dom
from .fetcher import smart_multi_tier_fetch
from .interceptor import sniff_structured_data
from .multi_search import build_multi_site_search_urls
from .normalizer import (
    compute_dedup_signature,
    compute_url_hash,
    extract_domain,
    extract_hr_and_company_contacts,
    extract_skills_from_text,
    infer_seniority,
    infer_work_mode,
    normalize_salary,
)
from .recipe_engine import execute_domain_recipe, save_or_heal_domain_recipe

logger = logging.getLogger(__name__)

PIPELINE_NODE_DEFINITIONS = [
    ("node_1_input", "1. Input & Multi-Site Discovery"),
    ("node_2_bypass", "2. Multi-Tier Unattended Bypass"),
    ("node_3_sniffer", "3. Network & Hidden State Sniffer"),
    ("node_4_extractor", "4. AI Self-Healing & Recipe Extractor"),
    ("node_5_deep_queue", "5. 2-Phase Deep Crawl Queue"),
    ("node_6_sink", "6. Filter, Dedup & Notification Sink"),
]


def load_all_settings(db: Session) -> Dict[str, str]:
    rows = db.query(AppSetting).all()
    return {r.key: r.value for r in rows}


def init_pipeline_nodes(db: Session, crawl_run_id: int) -> Dict[str, PipelineNodeLog]:
    node_map: Dict[str, PipelineNodeLog] = {}
    for node_id, node_name in PIPELINE_NODE_DEFINITIONS:
        nlog = PipelineNodeLog(
            crawl_run_id=crawl_run_id,
            node_id=node_id,
            node_name=node_name,
            status="idle",
            duration_ms=0,
            input_json="{}",
            output_json="{}",
            logs_text="Waiting for execution...",
        )
        db.add(nlog)
        node_map[node_id] = nlog
    db.commit()
    return node_map


def update_node_log(
    db: Session,
    crawl_run_id: int,
    node_id: str,
    status: str,
    duration_ms: int = 0,
    input_data: Any = None,
    output_data: Any = None,
    logs: Optional[List[str]] = None,
    screenshot_filename: Optional[str] = None,
    markdown_preview: Optional[str] = None,
) -> None:
    node = (
        db.query(PipelineNodeLog)
        .filter(
            PipelineNodeLog.crawl_run_id == crawl_run_id,
            PipelineNodeLog.node_id == node_id,
        )
        .first()
    )
    if not node:
        return
    node.status = status
    node.duration_ms = duration_ms
    if input_data is not None:
        node.input_json = json.dumps(input_data, ensure_ascii=False, default=str)[:30000]
    if output_data is not None:
        node.output_json = json.dumps(output_data, ensure_ascii=False, default=str)[:30000]
    if logs is not None:
        node.logs_text = "\n".join(logs)
    if screenshot_filename:
        node.screenshot_filename = screenshot_filename
    if markdown_preview is not None:
        node.markdown_preview = markdown_preview[:15000]
    node.updated_at = utc_now()
    db.commit()


async def execute_crawl_pipeline(crawl_run_id: int, req: StartCrawlRequest) -> None:
    """
    Execute the complete 6-Node n8n-style Job Scraping Pipeline asynchronously.
    Updates each node's real-time telemetry in SQLite for the Interactive Node Inspector.
    """
    db = SessionLocal()
    try:
        run_obj = db.query(CrawlRun).filter(CrawlRun.id == crawl_run_id).first()
        if not run_obj:
            return

        settings = load_all_settings(db)
        cfg: NodeConfigOverride = req.node_config
        active_proxies = [
            p.proxy_url
            for p in db.query(ProxyServer).filter(ProxyServer.is_active.is_(True)).all()
        ]

        # =====================================================================
        # NODE 1: Input & Multi-Site URL Discovery
        # =====================================================================
        t1 = time.time()
        update_node_log(
            db,
            crawl_run_id,
            "node_1_input",
            status="running",
            input_data=req.model_dump(),
            logs=["[Node 1] Resolving target URLs and validating parameters..."],
        )

        target_urls: List[str] = []
        node1_logs: List[str] = []

        if req.mode == "keyword_search":
            built = build_multi_site_search_urls(req.keyword or "", req.location or "", req.platforms)
            for b in built:
                target_urls.append(b["url"])
                node1_logs.append(f"  + [{b['platform_name']}] -> {b['url']}")
        else:
            for u in req.urls:
                cleaned_u = u.strip()
                if cleaned_u:
                    if not cleaned_u.startswith(("http://", "https://")):
                        cleaned_u = "https://" + cleaned_u
                    target_urls.append(cleaned_u)
                    node1_logs.append(f"  + Target URL queued: {cleaned_u}")

        if not target_urls:
            raise ValueError("No valid target URLs provided for crawling.")

        run_obj.urls_json = json.dumps(target_urls, ensure_ascii=False)
        db.commit()

        update_node_log(
            db,
            crawl_run_id,
            "node_1_input",
            status="success",
            duration_ms=int((time.time() - t1) * 1000),
            output_data={"resolved_urls": target_urls, "count": len(target_urls), "max_pages": cfg.max_pages},
            logs=[f"[Node 1] Prepared {len(target_urls)} target URL(s) for crawling."] + node1_logs,
        )

        # =====================================================================
        # NODE 2, 3, 4: Iterate over Target URLs (Fetch -> Sniff -> Extract)
        # =====================================================================
        t2_total = 0
        t3_total = 0
        t4_total = 0

        node2_logs: List[str] = []
        node3_logs: List[str] = []
        node4_logs: List[str] = []

        last_screenshot: Optional[str] = None
        last_markdown: str = ""
        tiers_used: List[str] = []
        extraction_layers_used: List[str] = []
        all_extracted_raw_jobs: List[Dict[str, Any]] = []

        update_node_log(
            db,
            crawl_run_id,
            "node_2_bypass",
            status="running",
            input_data={"urls": target_urls, "bypass_mode": cfg.bypass_mode, "scroll_times": cfg.scroll_times},
            logs=["[Node 2] Executing Multi-Tier Unattended Bypass Fetcher..."],
        )

        for url_idx, current_url in enumerate(target_urls):
            page_url_to_crawl: Optional[str] = current_url
            for page_num in range(1, cfg.max_pages + 1):
                if not page_url_to_crawl:
                    break

                domain = extract_domain(page_url_to_crawl)
                proxy_choice = random.choice(active_proxies) if active_proxies else None

                # --- NODE 2: Fetch ---
                t2_start = time.time()
                try:
                    fetch_res = await smart_multi_tier_fetch(
                        page_url_to_crawl,
                        bypass_mode=cfg.bypass_mode,
                        scroll_times=cfg.scroll_times,
                        settings=settings,
                        proxy_url=proxy_choice,
                        take_screenshot=(url_idx == 0 and page_num == 1),
                    )
                except Exception as fetch_err:
                    node2_logs.append(f"[Error] {page_url_to_crawl}: {fetch_err}")
                    break

                t2_total += int((time.time() - t2_start) * 1000)
                html_content = fetch_res.get("html") or ""
                xhr_payloads = fetch_res.get("xhr_payloads") or []
                tier_used = fetch_res.get("tier_used") or "Tier 1"
                tiers_used.append(tier_used)
                if fetch_res.get("screenshot_filename"):
                    last_screenshot = fetch_res["screenshot_filename"]
                node2_logs.extend(fetch_res.get("logs") or [])

                # --- NODE 3: Network & Hidden State Sniffer + Markdown Cleaner ---
                t3_start = time.time()
                update_node_log(
                    db,
                    crawl_run_id,
                    "node_3_sniffer",
                    status="running",
                    input_data={"url": page_url_to_crawl, "html_length": len(html_content), "xhr_count": len(xhr_payloads)},
                    logs=node3_logs + [f"[Node 3] Scanning JSON-LD, __NEXT_DATA__, XHR packets for {domain}..."],
                )

                clean_md = html_to_clean_markdown(html_content, base_url=page_url_to_crawl)
                if clean_md:
                    last_markdown = clean_md

                sniffed_jobs: List[Dict[str, Any]] = []
                if cfg.enable_sniffer:
                    sniff_res = sniff_structured_data(html_content, page_url_to_crawl, xhr_payloads)
                    sniffed_jobs = sniff_res.get("jobs") or []
                    detected_srcs = sniff_res.get("sources_detected") or []
                    if sniffed_jobs:
                        node3_logs.append(
                            f"[Node 3] Extracted {len(sniffed_jobs)} structured job(s) directly from {', '.join(detected_srcs)}!"
                        )
                        extraction_layers_used.append("Layer 1: Structured JSON-LD / XHR API")
                    else:
                        node3_logs.append(
                            f"[Node 3] No embedded JSON-LD/XHR jobs on {domain}; cleaned HTML -> Markdown ({len(clean_md)} chars)."
                        )
                t3_total += int((time.time() - t3_start) * 1000)

                # --- NODE 4: AI Self-Healing Recipe & Universal Extractor ---
                t4_start = time.time()
                update_node_log(
                    db,
                    crawl_run_id,
                    "node_4_extractor",
                    status="running",
                    input_data={"domain": domain, "pre_sniffed_count": len(sniffed_jobs)},
                    logs=node4_logs + [f"[Node 4] Running Hybrid Extraction for {domain}..."],
                )

                page_jobs: List[Dict[str, Any]] = list(sniffed_jobs)
                next_page_url: Optional[str] = None

                # Check Layer 2: Cached Domain Recipe
                recipe = (
                    db.query(DomainRecipe)
                    .filter(DomainRecipe.domain == domain, DomainRecipe.is_active.is_(True))
                    .first()
                )
                recipe_broken = False

                if cfg.enable_recipe_cache and recipe and not page_jobs:
                    rec_out = execute_domain_recipe(html_content, page_url_to_crawl, recipe)
                    rec_jobs = rec_out.get("jobs") or []
                    next_page_url = rec_out.get("next_page_url")
                    if rec_jobs:
                        recipe.success_count = (recipe.success_count or 0) + 1
                        db.commit()
                        page_jobs.extend(rec_jobs)
                        extraction_layers_used.append(f"Layer 2: Cached Recipe ({domain})")
                        node4_logs.append(
                            f"[Node 4] Cached DomainRecipe '{recipe.recipe_name}' extracted {len(rec_jobs)} job(s) in <50ms (0 AI tokens)."
                        )
                    else:
                        recipe.fail_count = (recipe.fail_count or 0) + 1
                        db.commit()
                        recipe_broken = True
                        node4_logs.append(
                            f"[Node 4] Cached Recipe for {domain} returned 0 items. Triggering AI Self-Healing..."
                        )

                # Check Layer 3: Multi-Provider AI LLM + Auto Recipe Learning
                if not page_jobs and cfg.enable_ai_fallback:
                    try:
                        ai_out = await ai_extract_jobs_and_learn_recipe(
                            clean_md,
                            html_content,
                            page_url_to_crawl,
                            settings,
                            custom_instruction=cfg.custom_ai_instruction or "",
                        )
                        ai_jobs = ai_out.get("jobs") or []
                        learned_rec = ai_out.get("learned_recipe")
                        if ai_jobs:
                            page_jobs.extend(ai_jobs)
                            extraction_layers_used.append(
                                f"Layer 3: AI LLM ({settings.get('ai_provider', 'gemini').upper()})"
                            )
                            node4_logs.append(f"[Node 4] AI LLM extracted {len(ai_jobs)} job(s) from Markdown.")
                            if learned_rec and isinstance(learned_rec, dict):
                                saved_rec = save_or_heal_domain_recipe(db, domain, learned_rec, learned_by="ai")
                                if saved_rec:
                                    action_lbl = "Self-Healed" if recipe_broken else "Auto-Learned"
                                    node4_logs.append(
                                        f"[Node 4] ✨ {action_lbl} CSS Selector Recipe for '{domain}' -> card: `{saved_rec.card_selector}`"
                                    )
                    except Exception as ai_err:
                        node4_logs.append(f"[Node 4] AI LLM skipped/fallback ({ai_err}).")

                # Check Layer 4: Smart DOM Heuristic Fallback (Works with 0 API keys!)
                if not page_jobs:
                    heur_jobs = extract_jobs_heuristic_dom(html_content, page_url_to_crawl)
                    if heur_jobs:
                        page_jobs.extend(heur_jobs)
                        extraction_layers_used.append("Layer 4: Smart DOM Heuristic")
                        node4_logs.append(
                            f"[Node 4] Smart DOM Heuristic discovered {len(heur_jobs)} job item(s) on {domain}."
                        )

                t4_total += int((time.time() - t4_start) * 1000)

                for pj in page_jobs:
                    pj["source_domain"] = domain
                    all_extracted_raw_jobs.append(pj)

                page_url_to_crawl = next_page_url if (page_num < cfg.max_pages and next_page_url) else None

        # Finalize Nodes 2, 3, 4 logs
        run_obj.bypass_tier_used = ", ".join(dict.fromkeys(tiers_used)) or "Tier 1"
        run_obj.extraction_layer_used = ", ".join(dict.fromkeys(extraction_layers_used)) or "Heuristic"
        db.commit()

        update_node_log(
            db,
            crawl_run_id,
            "node_2_bypass",
            status="success" if tiers_used else "error",
            duration_ms=t2_total,
            output_data={"tiers_used": list(dict.fromkeys(tiers_used)), "screenshot": last_screenshot},
            logs=node2_logs,
            screenshot_filename=last_screenshot,
        )

        update_node_log(
            db,
            crawl_run_id,
            "node_3_sniffer",
            status="success",
            duration_ms=t3_total,
            output_data={"markdown_chars": len(last_markdown), "raw_candidates": len(all_extracted_raw_jobs)},
            logs=node3_logs,
            markdown_preview=last_markdown,
        )

        update_node_log(
            db,
            crawl_run_id,
            "node_4_extractor",
            status="success" if all_extracted_raw_jobs else "warning",
            duration_ms=t4_total,
            output_data={
                "layers_used": list(dict.fromkeys(extraction_layers_used)),
                "extracted_count": len(all_extracted_raw_jobs),
                "sample_jobs": all_extracted_raw_jobs[:5],
            },
            logs=node4_logs or ["[Node 4] Extraction finished."],
        )

        # =====================================================================
        # NODE 6 (Phase 1 Sink): Filter Blacklist, Normalize, Dedup & Save
        # =====================================================================
        t6_start = time.time()
        update_node_log(
            db,
            crawl_run_id,
            "node_6_sink",
            status="running",
            input_data={"raw_jobs_count": len(all_extracted_raw_jobs)},
            logs=["[Node 6] Normalizing salaries, filtering Company Blacklist & deduplicating..."],
        )

        active_rules = db.query(FilterRule).filter(FilterRule.is_active.is_(True)).all() if cfg.enable_filter_blacklist else []
        saved_jobs_for_notify: List[JobPost] = []
        phase2_job_ids: List[int] = []
        blocked_count = 0
        dup_count = 0
        sink_logs: List[str] = []

        for raw_job in all_extracted_raw_jobs:
            title = (raw_job.get("title") or "").strip()
            job_url = (raw_job.get("url") or "").strip()
            if not title or not job_url:
                continue

            # Filter Blacklist & Keywords
            is_blocked, reason, is_highlighted, matched_kw = evaluate_job_against_filters(raw_job, active_rules)
            if is_blocked:
                blocked_count += 1
                sink_logs.append(f"  ✗ Blocked '{title}' ({reason})")
                continue

            u_hash = compute_url_hash(job_url)
            company_name = (raw_job.get("company_name") or "Unknown Company").strip()
            dedup_sig = compute_dedup_signature(company_name, title)

            # Check existing by URL hash or cross-platform dedup signature
            existing = (
                db.query(JobPost)
                .filter((JobPost.url_hash == u_hash) | (JobPost.dedup_signature == dedup_sig))
                .first()
            )
            if existing:
                dup_count += 1
                continue

            sal_norm = normalize_salary(raw_job.get("salary_raw"))
            raw_jd_html = raw_job.get("full_jd_html") or ""
            raw_jd_md = html_to_clean_markdown(raw_jd_html, base_url=job_url) if raw_jd_html else ""
            safe_jd_html = clean_html_for_offline_reader(raw_jd_html, base_url=job_url) if raw_jd_html else ""

            combined_text = f"{title} {raw_job.get('summary', '')} {raw_jd_md}"
            skills_list = extract_skills_from_text(combined_text, raw_job.get("skills"))
            contacts = extract_hr_and_company_contacts(combined_text)

            has_full_jd = len(raw_jd_md) > 250
            deep_status = "completed" if has_full_jd else ("pending" if cfg.enable_deep_crawl else "skipped")

            new_job = JobPost(
                url=job_url,
                url_hash=u_hash,
                dedup_signature=dedup_sig,
                source_domain=raw_job.get("source_domain") or extract_domain(job_url),
                crawl_run_id=crawl_run_id,
                deep_crawl_status=deep_status,
                title=title[:500],
                company_name=company_name[:500],
                company_logo=raw_job.get("company_logo") or "",
                location_city=(raw_job.get("location_city") or "Vietnam")[:250],
                work_mode=raw_job.get("work_mode") or infer_work_mode(combined_text),
                seniority=raw_job.get("seniority") or infer_seniority(title, combined_text),
                salary_raw=sal_norm["salary_raw"],
                salary_min=sal_norm["salary_min"],
                salary_max=sal_norm["salary_max"],
                salary_currency=sal_norm["salary_currency"],
                salary_vnd_normalized=sal_norm["salary_vnd_normalized"],
                is_negotiable=sal_norm["is_negotiable"],
                skills_json=json.dumps(skills_list, ensure_ascii=False),
                summary=(raw_job.get("summary") or raw_jd_md[:350] or "")[:500],
                full_jd_markdown=raw_jd_md if has_full_jd else None,
                full_jd_html=safe_jd_html if has_full_jd else None,
                hr_name=raw_job.get("hr_name") or contacts.get("hr_name"),
                hr_email=raw_job.get("hr_email") or contacts.get("hr_email"),
                hr_phone=raw_job.get("hr_phone") or contacts.get("hr_phone"),
                apply_url=job_url,
                company_size=contacts.get("company_size"),
                posted_at=raw_job.get("posted_at") or "Mới đăng",
                deadline_at=raw_job.get("deadline_at") or "",
                status="new",
                is_highlighted=is_highlighted,
                matched_keywords_json=json.dumps(matched_kw, ensure_ascii=False),
                extraction_method=raw_job.get("extraction_method") or "heuristic",
            )
            db.add(new_job)
            db.commit()
            db.refresh(new_job)

            saved_jobs_for_notify.append(new_job)
            if deep_status == "pending" and len(phase2_job_ids) < cfg.deep_crawl_max_items:
                phase2_job_ids.append(new_job.id)

        run_obj.total_found = len(all_extracted_raw_jobs)
        run_obj.new_jobs_saved = len(saved_jobs_for_notify)
        run_obj.duplicates_skipped = dup_count
        run_obj.blocked_by_filter = blocked_count
        run_obj.deep_crawl_total = len(phase2_job_ids)
        run_obj.status = "completed"
        run_obj.finished_at = utc_now()
        db.commit()

        # Dispatch notifications if enabled
        notify_msg = "Notifications skipped."
        if cfg.enable_notifications and saved_jobs_for_notify:
            notify_msg = await dispatch_new_jobs_notifications(saved_jobs_for_notify, settings)
            sink_logs.append(f"[Notify] {notify_msg}")

        update_node_log(
            db,
            crawl_run_id,
            "node_6_sink",
            status="success",
            duration_ms=int((time.time() - t6_start) * 1000),
            output_data={
                "total_found": len(all_extracted_raw_jobs),
                "new_jobs_saved": len(saved_jobs_for_notify),
                "duplicates_skipped": dup_count,
                "blocked_by_filter": blocked_count,
                "notification": notify_msg,
            },
            logs=[
                f"[Node 6] Saved {len(saved_jobs_for_notify)} new job(s), skipped {dup_count} duplicate(s), "
                f"blocked {blocked_count} blacklisted item(s)."
            ]
            + sink_logs[:25],
        )

        # =====================================================================
        # NODE 5: Launch Phase 2 Deep Crawl Queue asynchronously
        # =====================================================================
        if cfg.enable_deep_crawl and phase2_job_ids:
            update_node_log(
                db,
                crawl_run_id,
                "node_5_deep_queue",
                status="running",
                input_data={
                    "queued_job_ids": phase2_job_ids,
                    "delay_range_sec": [cfg.deep_crawl_delay_min, cfg.deep_crawl_delay_max],
                },
                logs=[
                    f"[Node 5] Queued {len(phase2_job_ids)} job(s) for background Phase 2 Deep Crawl (Full JD + HR Contacts)..."
                ],
            )
            asyncio.create_task(
                run_phase2_deep_crawl_queue(
                    crawl_run_id=crawl_run_id,
                    job_ids=phase2_job_ids,
                    bypass_mode=cfg.bypass_mode,
                    delay_min=cfg.deep_crawl_delay_min,
                    delay_max=cfg.deep_crawl_delay_max,
                    settings=settings,
                    proxies=active_proxies,
                )
            )
        else:
            update_node_log(
                db,
                crawl_run_id,
                "node_5_deep_queue",
                status="success" if not cfg.enable_deep_crawl else "skipped",
                duration_ms=10,
                output_data={"queued": 0, "reason": "Full JD already extracted in Phase 1 or no new jobs queued"},
                logs=["[Node 5] No additional background deep crawl required."],
            )

    except Exception as exc:
        logger.exception("Pipeline error for run %s", crawl_run_id)
        try:
            run_obj = db.query(CrawlRun).filter(CrawlRun.id == crawl_run_id).first()
            if run_obj:
                run_obj.status = "failed"
                run_obj.error_message = str(exc)
                run_obj.finished_at = utc_now()
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
