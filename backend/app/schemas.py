from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NodeConfigOverride(BaseModel):
    enabled: bool = True
    bypass_mode: str = "auto"  # auto, fast_tls, stealth_browser, chrome_cdp, flaresolverr
    scroll_times: int = Field(default=3, ge=0, le=20)
    max_pages: int = Field(default=1, ge=1, le=10)
    enable_sniffer: bool = True
    enable_recipe_cache: bool = True
    enable_ai_fallback: bool = True
    enable_deep_crawl: bool = True
    deep_crawl_delay_min: float = Field(default=1.5, ge=0.5, le=30.0)
    deep_crawl_delay_max: float = Field(default=3.5, ge=0.5, le=60.0)
    deep_crawl_max_items: int = Field(default=15, ge=1, le=100)
    enable_filter_blacklist: bool = True
    enable_notifications: bool = True
    custom_ai_instruction: Optional[str] = Field(default="", max_length=1000)


class StartCrawlRequest(BaseModel):
    mode: str = Field(default="single_url", pattern="^(single_url|bulk_urls|keyword_search)$")
    urls: List[str] = Field(default_factory=list, max_length=50)
    keyword: Optional[str] = Field(default="", max_length=255)
    location: Optional[str] = Field(default="", max_length=128)
    platforms: List[str] = Field(default_factory=list)
    node_config: NodeConfigOverride = Field(default_factory=NodeConfigOverride)


class FilterRuleCreate(BaseModel):
    rule_type: str = Field(..., pattern="^(company_blacklist|keyword_exclude|keyword_whitelist)$")
    pattern: str = Field(..., min_length=1, max_length=512)
    note: Optional[str] = Field(default="", max_length=512)


class DomainRecipeCreate(BaseModel):
    domain: str = Field(..., min_length=3, max_length=255)
    recipe_name: str = Field(..., min_length=2, max_length=255)
    card_selector: str = Field(..., min_length=1, max_length=512)
    title_selector: str = Field(..., min_length=1, max_length=512)
    company_selector: Optional[str] = Field(default="", max_length=512)
    salary_selector: Optional[str] = Field(default="", max_length=512)
    location_selector: Optional[str] = Field(default="", max_length=512)
    link_selector: Optional[str] = Field(default="a", max_length=512)
    next_page_selector: Optional[str] = Field(default="", max_length=512)
    detail_jd_selector: Optional[str] = Field(default="", max_length=512)
    detail_skills_selector: Optional[str] = Field(default="", max_length=512)
    detail_hr_selector: Optional[str] = Field(default="", max_length=512)


class SavedSourceCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    url_or_keyword: str = Field(..., min_length=2, max_length=2048)
    source_type: str = Field(default="url", pattern="^(url|keyword)$")
    platforms: List[str] = Field(default_factory=list)
    cron_interval_minutes: int = Field(default=60, ge=5, le=10080)
    bypass_mode: str = Field(default="auto")
    deep_crawl_enabled: bool = True
    max_pages: int = Field(default=1, ge=1, le=10)


class ProxyServerCreate(BaseModel):
    proxy_url: str = Field(..., min_length=7, max_length=1024)
    protocol: str = Field(default="http", pattern="^(http|https|socks5)$")
    label: Optional[str] = Field(default="", max_length=255)


class SettingsUpdateRequest(BaseModel):
    settings: Dict[str, str]


class JobStatusUpdateRequest(BaseModel):
    status: str = Field(..., pattern="^(new|saved|applied|interviewing|hidden)$")
