import fs from "fs";
import path from "path";
import { Database } from "bun:sqlite";

const isCompiledExe = !path.basename(process.execPath).toLowerCase().startsWith("bun");
export const APP_BASE_DIR = isCompiledExe ? path.dirname(process.execPath) : process.cwd();
export const DATA_DIR = path.join(APP_BASE_DIR, "backend", "data");
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, "crawljob.db");
export const db = new Database(DB_PATH, { create: true });

// High-Performance SQLite Pragmas for Local-First Studio
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA temp_store = MEMORY;");
db.exec("PRAGMA mmap_size = 268435456;");
db.exec("PRAGMA busy_timeout = 5000;");

// ============================================================================
// 1. Database Schema & Composite Indexes
// ============================================================================
db.exec(`
CREATE TABLE IF NOT EXISTS job_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  url_hash TEXT NOT NULL,
  dedup_signature TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  crawl_run_id INTEGER,
  deep_crawl_status TEXT DEFAULT 'pending',
  title TEXT NOT NULL,
  company_name TEXT DEFAULT 'Unknown Company',
  company_logo TEXT DEFAULT '',
  location_city TEXT DEFAULT 'Vietnam',
  work_mode TEXT DEFAULT 'Onsite',
  seniority TEXT DEFAULT 'Mid-Level',
  salary_raw TEXT DEFAULT 'Thỏa thuận',
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT DEFAULT 'VND',
  salary_vnd_normalized REAL DEFAULT 0.0,
  is_negotiable INTEGER DEFAULT 1,
  skills_json TEXT DEFAULT '[]',
  summary TEXT DEFAULT '',
  full_jd_markdown TEXT DEFAULT '',
  full_jd_html TEXT DEFAULT '',
  hr_name TEXT,
  hr_email TEXT,
  hr_phone TEXT,
  apply_url TEXT,
  company_size TEXT,
  company_industry TEXT,
  company_rating TEXT,
  company_address TEXT,
  posted_at TEXT DEFAULT 'Mới đăng',
  deadline_at TEXT DEFAULT '',
  status TEXT DEFAULT 'new',
  is_highlighted INTEGER DEFAULT 0,
  matched_keywords_json TEXT DEFAULT '[]',
  extraction_method TEXT DEFAULT 'heuristic',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT DEFAULT 'single_url',
  input_summary TEXT NOT NULL,
  urls_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'running',
  bypass_tier_used TEXT DEFAULT '',
  extraction_layer_used TEXT DEFAULT '',
  total_found INTEGER DEFAULT 0,
  new_jobs_saved INTEGER DEFAULT 0,
  duplicates_skipped INTEGER DEFAULT 0,
  blocked_by_filter INTEGER DEFAULT 0,
  deep_crawl_total INTEGER DEFAULT 0,
  deep_crawl_completed INTEGER DEFAULT 0,
  node_configs_json TEXT DEFAULT '{}',
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_node_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crawl_run_id INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  node_name TEXT NOT NULL,
  status TEXT DEFAULT 'idle',
  duration_ms INTEGER DEFAULT 0,
  input_json TEXT DEFAULT '{}',
  output_json TEXT DEFAULT '{}',
  logs_text TEXT DEFAULT '',
  screenshot_filename TEXT,
  markdown_preview TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS domain_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT UNIQUE NOT NULL,
  recipe_name TEXT NOT NULL,
  card_selector TEXT NOT NULL,
  title_selector TEXT NOT NULL,
  company_selector TEXT DEFAULT '',
  salary_selector TEXT DEFAULT '',
  location_selector TEXT DEFAULT '',
  link_selector TEXT DEFAULT 'a',
  next_page_selector TEXT DEFAULT '',
  detail_jd_selector TEXT DEFAULT '',
  detail_skills_selector TEXT DEFAULT '',
  detail_hr_selector TEXT DEFAULT '',
  learned_by TEXT DEFAULT 'builtin',
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  last_healed_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS filter_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  note TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS saved_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url_or_keyword TEXT NOT NULL,
  source_type TEXT DEFAULT 'url',
  platforms_json TEXT DEFAULT '[]',
  cron_interval_minutes INTEGER DEFAULT 60,
  bypass_mode TEXT DEFAULT 'auto',
  deep_crawl_enabled INTEGER DEFAULT 1,
  max_pages INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  last_run_at TEXT,
  total_jobs_collected INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS proxy_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proxy_url TEXT UNIQUE NOT NULL,
  protocol TEXT DEFAULT 'http',
  label TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  fail_count INTEGER DEFAULT 0,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  is_secret INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS custom_portals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT 'CP',
  domain TEXT NOT NULL,
  region TEXT DEFAULT 'VN',
  search_url_template TEXT NOT NULL,
  sample_url TEXT DEFAULT '',
  bypass_mode TEXT DEFAULT 'auto',
  created_at TEXT
);

-- 7 Composite & Covering Indexes for Sub-Millisecond Lookups
CREATE INDEX IF NOT EXISTS idx_jobs_url_hash ON job_posts(url_hash);
CREATE INDEX IF NOT EXISTS idx_jobs_dedup_sig ON job_posts(dedup_signature);
CREATE INDEX IF NOT EXISTS idx_jobs_status_salary ON job_posts(status, salary_vnd_normalized DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_domain_status ON job_posts(source_domain, status);
CREATE INDEX IF NOT EXISTS idx_jobs_run_id ON job_posts(crawl_run_id);
CREATE INDEX IF NOT EXISTS idx_jobs_deep_status ON job_posts(deep_crawl_status);
CREATE INDEX IF NOT EXISTS idx_node_logs_run_node ON pipeline_node_logs(crawl_run_id, node_id);
`);

