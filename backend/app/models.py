from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobPost(Base):
    __tablename__ = "job_posts"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String(2048), unique=True, nullable=False, index=True)
    url_hash = Column(String(64), nullable=False, index=True)
    dedup_signature = Column(String(128), nullable=False, index=True)

    source_domain = Column(String(255), nullable=False, index=True)
    crawl_run_id = Column(Integer, ForeignKey("crawl_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    deep_crawl_status = Column(String(32), default="pending", index=True)  # pending, running, completed, skipped, failed

    title = Column(String(512), nullable=False, index=True)
    company_name = Column(String(512), nullable=False, default="Unknown Company", index=True)
    company_logo = Column(String(2048), nullable=True)

    location_city = Column(String(255), nullable=False, default="Vietnam", index=True)
    work_mode = Column(String(64), nullable=False, default="Onsite", index=True)  # Remote, Hybrid, Onsite
    seniority = Column(String(64), nullable=False, default="Mid-Level", index=True)

    salary_raw = Column(String(255), nullable=False, default="Thỏa thuận")
    salary_min = Column(Float, nullable=True)
    salary_max = Column(Float, nullable=True)
    salary_currency = Column(String(16), nullable=False, default="VND")
    salary_vnd_normalized = Column(Float, nullable=False, default=0.0, index=True)  # Million VND/month for uniform sorting
    is_negotiable = Column(Boolean, default=True)

    skills_json = Column(Text, nullable=False, default="[]")
    summary = Column(Text, nullable=True)
    full_jd_markdown = Column(Text, nullable=True)
    full_jd_html = Column(Text, nullable=True)

    hr_name = Column(String(255), nullable=True)
    hr_email = Column(String(255), nullable=True)
    hr_phone = Column(String(128), nullable=True)
    apply_url = Column(String(2048), nullable=True)

    company_size = Column(String(128), nullable=True)
    company_industry = Column(String(255), nullable=True)
    company_rating = Column(String(64), nullable=True)
    company_address = Column(String(512), nullable=True)

    posted_at = Column(String(128), nullable=True)
    deadline_at = Column(String(128), nullable=True)

    status = Column(String(64), nullable=False, default="new", index=True)  # new, saved, applied, interviewing, hidden
    is_highlighted = Column(Boolean, default=False)
    matched_keywords_json = Column(Text, nullable=False, default="[]")
    extraction_method = Column(String(64), nullable=False, default="heuristic")

    created_at = Column(DateTime, default=utc_now, index=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class CrawlRun(Base):
    __tablename__ = "crawl_runs"

    id = Column(Integer, primary_key=True, index=True)
    mode = Column(String(64), nullable=False, default="single_url")  # single_url, bulk_urls, keyword_search, cron
    input_summary = Column(String(1024), nullable=False)
    urls_json = Column(Text, nullable=False, default="[]")
    status = Column(String(64), nullable=False, default="running", index=True)  # running, completed, failed

    bypass_tier_used = Column(String(128), nullable=True)
    extraction_layer_used = Column(String(128), nullable=True)

    total_found = Column(Integer, default=0)
    new_jobs_saved = Column(Integer, default=0)
    duplicates_skipped = Column(Integer, default=0)
    blocked_by_filter = Column(Integer, default=0)

    deep_crawl_total = Column(Integer, default=0)
    deep_crawl_completed = Column(Integer, default=0)

    node_configs_json = Column(Text, nullable=False, default="{}")
    error_message = Column(Text, nullable=True)

    started_at = Column(DateTime, default=utc_now)
    finished_at = Column(DateTime, nullable=True)


class PipelineNodeLog(Base):
    __tablename__ = "pipeline_node_logs"

    id = Column(Integer, primary_key=True, index=True)
    crawl_run_id = Column(Integer, ForeignKey("crawl_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    node_id = Column(String(64), nullable=False, index=True)
    node_name = Column(String(128), nullable=False)
    status = Column(String(32), nullable=False, default="idle")  # idle, running, success, warning, error, skipped
    duration_ms = Column(Integer, default=0)

    input_json = Column(Text, nullable=False, default="{}")
    output_json = Column(Text, nullable=False, default="{}")
    logs_text = Column(Text, nullable=False, default="")
    screenshot_filename = Column(String(255), nullable=True)
    markdown_preview = Column(Text, nullable=True)

    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class DomainRecipe(Base):
    __tablename__ = "domain_recipes"

    id = Column(Integer, primary_key=True, index=True)
    domain = Column(String(255), unique=True, nullable=False, index=True)
    recipe_name = Column(String(255), nullable=False)

    card_selector = Column(String(512), nullable=False)
    title_selector = Column(String(512), nullable=False)
    company_selector = Column(String(512), nullable=True)
    salary_selector = Column(String(512), nullable=True)
    location_selector = Column(String(512), nullable=True)
    link_selector = Column(String(512), nullable=True)
    next_page_selector = Column(String(512), nullable=True)

    detail_jd_selector = Column(String(512), nullable=True)
    detail_skills_selector = Column(String(512), nullable=True)
    detail_hr_selector = Column(String(512), nullable=True)

    learned_by = Column(String(64), default="ai")  # builtin, ai, manual
    success_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    last_healed_at = Column(DateTime, default=utc_now)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class FilterRule(Base):
    __tablename__ = "filter_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_type = Column(String(64), nullable=False, index=True)  # company_blacklist, keyword_exclude, keyword_whitelist
    pattern = Column(String(512), nullable=False)
    note = Column(String(512), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now)


class SavedSource(Base):
    __tablename__ = "saved_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    url_or_keyword = Column(String(2048), nullable=False)
    source_type = Column(String(32), default="url")  # url, keyword
    platforms_json = Column(Text, default="[]")
    cron_interval_minutes = Column(Integer, default=60)
    bypass_mode = Column(String(64), default="auto")
    deep_crawl_enabled = Column(Boolean, default=True)
    max_pages = Column(Integer, default=1)
    is_active = Column(Boolean, default=True)

    last_run_at = Column(DateTime, nullable=True)
    total_jobs_collected = Column(Integer, default=0)
    created_at = Column(DateTime, default=utc_now)


class ProxyServer(Base):
    __tablename__ = "proxy_servers"

    id = Column(Integer, primary_key=True, index=True)
    proxy_url = Column(String(1024), unique=True, nullable=False)
    protocol = Column(String(32), default="http")
    label = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    fail_count = Column(Integer, default=0)
    last_used_at = Column(DateTime, nullable=True)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key = Column(String(128), primary_key=True, index=True)
    value = Column(Text, nullable=False, default="")
    is_secret = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)
