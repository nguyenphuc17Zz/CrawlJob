// Secure API Client: keeps CSRF token strictly in memory (never localStorage/sessionStorage)

let inMemoryCsrfToken = "";

export async function ensureCsrfSession(): Promise<string> {
  if (inMemoryCsrfToken) {
    return inMemoryCsrfToken;
  }
  const resp = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "include",
  });
  if (resp.ok) {
    const data = await resp.json();
    inMemoryCsrfToken = data.csrf_token || "";
  }
  return inMemoryCsrfToken;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = await ensureCsrfSession();
    headers["X-CSRF-Token"] = token;
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  let resp = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  // If CSRF expired, refresh once
  if (resp.status === 403 && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    inMemoryCsrfToken = "";
    const freshToken = await ensureCsrfSession();
    headers["X-CSRF-Token"] = freshToken;
    resp = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: "include",
    });
  }

  if (!resp.ok) {
    let errDetail = `HTTP ${resp.status}`;
    try {
      const errJson = await resp.json();
      if (errJson.detail) {
        errDetail = errJson.detail;
      }
    } catch {
      // ignore parse error
    }
    throw new Error(errDetail);
  }

  return resp.json();
}

export interface NodeConfig {
  enabled: boolean;
  bypass_mode: string;
  scroll_times: number;
  max_pages: number;
  enable_sniffer: boolean;
  enable_recipe_cache: boolean;
  enable_ai_fallback: boolean;
  enable_deep_crawl: boolean;
  deep_crawl_delay_min: number;
  deep_crawl_delay_max: number;
  deep_crawl_max_items: number;
  enable_filter_blacklist: boolean;
  enable_notifications: boolean;
  custom_ai_instruction: string;
}

export interface PipelineNodeTelemetry {
  node_id: string;
  node_name: string;
  status: "idle" | "running" | "success" | "warning" | "error" | "skipped";
  duration_ms: number;
  input_json: string;
  output_json: string;
  logs_text: string;
  screenshot_filename: string | null;
  markdown_preview: string | null;
  updated_at: string | null;
}

export interface JobItem {
  id: number;
  url: string;
  source_domain: string;
  crawl_run_id: number | null;
  deep_crawl_status: string;
  title: string;
  company_name: string;
  company_logo: string;
  location_city: string;
  work_mode: string;
  seniority: string;
  salary_raw: string;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string;
  salary_vnd_normalized: number;
  is_negotiable: boolean;
  skills: string[];
  summary: string;
  has_offline_jd: boolean;
  full_jd_markdown?: string;
  full_jd_html?: string;
  hr_name: string | null;
  hr_email: string | null;
  hr_phone: string | null;
  company_size: string | null;
  posted_at: string | null;
  deadline_at: string | null;
  status: string;
  is_highlighted: boolean;
  matched_keywords: string[];
  extraction_method: string;
  created_at: string | null;
  portal_name?: string;
  salary_bracket?: string;
  job_category?: string;
  jlpt_level?: string;
  quality_score?: number;
  quality_tier?: "S-Tier" | "A-Tier" | "B-Tier" | string;
  is_new_job?: boolean;
}