/**
 * Lightweight column projection for listing jobs without reading multi-MB
 * `full_jd_markdown` and `full_jd_html` blobs from disk on every table load.
 */
export const JOB_LIST_COLUMNS = `
  id, url, url_hash, dedup_signature, source_domain, crawl_run_id, deep_crawl_status,
  title, company_name, company_logo, location_city, work_mode, seniority,
  salary_raw, salary_min, salary_max, salary_currency, salary_vnd_normalized, is_negotiable,
  skills_json, summary,
  CASE WHEN LENGTH(full_jd_markdown) > 160 THEN 1 ELSE 0 END AS has_full_jd,
  hr_name, hr_email, hr_phone, apply_url, company_size, company_industry, company_rating, company_address,
  posted_at, deadline_at, status, is_highlighted, matched_keywords_json, extraction_method,
  created_at, updated_at
`;

export const SUPPORTED_PLATFORMS = [
  // Core Popular Portals
  { id: "itviec", name: "ITviec", region: "VN", domain: "itviec.com", group: "jp_excel" },
  { id: "topcv", name: "TopCV", region: "VN", domain: "topcv.vn", group: "jp_excel" },
  { id: "careerviet", name: "CareerViet", region: "VN", domain: "careerviet.vn", group: "jp_excel" },
  { id: "careerlink", name: "CareerLink", region: "VN", domain: "careerlink.vn", group: "jp_excel" },
  { id: "jobsgo", name: "JobsGO", region: "VN", domain: "jobsgo.vn", group: "jp_excel" },
  { id: "viecoi", name: "ViecOi", region: "VN", domain: "viecoi.vn", group: "jp_excel" },
  { id: "indeed", name: "Indeed VN", region: "VN", domain: "vn.indeed.com", group: "jp_excel" },
  { id: "linkedin", name: "LinkedIn VN", region: "Global", domain: "linkedin.com", group: "jp_excel" },
  { id: "joywork", name: "JoyWork", region: "VN", domain: "joywork.vn", group: "jp_excel" },
  { id: "cvwork", name: "CVWork", region: "VN", domain: "cvwork.vn", group: "jp_excel" },
  { id: "xemviec", name: "XemViec", region: "VN", domain: "xemviec.com", group: "jp_excel" },
  { id: "joboko", name: "Joboko", region: "VN", domain: "vn.joboko.com", group: "jp_excel" },
  // Extended & Major Multi-Industry Portals
  { id: "vietnamworks", name: "VietnamWorks", region: "VN", domain: "vietnamworks.com", group: "extended" },
  { id: "glints", name: "Glints VN", region: "VN", domain: "glints.com", group: "extended" },
  { id: "topdev", name: "TopDev", region: "VN", domain: "topdev.vn", group: "extended" },
  { id: "remoteok", name: "RemoteOK", region: "Global", domain: "remoteok.com", group: "extended" },
  { id: "vieclam24h", name: "Vieclam24h", region: "VN", domain: "vieclam24h.vn", group: "extended" },
  { id: "job123", name: "123Job", region: "VN", domain: "123job.vn", group: "extended" },
  { id: "devwork", name: "Devwork", region: "VN", domain: "devwork.vn", group: "extended" },
  { id: "iconicjob", name: "IconicJob", region: "VN", domain: "iconicjob.vn", group: "extended" },
];

export function getAllPlatforms() {
  const customRows = db.query("SELECT * FROM custom_portals ORDER BY created_at ASC").all() as any[];
  const customMapped = customRows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    code: String(r.code || "CP"),
    region: String(r.region || "VN"),
    domain: String(r.domain),
    group: "custom",
    search_url_template: String(r.search_url_template),
    sample_url: String(r.sample_url || ""),
    bypass_mode: String(r.bypass_mode || "auto"),
    is_custom: true,
  }));
  return [...SUPPORTED_PLATFORMS, ...customMapped];
}

export const SECRET_KEYS = new Set([
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
]);

export const DEFAULT_SETTINGS: Record<string, string> = {
  ai_provider: "gemini",
  ai_model: "gemini-2.5-flash",
  gemini_api_key: "",
  openai_api_key: "",
  groq_api_key: "",
  openrouter_api_key: "",
  ollama_base_url: "http://127.0.0.1:11434",
  flaresolverr_url: "http://127.0.0.1:8191/v1",
  chrome_cdp_url: "http://127.0.0.1:9222",
  capsolver_api_key: "",
  twocaptcha_api_key: "",
  custom_cookie_header: "",
  telegram_bot_token: "",
  telegram_chat_id: "",
  discord_webhook_url: "",
  sheets_webhook_url: "",
};

export function seedDatabase() {
  const nowIso = new Date().toISOString();
  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO app_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)"
  );
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(k, v, SECRET_KEYS.has(k) ? 1 : 0, nowIso);
  }

  // Remove deprecated portals that merged or retired
  db.prepare("DELETE FROM domain_recipes WHERE domain IN ('timviecnhanh.com', 'tuyendung.com.vn')").run();

  const builtinRecipes = [
    ["itviec.com", "ITviec (VN)", ".job-card, .ipy-2", "h3 a", ".ims-2 a", ".salary", ".city"],
    ["topcv.vn", "TopCV (VN)", ".job-item-search-result, .job-item-2", "h3.title a", "a.company", ".title-salary", ".address"],
    ["careerviet.vn", "CareerViet (VN)", ".job-item", ".title a", ".company-name", ".salary", ".location"],
    ["careerlink.vn", "CareerLink (VN)", ".job-item", ".job-link, h5 a", ".job-company", ".job-salary", ".job-location"],
    ["jobsgo.vn", "JobsGO (VN)", ".job-item, .item-job", "h3 a, .job-title a", ".company-title, .company-name", ".salary", ".location"],
    ["viecoi.vn", "ViecOi (VN)", ".jobs-item, .job-item", "h3 a, .title-job a", ".company-name", ".salary", ".location"],
    ["vn.indeed.com", "Indeed VN", ".job_seen_beacon, .resultContent", "h2.jobTitle a", "[data-testid='company-name']", ".salary-snippet-container", "[data-testid='text-location']"],
    ["linkedin.com", "LinkedIn VN", ".base-card, .job-search-card", ".base-search-card__title", ".base-search-card__subtitle", ".job-search-card__salary-info", ".job-search-card__location"],
    ["joywork.vn", "JoyWork (VN)", ".job-card, .job-item, a[href*='/jobs/']", "h3, .job-title", ".company-name", ".salary", ".location"],
    ["cvwork.vn", "CVWork (VN)", ".job-item, .job-card", "h3 a, .job-title", ".company-name", ".salary", ".location"],
    ["xemviec.com", "XemViec (VN)", ".job-item, article", "h3 a, a[href*='/viec-lam/']", ".company", ".salary", ".location"],
    ["vn.joboko.com", "Joboko (VN)", ".item-job, .job-item", "h3 a, a[href*='/viec-lam-']", ".company, .comp-name", ".salary", ".address"],
    ["vietnamworks.com", "VietnamWorks", ".job-item, .sc-job-card", "h3 a, a.job-title", ".company-name", ".salary", ".location"],
    ["glints.com", "Glints VN", ".job-card, [class*='JobCard']", "h3 a, a[href*='/opportunities/jobs/']", "[class*='Company']", "[class*='Salary']", "[class*='Location']"],
    ["topdev.vn", "TopDev (VN)", "li.mb-4, .job-item", "h3 a, a[href*='/detail-jobs/']", "a.text-gray-600, .company", ".text-primary, .salary", ".text-gray-500"],
    ["remoteok.com", "RemoteOK Board", "tr.job", "h2[itemprop='title']", "h3[itemprop='name']", ".location", ".location"],
    ["vieclam24h.vn", "Vieclam24h (VN)", "a[href*='-c'][href*='p'][href*='id'], .job-item, .relative.border", "h3, h2, .font-semibold", ".text-se-neutral-64, .company-name", ".text-se-accent, .salary", ".location, .text-se-neutral-80"],
    ["123job.vn", "123Job (VN)", ".job__list-item, .job-item", ".job__list-item-title a, h2 a, h3 a", ".job__list-item-company, .company-name", ".job__list-item-salary, .salary", ".address, .location"],
    ["devwork.vn", "Devwork (VN)", "div.listing", "h4", ".company-name, .company", ".salaryVip, .salaryPrenium, .salaryBasic", ".location"],
    ["iconicjob.vn", "IconicJob (VN)", ".js-job-result-item, .job", "a.job-title, h3 a", ".company-name, .company", ".salary-desc, .salary", ".location-desc, .location"],
  ];
  const insRec = db.prepare(
    `INSERT INTO domain_recipes
     (domain, recipe_name, card_selector, title_selector, company_selector, salary_selector, location_selector, link_selector, learned_by, last_healed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'a', 'builtin', ?, ?)
     ON CONFLICT(domain) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       card_selector = excluded.card_selector,
       title_selector = excluded.title_selector,
       company_selector = excluded.company_selector,
       salary_selector = excluded.salary_selector,
       location_selector = excluded.location_selector,
       updated_at = excluded.updated_at
     WHERE domain_recipes.learned_by = 'builtin'`
  );
  for (const r of builtinRecipes) {
    insRec.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], nowIso, nowIso);
  }
}
