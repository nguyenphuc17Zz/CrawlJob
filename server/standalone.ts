import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import {
  db,
  SCREENSHOTS_DIR,
  JOB_LIST_COLUMNS,
  SECRET_KEYS,
  getAllPlatforms,
  seedDatabase,
} from "./db/schema";
import {
  createSseResponse,
  broadcastSseEvent,
  registerRunController,
  isRunCancelled,
  cancelRunById,
  cancelAllActiveRuns,
  cleanupRunController,
} from "./events/sseHub";
import {
  buildMultiSheetXlsxBuffer,
  buildUtf8BomCsvString,
} from "./exporters/xlsxExporter";
import {
  initStaticAssetCache,
  getDecodedStaticAsset,
  pruneOldRunsAndScreenshots,
  touchChromeActivity,
  startMaintenanceWatchdog,
} from "./maintenance/hygiene";

process.on("uncaughtException", (err) => {
  console.error("[CrawlJob Studio] Uncaught Exception Guard:", err?.message || err);
});
process.on("unhandledRejection", (reason: any) => {
  console.error("[CrawlJob Studio] Unhandled Rejection Guard:", reason?.message || reason);
});

function toAsciiSlug(text: string): string {
  const clean = (text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, "-");
  return clean || "viec-lam";
}

function learnSearchUrlTemplate(rawInputUrl: string, sampleKeyword = "") {
  const trimmed = (rawInputUrl || "").trim();
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Temporarily replace placeholders before URL validation
  const tempValid = withProto
    .replace(/\{\{keyword\}\}/gi, "keyword_placeholder")
    .replace(/\{\{slug\}\}/gi, "slug-placeholder")
    .replace(/\{\{location\}\}/gi, "location_placeholder");
  const safeUrl = validateTargetUrl(tempValid);
  const parsed = new URL(safeUrl);
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const baseParts = domain.split(".");
  const mainToken = baseParts[0] === "careers" || baseParts[0] === "career" || baseParts[0] === "jobs" || baseParts[0] === "vn"
    ? baseParts[1] || baseParts[0]
    : baseParts[0];
  const suggestedName = mainToken.charAt(0).toUpperCase() + mainToken.slice(1);
  const suggestedCode = mainToken.slice(0, 2).toUpperCase() || "CP";

  // Restore explicit placeholders if user already typed {{keyword}} or {{slug}}
  if (/\{\{(?:keyword|slug)\}\}/i.test(withProto)) {
    return {
      template: withProto,
      domain,
      suggestedName,
      suggestedCode,
      hasDynamicPlaceholder: true,
    };
  }

  // 1. Check common search query parameter keys
  const searchQueryKeys = [
    "q",
    "keyword",
    "keywords",
    "k",
    "s",
    "search",
    "query",
    "key",
    "tu-khoa",
    "tukhoa",
    "key_word",
    "job",
    "title",
    "position",
  ];
  let matchedQueryKey = "";
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (searchQueryKeys.includes(key.toLowerCase())) {
      matchedQueryKey = key;
      break;
    }
  }

  if (matchedQueryKey) {
    const uClone = new URL(safeUrl);
    uClone.searchParams.set(matchedQueryKey, "__KW_PLACEHOLDER__");
    const tpl = uClone.toString().replace("__KW_PLACEHOLDER__", "{{keyword}}");
    return {
      template: tpl,
      domain,
      suggestedName,
      suggestedCode,
      hasDynamicPlaceholder: true,
    };
  }

  // 2. Check if pathname contains common slug search patterns
  const pathPatterns: Array<[RegExp, string]> = [
    [/(\/tim-viec-lam-)([^\/?#\.]+)(\.html)?/i, "$1{{slug}}$3"],
    [/(\/viec-lam-)([^\/?#\.]+)(\.html)?/i, "$1{{slug}}$3"],
    [/(\/tim-viec\/)([^\/?#\.]+)(\.html)?/i, "$1{{slug}}$3"],
    [/(\/viec-lam\/k\/)([^\/?#]+)/i, "$1{{keyword}}"],
    [/(\/it-jobs\/)([^\/?#]+)/i, "$1{{slug}}"],
  ];
  for (const [re, rep] of pathPatterns) {
    if (re.test(parsed.pathname)) {
      const newPath = parsed.pathname.replace(re, rep);
      const tpl = `${parsed.origin}${newPath}${parsed.search}`;
      return {
        template: tpl,
        domain,
        suggestedName,
        suggestedCode,
        hasDynamicPlaceholder: true,
      };
    }
  }

  // 3. Check if sampleKeyword or its slug appears in query or pathname
  if (sampleKeyword.trim().length >= 2) {
    const kwSlug = toAsciiSlug(sampleKeyword);
    if (kwSlug.length >= 3 && parsed.pathname.toLowerCase().includes(kwSlug)) {
      const idx = parsed.pathname.toLowerCase().indexOf(kwSlug);
      const newPath =
        parsed.pathname.slice(0, idx) +
        "{{slug}}" +
        parsed.pathname.slice(idx + kwSlug.length);
      return {
        template: `${parsed.origin}${newPath}${parsed.search}`,
        domain,
        suggestedName,
        suggestedCode,
        hasDynamicPlaceholder: true,
      };
    }
  }

  // 4. If only root domain was provided (e.g. https://123job.vn/), default to ?q={{keyword}}
  if ((parsed.pathname === "/" || parsed.pathname === "") && !parsed.search) {
    return {
      template: `${parsed.origin}/?q={{keyword}}`,
      domain,
      suggestedName,
      suggestedCode,
      hasDynamicPlaceholder: true,
    };
  }

  // 5. Direct listing page URL (e.g. https://careers.fpt-software.com/jobs or https://123job.vn/tuyen-dung)
  return {
    template: safeUrl,
    domain,
    suggestedName,
    suggestedCode,
    hasDynamicPlaceholder: false,
  };
}

function resolveUrlTemplate(template: string, keyword: string, location = "Vietnam"): string {
  const kwClean = (keyword || "viec-lam").trim();
  const locClean = (location || "Vietnam").trim();
  const slug = toAsciiSlug(kwClean);
  const kwEnc = encodeURIComponent(kwClean);
  const locEnc = encodeURIComponent(locClean);
  const remoteSlug =
    slug === "tieng-nhat" || slug === "nhat-ban" ? "japanese" : slug;

  return template
    .replace(/\{\{keyword\}\}/gi, kwEnc)
    .replace(/\{\{slug\}\}/gi, slug)
    .replace(/\{\{remote_slug\}\}/gi, remoteSlug)
    .replace(/\{\{location\}\}/gi, locEnc);
}

function buildPlatformSearchUrl(platformId: string, keyword: string, location = "Vietnam"): string {
  const kwClean = (keyword || "viec-lam").trim();
  const locClean = (location || "Vietnam").trim();
  const slug = toAsciiSlug(kwClean);
  const kwEnc = encodeURIComponent(kwClean);
  const locEnc = encodeURIComponent(locClean);
  const remoteSlug =
    slug === "tieng-nhat" || slug === "nhat-ban" ? "japanese" : slug;
  const vnNativeKwEnc =
    slug === "japanese" || slug === "japan"
      ? encodeURIComponent("tiếng nhật")
      : kwEnc;

  const map: Record<string, string> = {
    itviec: `https://itviec.com/it-jobs/${remoteSlug}`,
    topcv: `https://www.topcv.vn/tim-viec-lam-${slug}`,
    careerviet: `https://careerviet.vn/viec-lam/${slug}-k-vi.html`,
    careerlink: `https://www.careerlink.vn/viec-lam/k/${kwEnc}`,
    jobsgo: `https://jobsgo.vn/viec-lam-${slug}.html`,
    viecoi: `https://viecoi.vn/tim-viec/${slug}.html`,
    indeed: `https://vn.indeed.com/jobs?q=${kwEnc}&l=${locEnc}`,
    linkedin: `https://www.linkedin.com/jobs/search?keywords=${kwEnc}&location=${locEnc}`,
    joywork: `https://joywork.vn/jobs?q=${vnNativeKwEnc}`,
    cvwork: `https://cvwork.vn/viec-lam?q=${kwEnc}`,
    xemviec: `https://xemviec.com/viec-lam?q=${kwEnc}`,
    joboko: `https://vn.joboko.com/tim-viec-lam-${slug}`,
    vietnamworks: `https://www.vietnamworks.com/viec-lam?q=${kwEnc}`,
    glints: `https://glints.com/vn/opportunities/jobs/explore?keyword=${kwEnc}`,
    topdev: `https://topdev.vn/jobs/search?keyword=${kwEnc}`,
    remoteok: `https://remoteok.com/remote-${remoteSlug}-jobs`,
    vieclam24h: `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${kwEnc}`,
    job123: `https://123job.vn/tuyen-dung?q=${kwEnc}`,
    devwork: `https://devwork.vn/viec-lam?keyword=${vnNativeKwEnc}`,
    iconicjob: `https://iconicjob.vn/viec-lam/tim-viec-lam?kw=${vnNativeKwEnc}`,
  };
  if (map[platformId]) return map[platformId];

  // Check custom_portals in SQLite
  const customRow = db
    .query("SELECT search_url_template FROM custom_portals WHERE id = ? OR domain = ? LIMIT 1")
    .get(platformId, platformId) as any;
  if (customRow && customRow.search_url_template) {
    return resolveUrlTemplate(String(customRow.search_url_template), kwClean, locClean);
  }

  return `https://www.topcv.vn/tim-viec-lam-${slug}`;
}

seedDatabase();

// ============================================================================
// 2. Security Helpers (CSRF, SSRF Guard, Secret Masking)
// ============================================================================
const APP_SECRET = crypto.randomBytes(32).toString("hex");

function generateCsrfToken(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = Math.floor(Date.now() / 1000).toString();
  const payload = `${nonce}.${ts}`;
  const sig = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyCsrfToken(token: string | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [nonce, tsStr, sig] = parts;
  const expected = crypto
    .createHmac("sha256", APP_SECRET)
    .update(`${nonce}.${tsStr}`)
    .digest("hex");
  return sig === expected;
}

function maskSecret(val: string | null | undefined): string {
  if (!val) return "";
  const trimmed = val.trim();
  if (trimmed.length <= 6) return "****";
  return `****${trimmed.slice(-4)}`;
}

function validateTargetUrl(rawUrl: string): string {
  const cleaned = (rawUrl || "").trim();
  if (!cleaned) throw new Error("URL không được để trống.");
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error(`URL không hợp lệ: ${cleaned}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Chỉ cho phép giao thức http:// hoặc https://");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.")
  ) {
    throw new Error("SSRF Guard: Chặn truy cập địa chỉ nội bộ.");
  }
  return parsed.toString();
}

// ============================================================================
// 3. Normalizer, Cleaner & Universal Extraction Helpers
// ============================================================================
const KNOWN_SKILLS = [
  "Python", "JavaScript", "TypeScript", "React", "Next.js", "Vue.js", "Angular", "Node.js",
  "FastAPI", "Django", "Flask", "Spring Boot", "Java", "C#", ".NET", "Golang", "Go", "Rust",
  "PHP", "Laravel", "C++", "Swift", "Kotlin", "Flutter", "React Native", "SQL", "PostgreSQL",
  "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka", "AWS", "Azure", "GCP", "Docker",
  "Kubernetes", "Terraform", "CI/CD", "Linux", "GraphQL", "REST API", "Microservices",
  "Playwright", "PyTorch", "TensorFlow", "LLM", "RAG", "LangChain", "Machine Learning",
  "Data Science", "Power BI", "Figma", "UI/UX", "Scrum", "Agile", "QA/QC", "DevOps",
];

function normalizeSalary(rawSalary: string | undefined | null) {
  const text = (rawSalary || "Thỏa thuận").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const isUsd = text.includes("$") || lower.includes("usd");
  const currency = isUsd ? "USD" : "VND";

  const cleanedNums = text.replace(/(\d)[,\.](\d{3})\b/g, "$1$2").replace(/(\d)[,\.](\d{3})\b/g, "$1$2");
  const matches = cleanedNums.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) {
    return {
      salary_raw: text || "Thỏa thuận",
      salary_min: null,
      salary_max: null,
      salary_currency: currency,
      salary_vnd_normalized: 0.0,
      is_negotiable: 1,
    };
  }

  let nums = matches.map((n) => parseFloat(n));
  if (isUsd && Math.max(...nums) >= 25000) {
    nums = nums.map((n) => Math.round(n / 12));
  }
  if (!isUsd) {
    nums = nums.map((n) => (n >= 1_000_000 ? +(n / 1_000_000).toFixed(2) : n));
  }

  const sMin = nums.length >= 2 ? Math.min(nums[0], nums[1]) : nums[0];
  const sMax = nums.length >= 2 ? Math.max(nums[0], nums[1]) : nums[0];
  const vndNorm = +(sMax * (isUsd ? 0.0254 : 1.0)).toFixed(2);

  return {
    salary_raw: text,
    salary_min: sMin,
    salary_max: sMax,
    salary_currency: currency,
    salary_vnd_normalized: vndNorm,
    is_negotiable: 0,
  };
}

function extractSkills(text: string, initial: string[] = []): string[] {
  const out = [...initial];
  const seen = new Set(out.map((s) => s.toLowerCase()));
  for (const sk of KNOWN_SKILLS) {
    if (seen.has(sk.toLowerCase())) continue;
    const escaped = sk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, "i");
    if (re.test(text)) {
      out.push(sk);
      seen.add(sk.toLowerCase());
      if (out.length >= 14) break;
    }
  }
  return out;
}

function extractHrContacts(text: string) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10}/g) || [];
  const validEmails = emailMatch.filter(
    (e) => !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(e) && !e.includes("sentry.io")
  );
  const phoneMatch = text.match(/((?:\+84|0)(?:3|5|7|8|9|2)[0-9]{1,2}[\s\.\-]?[0-9]{3,4}[\s\.\-]?[0-9]{3,4})\b/);
  const hrNameMatch = text.match(/\b((?:Ms|Mr|Mrs|Chị|Anh)\.?\s+[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)?)\b/);
  const sizeMatch = text.match(/(\d{1,5}\s*[-–]\s*\d{1,5}\s*(?:nhân viên|employees|people))/i);
  return {
    hr_email: validEmails[0] || null,
    hr_phone: phoneMatch ? phoneMatch[1].trim() : null,
    hr_name: hrNameMatch ? hrNameMatch[1].trim() : null,
    company_size: sizeMatch ? sizeMatch[1].trim() : null,
  };
}

function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&bull;|&middot;/gi, "•")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

function extractJobPostingLdObject(rawHtml: string): any | null {
  if (!rawHtml || !rawHtml.includes("application/ld+json")) return null;
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  let bestJobPosting: any = null;

  const findJobPosting = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(findJobPosting);
      return;
    }
    const t = node["@type"];
    const isJob =
      t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
    if (isJob && (node.description || node.jobBenefits || node.responsibilities)) {
      if (
        !bestJobPosting ||
        String(node.description || "").length > String(bestJobPosting.description || "").length
      ) {
        bestJobPosting = node;
      }
    }
    Object.values(node).forEach(findJobPosting);
  };

  while ((match = ldRegex.exec(rawHtml)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      findJobPosting(parsed);
    } catch {
      // ignore malformed JSON-LD block
    }
  }
  return bestJobPosting;
}

function isolateMainJdHtml(rawHtml: string): string {
  if (!rawHtml) return "";
  // If it's already a fragment (e.g., from API / JSON-LD description), return decoded HTML if double-escaped
  if (!/<html|<body/i.test(rawHtml)) {
    return rawHtml.includes("&lt;") ? decodeHtmlEntities(rawHtml) : rawHtml;
  }

  // 1. Check structured JSON-LD @type="JobPosting" first (TopCV, CareerViet, CareerLink, XemViec, Joboko, TopDev)
  const ldJob = extractJobPostingLdObject(rawHtml);
  if (ldJob) {
    const parts: string[] = [];
    if (ldJob.description && String(ldJob.description).trim().length > 40) {
      const descHtml = decodeHtmlEntities(String(ldJob.description));
      parts.push(
        /mô tả công việc|job description/i.test(descHtml)
          ? descHtml
          : `<h2>Mô tả công việc</h2>\n${descHtml}`
      );
    }
    if (typeof ldJob.experienceRequirements === "string" && ldJob.experienceRequirements.trim().length > 10) {
      parts.push(`<h2>Yêu cầu ứng viên</h2>\n${decodeHtmlEntities(ldJob.experienceRequirements)}`);
    } else if (
      ldJob.experienceRequirements &&
      typeof ldJob.experienceRequirements === "object" &&
      ldJob.experienceRequirements.monthsOfExperience
    ) {
      const months = Number(ldJob.experienceRequirements.monthsOfExperience) || 0;
      if (months > 0) {
        parts.push(`<h2>Yêu cầu kinh nghiệm</h2>\n<p>Tối thiểu ${months} tháng kinh nghiệm liên quan.</p>`);
      }
    }
    if (ldJob.skills) {
      const skStr = Array.isArray(ldJob.skills) ? ldJob.skills.join(", ") : String(ldJob.skills);
      if (skStr.trim().length > 2) {
        parts.push(`<h2>Kỹ năng chuyên môn</h2>\n<p>${decodeHtmlEntities(skStr)}</p>`);
      }
    }
    if (ldJob.jobBenefits) {
      const benHtml = Array.isArray(ldJob.jobBenefits)
        ? `<ul>${ldJob.jobBenefits.map((b: any) => `<li>${decodeHtmlEntities(String(b))}</li>`).join("")}</ul>`
        : decodeHtmlEntities(String(ldJob.jobBenefits));
      if (benHtml.trim().length > 10) {
        parts.push(
          /quyền lợi|phúc lợi|benefits/i.test(benHtml)
            ? benHtml
            : `<h2>Quyền lợi được hưởng</h2>\n${benHtml}`
        );
      }
    }
    const combinedLd = parts.join("\n\n").trim();
    if (combinedLd.length > 120) {
      return combinedLd;
    }
  }

  // 2. Check __NEXT_DATA__ hydrated state for SPA detail pages (Glints, VietnamWorks, ITviec)
  const nextMatch = rawHtml.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch && nextMatch[1]) {
    try {
      const nextJson = JSON.parse(nextMatch[1].trim());
      let bestDesc = "";
      const walk = (n: any) => {
        if (!n || typeof n !== "object") return;
        if (Array.isArray(n)) {
          n.forEach(walk);
          return;
        }
        const cand = [
          n.jobDescription,
          n.description,
          n.jobRequirement,
          n.requirements,
          n.benefits,
        ]
          .filter((x) => typeof x === "string" && x.length > 60)
          .join("\n\n");
        if (cand.length > bestDesc.length) bestDesc = cand;
        Object.values(n).forEach(walk);
      };
      walk(nextJson);
      if (bestDesc.length > 160) return bestDesc;
    } catch {
      // ignore
    }
  }

  // 3. Collect all TopCV / portal .job-description__item blocks if present
  const itemBlocks = [
    ...rawHtml.matchAll(
      /<div[^>]+class=["'][^"']*(?:job-description__item|job-detail__information-detail--content|detail-row|box-info-job)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
    ),
  ];
  if (itemBlocks.length > 0) {
    const joined = itemBlocks.map((m) => m[1]).join("\n\n");
    if (joined.length > 200) return joined;
  }

  // 4. Isolate main article / main container without premature inner </div> cutoff
  const containerPatterns = [
    /<div[^>]+id=["']jobDescriptionText["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    /<div[^>]+class=["'][^"']*(?:show-more-less-html__markup|description__text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const pat of containerPatterns) {
    const m = rawHtml.match(pat);
    if (m && m[1] && m[1].length > 300) {
      return m[1];
    }
  }
  return rawHtml;
}

const JD_SECTION_HEADER_REGEX =
  /^(mô tả công việc|chi tiết công việc|nội dung công việc|trách nhiệm công việc|job description|what you will do|responsibilities|key responsibilities|yêu cầu ứng viên|yêu cầu công việc|yêu cầu chuyên môn|tiêu chí tuyển dụng|job requirements|requirements|qualifications|what we look for|your skills and experience|quyền lợi|quyền lợi được hưởng|chế độ đãi ngộ|phúc lợi|why you'll love working here|benefits|compensation & benefits|perks|địa điểm làm việc|thời gian làm việc|thông tin khác|cách thức ứng tuyển|hồ sơ bao gồm)[:\s\-–]*$/i;

const NOISE_LINE_REGEX =
  /^(đăng nhập|đăng ký|ứng tuyển ngay|nộp hồ sơ|lưu tin|chia sẻ|báo cáo tin|việc làm tương tự|việc làm liên quan|tìm việc làm|tạo cv|cẩm nang nghề nghiệp|tính lương gross|bảo hiểm xã hội|trang chủ|về chúng tôi|liên hệ|điều khoản sử dụng|chính sách bảo mật|bản quyền thuộc về|copyright ©|all rights reserved|xem thêm|thu gọn|follow us|hotline hỗ trợ)$/i;

export function htmlToCleanMarkdown(html: string, _baseUrl: string): string {
  if (!html) return "";
  let cleaned = isolateMainJdHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<button[\s\S]*?<\/button>/gi, "")
    .replace(/<select[\s\S]*?<\/select>/gi, "");

  // Convert line breaks and block endings
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|ul|ol)>/gi, "\n");

  // Convert headings h1-h4
  cleaned = cleaned.replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!txt || txt.length > 140) return `\n${txt}\n`;
    const hashes = "#".repeat(Math.min(3, Math.max(2, Number(lvl))));
    return `\n${hashes} ${txt}\n`;
  });

  // Convert bold standalone blocks that act as section headings
  cleaned = cleaned.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (JD_SECTION_HEADER_REGEX.test(txt)) {
      return `\n## ${txt.replace(/[:\-–]+$/, "").trim()}\n`;
    }
    return ` ${txt} `;
  });

  // Convert list items
  cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return txt ? `\n- ${txt}` : "";
  });

  // Keep clean anchor text without polluting JD with raw [text](https://...) URLs
  cleaned = cleaned.replace(/<a\s+[^>]*>([\s\S]*?)<\/a>/gi, (_, inner) => {
    const txt = decodeHtmlEntities(inner.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return txt ? ` ${txt} ` : "";
  });

  const rawLines = decodeHtmlEntities(cleaned.replace(/<[^>]+>/g, "\n")).split(/\r?\n/);
  const outLines: string[] = [];

  for (const raw of rawLines) {
    // Strip any leftover markdown links [label](https://...) from cached content
    let line = raw
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();

    if (!line) continue;
    if (NOISE_LINE_REGEX.test(line)) continue;
    // Skip pure URL lines or tiny breadcrumb fragments
    if (/^https?:\/\/\S+$/i.test(line)) continue;
    if (/^(trang chủ|việc làm)\s*[>/»]\s*/i.test(line)) continue;

    // Normalize bullet symbols at start of line into "- "
    if (/^[•●▪▫▸▹◦‣⁃–—+]\s+/.test(line)) {
      line = `- ${line.replace(/^[•●▪▫▸▹◦‣⁃–—+]\s+/, "").trim()}`;
    } else if (/^\*\s+/.test(line)) {
      line = `- ${line.replace(/^\*\s+/, "").trim()}`;
    } else if (JD_SECTION_HEADER_REGEX.test(line)) {
      line = `## ${line.replace(/[:\-–]+$/, "").trim()}`;
    }

    // Deduplicate consecutive identical lines
    if (outLines.length > 0 && outLines[outLines.length - 1] === line) continue;
    outLines.push(line);
  }

  return outLines.join("\n").slice(0, 38000);
}

function normalizeForMatch(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKeywordExpansionTokens(rawKeywords: string[]): string[][] {
  const groups: string[][] = [];
  for (const raw of rawKeywords) {
    const kw = (raw || "").trim();
    if (!kw) continue;
    const norm = normalizeForMatch(kw);
    if (!norm) continue;

    if (
      norm.includes("tieng nhat") ||
      norm === "nhat" ||
      norm.includes("japanese") ||
      norm.includes("japan")
    ) {
      groups.push([
        "tieng nhat",
        "japanese",
        "japan",
        "nhat ban",
        "nhat ngu",
        "tieng nhat n1",
        "tieng nhat n2",
        "tieng nhat n3",
        "tieng nhat n4",
        "tieng nhat n5",
        "jlpt",
        "n1",
        "n2",
        "n3",
        "n4",
        "n5",
        "brse",
        "comtor",
        "it comtor",
        "communicator",
        "ky su cau noi",
        "bien dich tieng nhat",
        "phien dich tieng nhat",
        "thong dich tieng nhat",
        "kaiwa",
        "kanji",
        "tokyo",
        "osaka",
      ]);
    } else if (norm === "brse" || norm.includes("cau noi") || norm.includes("bridge")) {
      groups.push(["brse", "bridge se", "bridge engineer", "cau noi", "ky su cau noi", "kse"]);
    } else if (norm.includes("comtor") || norm.includes("communicator")) {
      groups.push(["comtor", "communicator", "it comtor", "bien dich tieng nhat", "phien dich tieng nhat"]);
    } else {
      const variants = [norm];
      groups.push(variants);
    }
  }
  return groups;
}

function matchesSearchKeywords(job: any, rawKeywords: string[]): boolean {
  if (!rawKeywords || rawKeywords.length === 0) return true;
  const groups = buildKeywordExpansionTokens(rawKeywords);
  if (groups.length === 0) return true;

  const titleNorm = normalizeForMatch(job.title || "");
  const isSearchingJapanese = rawKeywords.some((k) => {
    const nk = normalizeForMatch(k);
    return nk.includes("tieng nhat") || nk === "nhat" || nk.includes("japanese") || nk.includes("japan");
  });

  // Guard: If user is searching for Japanese jobs, reject titles explicitly for Korean/Chinese/French/German unless they also mention Japanese
  if (
    isSearchingJapanese &&
    /\b(tieng han|han ngu|korean|tieng trung|trung ngu|hoa ngu|chinese|tieng phap|tieng duc|tieng nga)\b/.test(titleNorm) &&
    !/\b(tieng nhat|nhat ngu|japanese|japan|jlpt|brse|comtor)\b/.test(titleNorm)
  ) {
    return false;
  }

  const haystackRaw = `${job.title || ""} ${job.company_name || ""} ${job.summary || ""} ${
    job.full_jd_html || ""
  } ${job.url || ""}`;
  const haystack = ` ${normalizeForMatch(haystackRaw)} `;

  // Job matches if it satisfies ANY of the user's comma-separated keywords
  for (const synonymList of groups) {
    for (const token of synonymList) {
      if (!token) continue;
      if (token.length <= 2) {
        // Short tokens like n1, n2, n3, ai, go, c# require word boundary
        const re = new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i");
        if (re.test(haystack)) return true;
      } else if (haystack.includes(token)) {
        return true;
      }
    }
  }
  return false;
}

const GENERIC_CATEGORY_TITLE_REGEX =
  /^(việc làm|tìm việc|tìm việc làm|tuyển dụng|danh sách việc làm|tất cả việc làm|top việc làm|việc làm hot|việc làm mới|việc làm gấp|việc làm thêm|việc làm theo|việc làm ngành|việc làm tại|công ty|khu vực|ngành nghề|địa điểm|trang chủ|đăng nhập|đăng ký|tạo cv|cẩm nang)/i;

const GENERIC_EXACT_TITLES = new Set([
  "viec lam",
  "tim viec lam",
  "tuyen dung",
  "viec lam it",
  "viec lam tieng nhat",
  "viec lam ke toan",
  "viec lam kinh doanh",
  "viec lam marketing",
  "viec lam nhan su",
  "viec lam ha noi",
  "viec lam ho chi minh",
  "viec lam tphcm",
  "viec lam da nang",
  "ung tuyen ngay",
  "xem chi tiet",
  "xem tat ca",
  "dang nhap",
  "dang ky",
  "easy apply",
  "apply now",
  "luu viec lam",
]);

function canonicalizeJobUrl(rawAbsUrl: string): string {
  try {
    const u = new URL(rawAbsUrl);
    const host = u.hostname.toLowerCase();

    // Normalize Indeed click-tracking URLs (/rc/clk?jk=XXX or /pagead/clk?jk=XXX) to canonical /viewjob?jk=XXX
    if (host.includes("indeed.com")) {
      const jk = u.searchParams.get("jk") || u.searchParams.get("vjk");
      if (jk) {
        return `https://${u.hostname}/viewjob?jk=${jk}`;
      }
    }

    // Strip noisy session/tracking query parameters that change on every request
    const stripParams = [
      "ta_source",
      "u_sr_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_referrer",
      "traceInfo",
      "source",
      "click_source",
      "refId",
      "trackingId",
      "trk",
      "src",
      "medium",
    ];
    for (const p of stripParams) {
      u.searchParams.delete(p);
    }
    u.hash = "";
    return u.toString();
  } catch {
    return rawAbsUrl;
  }
}

function isLikelyRealJobTitleAndUrl(title: string, absUrl: string, baseUrl: string): boolean {
  const cleanTitle = (title || "").replace(/\s+/g, " ").trim();
  if (cleanTitle.length < 5 || cleanTitle.length > 180) return false;

  const normTitle = normalizeForMatch(cleanTitle);
  if (GENERIC_EXACT_TITLES.has(normTitle)) return false;

  // Reject category links like "Việc làm Kế toán", "Việc làm tại Hà Nội", "Tìm việc làm..."
  if (GENERIC_CATEGORY_TITLE_REGEX.test(cleanTitle) && cleanTitle.split(/\s+/).length <= 6) {
    return false;
  }
  if (/^(việc làm tại|tuyển dụng tại|việc làm ngành|tìm việc làm|view similar jobs|easy apply)\b/i.test(cleanTitle)) {
    return false;
  }
  if (/\bsalaries$/i.test(cleanTitle)) return false;

  let parsed: URL;
  try {
    parsed = new URL(absUrl, baseUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const pathLower = parsed.pathname.toLowerCase();

  // Reject non-job paths
  if (
    /(\/login|\/register|\/sign-in|\/blog|\/tin-tuc|\/cam-nang|\/about|\/contact|\/privacy|\/terms|\/employer|\/nha-tuyen-dung|\/tao-cv|\/mau-cv|\/tinh-luong|\/cong-ty\/?$|\/companies\/?$|\/addlloc\/redirect|\/career\/salaries)/i.test(
      pathLower
    )
  ) {
    return false;
  }

  // Reject search/category index pages on portals
  if (
    /^\/(tim-viec-lam\/?$|viec-lam-tai|viec-lam-nganh|viec-lam-theo|viec-lam\/?$|jobs\/?$|it-jobs\/?$)/i.test(
      pathLower
    )
  ) {
    return false;
  }

  // ITviec: require numeric 4-digit job ID suffix (e.g. /it-jobs/brse-1234) to exclude skill tags
  if (host.includes("itviec.com")) {
    if (!/\/it-jobs\/[^\/?#]+-\d{4}(?:$|[\/?#])/i.test(pathLower)) {
      return false;
    }
  }

  // TopCV: require /viec-lam/.../12345.html or /brand/.../tuyen-dung/...-j12345.html
  if (host.includes("topcv.vn")) {
    if (
      !/\/viec-lam\/[^\/]+\/\d+\.html/i.test(pathLower) &&
      !/\/tuyen-dung\/[^\/]+-j\d+\.html/i.test(pathLower) &&
      !/-\d+\.html$/i.test(pathLower)
    ) {
      return false;
    }
  }

  // CareerViet: job detail URLs look like /vi/tim-viec-lam/...35C84F30.html (reject -k-vi.html search URLs)
  if (host.includes("careerviet.vn")) {
    if (/-k-vi\.html$/i.test(pathLower) || !/\/tim-viec-lam\/[^\/]+\.[0-9a-z]{6,}\.html$/i.test(pathLower)) {
      return false;
    }
  }

  // CareerLink: job detail URLs look like /tim-viec-lam/.../3652908
  if (host.includes("careerlink.vn")) {
    if (!/\/tim-viec-lam\/[^\/]+\/\d+/i.test(pathLower)) {
      return false;
    }
  }

  // JobsGO: real job links have /viec-lam/...-12345.html
  if (host.includes("jobsgo.vn")) {
    if (
      !/-\d+\.html$/i.test(pathLower) &&
      !/\/viec-lam\/[^\/]+\.html$/i.test(pathLower) &&
      !/\/tuyen-dung\//i.test(pathLower)
    ) {
      return false;
    }
  }

  // ViecOi: real job links have a 5+ digit ID (e.g. /viec-lam/...-123456.html); category links have 1-3 digit IDs
  if (host.includes("viecoi.vn")) {
    if (!/\/viec-lam\/[^\/]+-\d{5,}\.html$/i.test(pathLower) || /^việc làm\s+/i.test(cleanTitle)) {
      return false;
    }
  }

  // Joboko: real job links end with -xvi123456 (exclude /tim-viec-lam-... category links)
  if (host.includes("joboko.com")) {
    if (!/\/viec-lam-[^\/]+-xvi\d+/i.test(pathLower)) {
      return false;
    }
  }

  // XemViec: real job links are /viec-lam/<slug>
  if (host.includes("xemviec.com")) {
    if (!/\/viec-lam\/[^\/?#]{8,}/i.test(pathLower)) {
      return false;
    }
  }

  // CVWork: real job links are /viec-lam/viec/<slug>-<id>
  if (host.includes("cvwork.vn")) {
    if (!/\/viec-lam\/viec\/[^\/]+-\d+/i.test(pathLower)) {
      return false;
    }
  }

  // TopDev: real job links are /detail-jobs/<slug>-<id> or /viec-lam/<slug>-<id> (exclude superhotjobs sidebar ads)
  if (host.includes("topdev.vn")) {
    if (
      parsed.searchParams.get("medium") === "superhotjobs" ||
      (!/\/detail-jobs\/[^\/]+-\d+/i.test(pathLower) && !/\/viec-lam\/[^\/]+-\d+/i.test(pathLower))
    ) {
      return false;
    }
  }

  // Glints: real job links are /vn/opportunities/jobs/<slug>/<uuid>
  if (host.includes("glints.com")) {
    if (
      /\/opportunities\/jobs\/explore/i.test(pathLower) ||
      !/\/opportunities\/jobs\/[^\/]+\/[0-9a-f-]{16,}/i.test(pathLower)
    ) {
      return false;
    }
  }

  // Indeed: require viewjob or jk= parameter (exclude raw /pagead/clk without jk)
  if (host.includes("indeed.com")) {
    if (!/\/viewjob/i.test(pathLower) && !parsed.searchParams.has("jk") && !parsed.searchParams.has("vjk")) {
      return false;
    }
  }

  // Devwork: real job links are /viec-lam/<id>/<slug> (exclude skill filter links like /viec-lam/vuejs)
  if (host.includes("devwork.vn")) {
    if (!/\/viec-lam\/\d+\/[^\/?#]+/i.test(pathLower)) {
      return false;
    }
  }

  // IconicJob: real job links are /viec-lam/<slug>-<id> (exclude /viec-lam/tim-viec-lam)
  if (host.includes("iconicjob.vn")) {
    if (!/\/viec-lam\/[^\/?#]+-\d{4,}(?:$|[\/?#])/i.test(pathLower)) {
      return false;
    }
  }

  return true;
}

function sniffStructuredJobsFromHtml(html: string, baseUrl: string): any[] {
  const jobs: any[] = [];
  const seenUrls = new Set<string>();

  // 1. JSON-LD JobPosting & ItemList (excluding BreadcrumbList)
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = ldRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const walk = (obj: any) => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          obj.forEach(walk);
          return;
        }
        const t = obj["@type"];
        if (t === "BreadcrumbList" || (Array.isArray(t) && t.includes("BreadcrumbList"))) {
          return;
        }
        const isJobPosting =
          t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
        if (isJobPosting && (obj.title || obj.name)) {
          const title = decodeHtmlEntities(String(obj.title || obj.name)).replace(/\s+/g, " ").trim();
          const org = obj.hiringOrganization || {};
          const companyName = decodeHtmlEntities(String(org.name || "")).replace(/\s+/g, " ").trim();
          const loc = Array.isArray(obj.jobLocation) ? obj.jobLocation[0] : obj.jobLocation;
          const city =
            loc?.address?.addressLocality ||
            loc?.address?.addressRegion ||
            "Vietnam";
          let salStr = "Thỏa thuận";
          if (obj.baseSalary?.value) {
            const v = obj.baseSalary.value;
            const cur = obj.baseSalary.currency || "USD";
            if (typeof v === "object" && (v.minValue || v.maxValue || v.value)) {
              salStr = v.value
                ? `${v.value} ${cur}`
                : `${v.minValue || ""} - ${v.maxValue || ""} ${cur}`.trim();
            } else if (typeof v === "string" || typeof v === "number") {
              salStr = `${v} ${cur}`;
            }
          }
          const resolvedUrl = canonicalizeJobUrl(new URL(String(obj.url || baseUrl), baseUrl).toString());
          if (!seenUrls.has(resolvedUrl) && title.length >= 5) {
            seenUrls.add(resolvedUrl);
            jobs.push({
              title,
              company_name: companyName || "Doanh nghiệp Tuyển dụng",
              location_city: decodeHtmlEntities(String(city)).trim(),
              salary_raw: salStr,
              url: resolvedUrl,
              full_jd_html: String(obj.description || ""),
              extraction_method: "json_ld",
            });
          }
        }
        Object.values(obj).forEach(walk);
      };
      walk(parsed);
    } catch {
      // ignore invalid JSON-LD block
    }
  }

  // 2. Universal Hydrated State Sniffer (__NEXT_DATA__, Nuxt/Remix application/json, window.__INITIAL_STATE__)
  const walkHydratedState = (node: any, methodTag: string) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((child) => walkHydratedState(child, methodTag));
      return;
    }
    const jobTitle =
      node.jobTitle ||
      node.title ||
      node.positionTitle ||
      node.job_title ||
      node.position_name;
    const compName =
      node.companyName ||
      node.company_name ||
      node.company?.name ||
      node.companyData?.name ||
      node.employerName ||
      node.employer?.name ||
      node.organizationName ||
      node.hiringOrganization?.name;
    const rawLink =
      node.jobUrl ||
      node.job_url ||
      node.url ||
      node.canonicalUrl ||
      node.detailUrl ||
      node.slug;
    if (
      typeof jobTitle === "string" &&
      jobTitle.length >= 6 &&
      jobTitle.length <= 180 &&
      typeof compName === "string" &&
      compName.length >= 2 &&
      typeof rawLink === "string" &&
      rawLink.length >= 3
    ) {
      try {
        const absUrl = canonicalizeJobUrl(
          rawLink.startsWith("http")
            ? rawLink
            : new URL(rawLink.startsWith("/") ? rawLink : `/${rawLink}`, baseUrl).toString()
        );
        if (!seenUrls.has(absUrl) && isLikelyRealJobTitleAndUrl(jobTitle, absUrl, baseUrl)) {
          seenUrls.add(absUrl);
          jobs.push({
            title: decodeHtmlEntities(jobTitle).trim(),
            company_name: decodeHtmlEntities(compName).trim(),
            location_city: String(
              node.location ||
                node.location_name ||
                node.province ||
                node.city ||
                node.workingLocations?.[0]?.cityNameVI ||
                "Vietnam"
            ).trim(),
            salary_raw: String(
              node.salary || node.prettySalary || node.salary_text || "Thỏa thuận"
            ).trim(),
            url: absUrl,
            full_jd_html: String(node.jobDescription || node.description || ""),
            extraction_method: methodTag,
          });
        }
      } catch {
        // ignore URL parse error
      }
    }
    Object.values(node).forEach((child) => walkHydratedState(child, methodTag));
  };

  const jsonScriptRegex =
    /<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let jsMatch: RegExpExecArray | null;
  while ((jsMatch = jsonScriptRegex.exec(html)) !== null) {
    try {
      const rawJson = jsMatch[1].trim();
      if (rawJson.length > 50 && rawJson.length < 3_000_000) {
        const parsedState = JSON.parse(rawJson);
        walkHydratedState(parsedState, "next_data");
      }
    } catch {
      // ignore non-JSON or malformed script
    }
  }

  const winStateRegex =
    /window\.(?:__INITIAL_STATE__|__PRELOADED_STATE__|__NUXT__|__DATA__)\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/gi;
  let wsMatch: RegExpExecArray | null;
  while ((wsMatch = winStateRegex.exec(html)) !== null) {
    try {
      const parsedWin = JSON.parse(wsMatch[1].trim());
      walkHydratedState(parsedWin, "hydrated_state");
    } catch {
      // ignore non-JSON state script
    }
  }

  // 3. Indeed Mosaic Provider Sniffer (window.mosaic.providerData["mosaic-provider-jobcards"])
  const mosaicRegex =
    /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/gi;
  let mosMatch: RegExpExecArray | null;
  while ((mosMatch = mosaicRegex.exec(html)) !== null) {
    try {
      const mosObj = JSON.parse(mosMatch[1].trim());
      const results =
        mosObj?.metaData?.mosaicProviderJobCardsModel?.results ||
        mosObj?.results ||
        [];
      if (Array.isArray(results)) {
        for (const it of results) {
          const jk = String(it?.jobkey || "").trim();
          const title = decodeHtmlEntities(String(it?.title || it?.normTitle || "")).trim();
          const comp = decodeHtmlEntities(String(it?.company || "Doanh nghiệp trên Indeed")).trim();
          if (!jk || title.length < 4) continue;
          const absUrl = `https://vn.indeed.com/viewjob?jk=${jk}`;
          if (seenUrls.has(absUrl)) continue;
          seenUrls.add(absUrl);
          const loc = decodeHtmlEntities(
            String(it?.formattedLocation || it?.jobLocationCity || "Vietnam")
          ).trim();
          let sal = String(it?.salarySnippet?.text || it?.extractedSalary?.max || "").trim();
          if (!sal && it?.extractedSalary?.min && it?.extractedSalary?.max) {
            sal = `${it.extractedSalary.min} - ${it.extractedSalary.max} ${
              it.extractedSalary.currency || "VND"
            }`;
          }
          if (!sal) sal = "Thỏa thuận";
          const rawSnippet = String(it?.snippet || "").trim();
          const reqList = Array.isArray(it?.jobCardRequirementsModel?.requirements)
            ? it.jobCardRequirementsModel.requirements
                .map((r: any) => r?.label || r)
                .filter(Boolean)
            : [];
          const jdHtml = [
            `<h2>Mô tả công việc — ${title}</h2>`,
            `<p><strong>Công ty:</strong> ${comp} · <strong>Khu vực:</strong> ${loc} · <strong>Mức lương:</strong> ${sal}</p>`,
            rawSnippet ? `<div>${rawSnippet}</div>` : "",
            reqList.length > 0
              ? `<h3>Yêu cầu nổi bật</h3><ul>${reqList.map((r: string) => `<li>${r}</li>`).join("")}</ul>`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
          jobs.push({
            title,
            company_name: comp,
            location_city: loc,
            salary_raw: sal,
            url: absUrl,
            full_jd_html: jdHtml,
            extraction_method: "indeed_mosaic",
          });
        }
      }
    } catch {
      // ignore invalid mosaic JSON
    }
  }

  return jobs;
}

function extractJobsFromXhrPayloads(
  xhrPayloads: Array<{ url: string; data: any }>,
  baseUrl: string
): any[] {
  const jobs: any[] = [];
  const seenUrls = new Set<string>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const title =
      node.jobTitle ||
      node.title ||
      node.positionTitle ||
      node.position ||
      node.job_title;
    const compName =
      node.companyName ||
      node.company_name ||
      node.company?.name ||
      node.companyData?.name ||
      node.metadata?.companyName ||
      node.employerName ||
      (typeof node.company === "string" ? node.company : "");

    let rawUrl =
      node.jobUrl ||
      node.job_url ||
      node.url ||
      node.canonicalUrl ||
      (node.slug && node.id && baseUrl.includes("joywork.vn")
        ? `https://joywork.vn/jobs/${node.slug}--${node.id}`
        : "");

    if (
      typeof title === "string" &&
      title.trim().length >= 5 &&
      typeof compName === "string" &&
      compName.trim().length >= 2 &&
      typeof rawUrl === "string" &&
      rawUrl.trim().length >= 4
    ) {
      try {
        const absUrl = canonicalizeJobUrl(
          rawUrl.startsWith("http")
            ? rawUrl
            : new URL(rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`, baseUrl).toString()
        );
        if (!seenUrls.has(absUrl)) {
          seenUrls.add(absUrl);
          const loc =
            node.workingLocations?.[0]?.cityNameVI ||
            node.workingLocations?.[0]?.cityName ||
            node.province ||
            node.location ||
            node.city ||
            "Vietnam";
          const sal =
            node.prettySalary ||
            node.metadata?.salaryText ||
            node.salary ||
            (node.salaryMin || node.salaryMax
              ? `${node.salaryMin || ""} - ${node.salaryMax || ""} ${node.currency || "VND"}`
              : "Thỏa thuận");
          const jdHtml = [node.jobDescription || node.description || "", node.jobRequirement || node.requirements || "", node.benefits || ""]
            .filter(Boolean)
            .join("\n\n");

          jobs.push({
            title: decodeHtmlEntities(title).replace(/\s+/g, " ").trim(),
            company_name: decodeHtmlEntities(compName).replace(/\s+/g, " ").trim(),
            location_city: decodeHtmlEntities(String(loc)).replace(/\s+/g, " ").trim(),
            salary_raw: decodeHtmlEntities(String(sal)).replace(/\s+/g, " ").trim(),
            url: absUrl,
            full_jd_html: jdHtml,
            extraction_method: "xhr_sniffer",
          });
        }
      } catch {
        // ignore URL parse error
      }
    }

    Object.values(node).forEach(walk);
  };

  for (const item of xhrPayloads || []) {
    if (item && item.data) {
      walk(item.data);
    }
  }

  return jobs;
}

function cleanExtractedCompanyName(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\bVietnam Small Logo$/i, "")
    .replace(/\bSmall Logo$/i, "")
    .replace(/^Logo\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompanyFromCardSnippet(cardHtml: string, jobTitle: string): string {
  // 1. Explicit company class attributes inside card
  const classPatterns = [
    /<(?:a|span|div|p|h4|h5)[^>]+class=["'][^"']*(?:company-name|company_name|company-link|item-company|job-company|company-title|comp-name|employer-name|base-search-card__subtitle|ims-2|\bjco\b|\bcompany\b)[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|span|div|p|h4|h5)>/i,
    /data-testid=["']company-name["'][^>]*>([\s\S]*?)<\//i,
    /<a[^>]+href=["'][^"']*\/(?:cong-ty|companies|company|nha-tuyen-dung|brand|doanh-nghiep|employer)\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i,
    /<div[^>]+class=["'][^"']*(?:avatar|logo-wrapper|listing-logo)[^"']*["'][^>]*>[\s\S]*?<img[^>]+alt=["']([^"']{3,110})["']/i,
    /<img[^>]+alt=["']([^"']{4,110}(?:JSC|Co\.|Ltd|Inc|Corp|Cổ phần|TNHH|Group|Technology|Software|Solutions|Vietnam|Việt Nam|Small Logo)[^"']*)["']/i,
  ];

  for (const pat of classPatterns) {
    const m = cardHtml.match(pat);
    if (m && m[1]) {
      const candidate = cleanExtractedCompanyName(m[1]);
      if (
        candidate.length >= 3 &&
        candidate.length <= 115 &&
        candidate.toLowerCase() !== jobTitle.toLowerCase() &&
        !/^(xem thêm|chi tiết|apply|ứng tuyển|lưu tin|nhà tuyển dụng)$/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  // 2. Fallback: look for company legal entity patterns in card plain text
  const plainLines = decodeHtmlEntities(cardHtml.replace(/<[^>]+>/g, "\n"))
    .split(/\r?\n/)
    .map((s) => cleanExtractedCompanyName(s))
    .filter(Boolean);

  for (const line of plainLines) {
    if (line === jobTitle) continue;
    if (
      /\b(CÔNG TY|Công ty|TNHH|Cổ phần|CP\b|JSC|Co\.,?\s*Ltd|Corp|Corporation|Group|Software|Technology|Solutions|Systems|Holdings|Bank|FPT|Viettel|VNG|Rikkei|VTI|Luvina|NTQ|CMC|Hitachi|Panasonic|Canon|Sony|Toshiba|Nidec|Fujitsu|NTT|Rakuten|Sun\*)\b/i.test(
        line
      ) &&
      line.length >= 4 &&
      line.length <= 115
    ) {
      return line;
    }
  }

  return "Doanh nghiệp Tuyển dụng";
}

function cleanCardSnippetText(cardHtml: string): string {
  if (!cardHtml) return "";
  // Remove leading/trailing partial tags caused by slicing bodyHtml at fixed offsets
  const trimmed = cardHtml
    .replace(/^[^<]*>/, " ")
    .replace(/<[^>]*$/, " ")
    // Strip tooltip attributes that embed raw HTML inside title="<div...>"
    .replace(/\b(?:title|data-original-title)=["']<[\s\S]*?["']/gi, " ");
  const stripped = decodeHtmlEntities(trimmed.replace(/<[^>]+>/g, " "));
  return stripped
    .replace(/<[^>]*>/g, " ")
    .replace(/\b[a-z0-9_-]+=["'][^"']*["']/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanJobAnchorTitle(anchorFullHtml: string, anchorInnerHtml: string): string {
  // Skip avatar/logo wrapper links that contain only an <img> and no visible text
  const visibleInner = anchorInnerHtml
    .replace(/<img[^>]*>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .trim();
  if (!visibleInner && /<img\b/i.test(anchorInnerHtml)) {
    return "";
  }

  // Check clean title="" attribute on the <a> tag first (if it doesn't contain embedded HTML tooltip)
  const titleAttr = anchorFullHtml.match(/\btitle=["']([^"'<>]{6,160})["']/i);
  const ariaAttr = anchorFullHtml.match(/\baria-label=["']([^"'<>]{6,160})["']/i);

  // Strip embedded tooltip spans (e.g. TopCV verified employer tooltip containing raw HTML inside title="")
  const strippedInner = anchorInnerHtml
    .replace(/<span[^>]*data-toggle=["']tooltip["'][\s\S]*$/i, "")
    .replace(/title=["']<[\s\S]*?["']/gi, "");

  let text = decodeHtmlEntities(strippedInner.replace(/<[^>]+>/g, " "))
    .replace(/Nhà tuyển dụng\s+đã được xác thực[\s\S]*$/i, "")
    .replace(/\bnew\b$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // If the <a> tag wraps the entire job card (e.g. devwork.vn), extract the inner heading <h1>..<h5>
  if (text.length > 120) {
    const headingMatch = strippedInner.match(/<h[1-5][^>]*>([\s\S]*?)<\/h[1-5]>/i);
    if (headingMatch && headingMatch[1]) {
      const hText = decodeHtmlEntities(headingMatch[1].replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (hText.length >= 5 && hText.length <= 160) {
        text = hText;
      }
    }
  }

  if ((text.length < 5 || text.length > 160) && titleAttr && titleAttr[1]) {
    text = decodeHtmlEntities(titleAttr[1]).replace(/\s+/g, " ").trim();
  }
  if ((text.length < 5 || text.length > 160) && ariaAttr && ariaAttr[1]) {
    text = decodeHtmlEntities(ariaAttr[1]).replace(/\s+/g, " ").trim();
  }
  return text;
}

function extractHeuristicJobsFromHtml(html: string, baseUrl: string): any[] {
  const jobs: any[] = [];
  const seen = new Set<string>();

  // Strip global header, nav, footer, and script/style blocks before scanning job links
  const bodyHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Universal job link pattern covering Vietnamese, Japanese, and Global job boards + company career pages
  const jobHrefPattern =
    /(\/jobs?\/|\/viewjob\b|\/rc\/clk\b|\/pagead\/clk\b|\/detail-jobs\/|\/viec-lam\/|\/viec-lam-|\/tin-tuyen-dung\/|\/cong-viec\/|\/tim-viec\/|\/tim-viec-lam\/|\/tuyen-dung\/|\/tuyen-dung-|\/co-hoi-nghe-nghiep\/|\/chi-tiet-viec-lam\/|\/chi-tiet-cong-viec\/|\/ung-tuyen\/|\/it-jobs\/|\/careers?\/|\/positions?\/|\/roles?\/|\/remote-jobs\/|\/opportunities\/jobs\/|\/recruitment\/|\/openings?\/|\/vacanc(?:y|ies)\/|\/job-detail\/|\/job-opening\/|\/jd\/|-[pjd]?\d{4,}\.html$|-\d{4,}-jd\b|\.[0-9a-z]{6,}\.html$|\/[a-z0-9-]+-\d{4,}(?:\/|\?|$)|[?&](?:job_?id|jk|vjk)=\w+)/i;

  const anchorClassJobPattern =
    /\bclass=["'][^"']*(?:job-title|job_title|title-job|job-link|job-name|position-title|vacancy-title)[^"']*["']/i;

  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  interface CandidateAnchor {
    index: number;
    fullLen: number;
    title: string;
    absUrl: string;
  }
  const matchedAnchors: CandidateAnchor[] = [];

  while ((m = anchorRegex.exec(bodyHtml)) !== null) {
    const rawHref = decodeHtmlEntities(m[1] || "").trim();
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:") || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      continue;
    }
    const matchesHref = jobHrefPattern.test(rawHref);
    const matchesClass = anchorClassJobPattern.test(m[0]);
    if (!matchesHref && !matchesClass) continue;

    const text = cleanJobAnchorTitle(m[0], m[2]);
    if (text.length < 5) continue;

    let absUrl = baseUrl;
    try {
      absUrl = canonicalizeJobUrl(new URL(rawHref, baseUrl).toString());
    } catch {
      continue;
    }
    if (seen.has(absUrl) || absUrl === baseUrl) continue;
    if (!isLikelyRealJobTitleAndUrl(text, absUrl, baseUrl)) continue;

    seen.add(absUrl);
    matchedAnchors.push({
      index: m.index,
      fullLen: m[0].length,
      title: text,
      absUrl,
    });
    if (matchedAnchors.length >= 150) break;
  }

  for (let i = 0; i < matchedAnchors.length; i++) {
    const item = matchedAnchors[i];
    // Strictly isolate card boundaries so adjacent job cards never bleed salary/company into each other
    const prevEnd = i > 0 ? matchedAnchors[i - 1].index + matchedAnchors[i - 1].fullLen : 0;
    const nextStart = i + 1 < matchedAnchors.length ? matchedAnchors[i + 1].index : bodyHtml.length;
    const startIdx = Math.max(0, item.index - 350, prevEnd);
    const endIdx = Math.min(bodyHtml.length, item.index + 1150, nextStart);

    const cardHtml = bodyHtml.slice(startIdx, endIdx);
    const snippet = cleanCardSnippetText(cardHtml);

    const companyName = extractCompanyFromCardSnippet(cardHtml, item.title);

    const salMatch = snippet.match(
      /(\$\s?\d[\d,\.]*(?:\s*[-–]\s*\$?\s?\d[\d,\.]*)?|(?:từ|lên đến|up to|trên|dưới)?\s*[1-9]\d*(?:[\.,]\d+)?(?:\s*[-–]\s*\d+(?:[\.,]\d+)?)?\s*(?:triệu|tr\b|M\b|VND|VNĐ|₫|USD|Man|Yên|JPY)|thỏa thuận|thoả thuận|negotiable|cạnh tranh|you'll love it)/i
    );
    const locMatch = snippet.match(
      /\b(Hà Nội|Ha Noi|Hồ Chí Minh|Ho Chi Minh|TP\.?\s*HCM|Đà Nẵng|Da Nang|Bình Dương|Đồng Nai|Hải Phòng|Bắc Ninh|Hưng Yên|Vĩnh Phúc|Long An|Cần Thơ|Nhật Bản|Tokyo|Osaka|Remote|Hybrid|Toàn quốc|Vietnam)\b/i
    );

    const cleanSal = salMatch ? salMatch[1].trim() : "Thỏa thuận";
    const cleanLoc = locMatch ? locMatch[1].trim() : "Vietnam";
    const cleanSum =
      snippet.length >= 30 && !snippet.includes('="')
        ? snippet.slice(0, 320)
        : `${item.title} — ${companyName} (${cleanLoc} · ${cleanSal})`;

    jobs.push({
      title: item.title,
      company_name: companyName,
      salary_raw: cleanSal,
      location_city: cleanLoc,
      url: item.absUrl,
      summary: cleanSum,
      extraction_method: "heuristic",
    });
  }

  return jobs;
}

function escapeRegexSafe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildOpeningTagRegexForSelectorToken(token: string): RegExp | null {
  const clean = token.trim();
  if (!clean) return null;
  const parts = clean.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (!last) return null;

  // Attribute selector e.g. a[href*="/viec-lam/"] or [data-job-id]
  const attrMatch = last.match(/^([a-zA-Z0-9_-]+)?\[([a-zA-Z0-9_:-]+)(?:([*^$~|]?=)["']?([^"'\]]+)["']?)?\]$/);
  if (attrMatch) {
    const tag = attrMatch[1] ? escapeRegexSafe(attrMatch[1]) : "[a-zA-Z0-9_-]+";
    const attrName = escapeRegexSafe(attrMatch[2]);
    const op = attrMatch[3] || "";
    const attrVal = attrMatch[4] ? escapeRegexSafe(attrMatch[4]) : "";
    if (!op) {
      return new RegExp(`<(${tag})\\b[^>]*\\b${attrName}\\b[^>]*>`, "gi");
    }
    if (op === "*=") {
      return new RegExp(`<(${tag})\\b[^>]*\\b${attrName}=["'][^"']*${attrVal}[^"']*["'][^>]*>`, "gi");
    }
    if (op === "^=") {
      return new RegExp(`<(${tag})\\b[^>]*\\b${attrName}=["']${attrVal}[^"']*["'][^>]*>`, "gi");
    }
    return new RegExp(`<(${tag})\\b[^>]*\\b${attrName}=["'][^"']*${attrVal}[^"']*["'][^>]*>`, "gi");
  }

  // ID selector e.g. #job-list or div#job-card
  const idMatch = last.match(/^([a-zA-Z0-9_-]+)?#([a-zA-Z0-9_-]+)$/);
  if (idMatch) {
    const tag = idMatch[1] ? escapeRegexSafe(idMatch[1]) : "[a-zA-Z0-9_-]+";
    const idVal = escapeRegexSafe(idMatch[2]);
    return new RegExp(`<(${tag})\\b[^>]*\\bid=["']${idVal}["'][^>]*>`, "gi");
  }

  // Class selector e.g. .job-item, div.job-card, h3.title.bold
  if (last.includes(".")) {
    const segs = last.split(".");
    const tag = segs[0] ? escapeRegexSafe(segs[0]) : "[a-zA-Z0-9_-]+";
    const firstClass = escapeRegexSafe(segs[1] || "");
    if (!firstClass) return null;
    return new RegExp(
      `<(${tag})\\b[^>]*\\bclass=["'](?:[^"']*\\s)?${firstClass}(?:\\s[^"']*)?["'][^>]*>`,
      "gi"
    );
  }

  // Plain tag selector e.g. article, h3, h2, a
  if (/^[a-zA-Z0-9_-]+$/.test(last)) {
    return new RegExp(`<(${escapeRegexSafe(last)})\\b[^>]*>`, "gi");
  }

  return null;
}

function extractFieldFromCardBySelector(
  cardHtml: string,
  selector: string
): { text: string; href: string } {
  if (!cardHtml || !selector || !selector.trim()) return { text: "", href: "" };
  const subSelectors = selector
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sub of subSelectors) {
    const chain = sub.split(/\s+/).filter(Boolean);
    let scopeHtml = cardHtml;

    // If descendant chain like "h3 a" or ".title a", narrow to parent first if possible
    if (chain.length >= 2) {
      const parentRx = buildOpeningTagRegexForSelectorToken(chain[0]);
      if (parentRx) {
        const pm = parentRx.exec(scopeHtml);
        if (pm) {
          const parentTag = pm[1];
          const rest = scopeHtml.slice(pm.index);
          const closeRx = new RegExp(`</${escapeRegexSafe(parentTag)}\\s*>`, "i");
          const cm = closeRx.exec(rest);
          scopeHtml = cm ? rest.slice(0, cm.index + cm[0].length) : rest.slice(0, 900);
        }
      }
    }

    const leafToken = chain[chain.length - 1];
    const openRx = buildOpeningTagRegexForSelectorToken(leafToken);
    if (!openRx) continue;

    let m: RegExpExecArray | null;
    while ((m = openRx.exec(scopeHtml)) !== null) {
      const matchedTag = m[1];
      const openTagStr = m[0];
      const afterOpen = scopeHtml.slice(m.index + openTagStr.length);
      const closeRx = new RegExp(`</${escapeRegexSafe(matchedTag)}\\s*>`, "i");
      const closeMatch = closeRx.exec(afterOpen);
      const innerHtml = closeMatch ? afterOpen.slice(0, closeMatch.index) : afterOpen.slice(0, 450);

      let href = "";
      const selfHref = openTagStr.match(/\bhref=["']([^"']+)["']/i);
      if (selfHref?.[1]) {
        href = decodeHtmlEntities(selfHref[1]).trim();
      } else {
        const childHref = innerHtml.match(/<a\b[^>]*\bhref=["']([^"']+)["']/i);
        if (childHref?.[1]) href = decodeHtmlEntities(childHref[1]).trim();
      }

      let rawText = decodeHtmlEntities(innerHtml.replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (!rawText) {
        const titleAttr = openTagStr.match(/\b(?:title|aria-label)=["']([^"']{4,180})["']/i);
        if (titleAttr?.[1]) rawText = decodeHtmlEntities(titleAttr[1]).trim();
      }

      if (rawText) {
        return { text: rawText, href };
      }
    }
  }

  return { text: "", href: "" };
}

export function extractJobsUsingDomainRecipe(html: string, baseUrl: string, recipe: any): any[] {
  if (!html || !recipe || !recipe.card_selector) return [];
  const bodyHtml = html
    .replace(/<(script|style|noscript|svg|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  let baseHost = "";
  try {
    baseHost = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // ignore
  }

  const cardTokens = String(recipe.card_selector || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const startPositions: number[] = [];
  for (const tok of cardTokens) {
    const rx = buildOpeningTagRegexForSelectorToken(tok);
    if (!rx) continue;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(bodyHtml)) !== null) {
      startPositions.push(m.index);
    }
  }

  if (startPositions.length === 0) return [];
  startPositions.sort((a, b) => a - b);

  // Deduplicate close start positions
  const uniqueStarts: number[] = [];
  for (const pos of startPositions) {
    if (uniqueStarts.length === 0 || pos - uniqueStarts[uniqueStarts.length - 1] > 45) {
      uniqueStarts.push(pos);
    }
  }

  const jobs: any[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < uniqueStarts.length && jobs.length < 70; i++) {
    const startIdx = uniqueStarts[i];
    const nextStart = i + 1 < uniqueStarts.length ? uniqueStarts[i + 1] : bodyHtml.length;
    const endIdx = Math.min(bodyHtml.length, startIdx + 4200, nextStart);
    const cardHtml = bodyHtml.slice(startIdx, endIdx);

    const titleField = extractFieldFromCardBySelector(
      cardHtml,
      String(recipe.title_selector || "h3 a, h2 a, a")
    );
    let title = titleField.text
      .replace(/^(?:Mới|Hot|Urgent|Gấp|New|Top| Tuyển gấp)\s*[-:•|]?\s*/i, "")
      .trim();
    let rawHref = titleField.href;

    if (!rawHref && recipe.link_selector) {
      const linkField = extractFieldFromCardBySelector(cardHtml, String(recipe.link_selector));
      rawHref = linkField.href;
      if (!title && linkField.text) title = linkField.text.trim();
    }

    if (!rawHref) {
      const anyAnchor = cardHtml.match(/<a\b[^>]*\bhref=["']([^"']+)["']/i);
      if (anyAnchor?.[1]) rawHref = decodeHtmlEntities(anyAnchor[1]).trim();
    }

    if (!title || !rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("#")) {
      continue;
    }

    let absUrl = rawHref;
    try {
      absUrl = canonicalizeJobUrl(new URL(rawHref, baseUrl).toString());
    } catch {
      continue;
    }

    if (baseHost.includes("indeed.com")) {
      const jkAttrMatch =
        cardHtml.match(/\bdata-jk=["']([a-zA-Z0-9_-]{8,24})["']/i) ||
        cardHtml.match(/\bid=["']job_([a-zA-Z0-9_-]{8,24})["']/i);
      if (jkAttrMatch?.[1]) {
        absUrl = `https://vn.indeed.com/viewjob?jk=${jkAttrMatch[1]}`;
      }
    }

    if (seenUrls.has(absUrl)) continue;
    if (!isLikelyRealJobTitleAndUrl(title, absUrl, baseUrl)) continue;
    seenUrls.add(absUrl);

    const compField = recipe.company_selector
      ? extractFieldFromCardBySelector(cardHtml, String(recipe.company_selector))
      : { text: "", href: "" };
    const salField = recipe.salary_selector
      ? extractFieldFromCardBySelector(cardHtml, String(recipe.salary_selector))
      : { text: "", href: "" };
    const locField = recipe.location_selector
      ? extractFieldFromCardBySelector(cardHtml, String(recipe.location_selector))
      : { text: "", href: "" };

    const snippet = cleanCardSnippetText(cardHtml);
    let companyName =
      compField.text && compField.text.length >= 2 && compField.text.length <= 120
        ? compField.text
        : extractCompanyFromCardSnippet(cardHtml, title);
    if (baseHost.includes("iconicjob.vn") && companyName === "Doanh nghiệp Tuyển dụng") {
      const occField = extractFieldFromCardBySelector(cardHtml, ".job-occupation .location-desc");
      companyName = occField.text
        ? `Doanh nghiệp FDI Nhật (${occField.text})`
        : "Doanh nghiệp FDI Nhật Bản (ICONIC)";
    }

    const salMatch = snippet.match(
      /(\$\s?\d[\d,\.]*(?:\s*[-–]\s*\$?\s?\d[\d,\.]*)?|(?:từ|lên đến|up to|trên|dưới)?\s*[1-9]\d*(?:[\.,]\d+)?(?:\s*[-–]\s*\d+(?:[\.,]\d+)?)?\s*(?:triệu|tr\b|M\b|VND|VNĐ|₫|USD|Man|Yên|JPY)|thỏa thuận|thoả thuận|negotiable|cạnh tranh|you'll love it)/i
    );
    const locMatch = snippet.match(
      /\b(Hà Nội|Ha Noi|Hồ Chí Minh|Ho Chi Minh|TP\.?\s*HCM|Đà Nẵng|Da Nang|Bình Dương|Đồng Nai|Hải Phòng|Bắc Ninh|Hưng Yên|Vĩnh Phúc|Long An|Cần Thơ|Nhật Bản|Tokyo|Osaka|Remote|Hybrid|Toàn quốc|Vietnam)\b/i
    );

    const cleanSal = salField.text || (salMatch ? salMatch[1].trim() : "Thỏa thuận");
    const cleanLoc = locField.text || (locMatch ? locMatch[1].trim() : "Vietnam");
    const cleanSum =
      snippet.length >= 30 && !snippet.includes('="')
        ? snippet.slice(0, 320)
        : `${title} — ${companyName} (${cleanLoc} · ${cleanSal})`;

    jobs.push({
      title,
      company_name: companyName,
      salary_raw: cleanSal,
      location_city: cleanLoc,
      url: absUrl,
      summary: cleanSum,
      extraction_method: "recipe",
    });
  }

  return jobs;
}

export function autoSuggestRecipeFromHtml(html: string, baseUrl: string) {
  let domain = "unknown";
  try {
    domain = new URL(baseUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    // ignore
  }

  const bodyHtml = (html || "").replace(
    /<(script|style|noscript|svg|header|footer|nav)\b[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );

  // 1. Discover common card container classes in the page
  const classFreq = new Map<string, number>();
  const cardTagRx = /<(div|article|li|section)\b[^>]*\bclass=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = cardTagRx.exec(bodyHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const classes = m[2]
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(
        (c) =>
          c.length >= 3 &&
          !c.includes(":") &&
          !c.includes("[") &&
          /job|item|card|post|vacancy|result|career|listing|row|box/i.test(c)
      );
    for (const cls of classes) {
      const key = `${tag}.${cls}`;
      classFreq.set(key, (classFreq.get(key) || 0) + 1);
    }
  }

  let bestCardSelector = ".job-item, .job-card, article";
  let bestCount = 0;
  for (const [sel, count] of classFreq.entries()) {
    if (count >= 3 && count <= 120 && count > bestCount) {
      bestCount = count;
      bestCardSelector = sel;
    }
  }

  // 2. Discover title selector
  const candidateTitleSelectors = [
    "h3 a",
    "h2 a",
    ".job-title a",
    ".title a",
    "h4 a",
    "a[href*='/viec-lam/']",
    "a[href*='/jobs/']",
    "a",
  ];
  let bestTitleSelector = "h3 a, h2 a, .title a";
  for (const tSel of candidateTitleSelectors) {
    const rx = buildOpeningTagRegexForSelectorToken(tSel);
    if (rx && (bodyHtml.match(rx) || []).length >= 3) {
      bestTitleSelector = tSel;
      break;
    }
  }

  // 3. Discover company, salary, location selectors
  const detectCommonClass = (pattern: RegExp, fallback: string): string => {
    const freq = new Map<string, number>();
    const rx = /<[a-zA-Z0-9_-]+\b[^>]*\bclass=["']([^"']+)["'][^>]*>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = rx.exec(bodyHtml)) !== null) {
      for (const cls of cm[1].split(/\s+/)) {
        if (pattern.test(cls) && !cls.includes(":") && !cls.includes("[")) {
          freq.set(`.${cls}`, (freq.get(`.${cls}`) || 0) + 1);
        }
      }
    }
    let best = fallback;
    let maxC = 2;
    for (const [sel, c] of freq.entries()) {
      if (c > maxC && c <= 120) {
        maxC = c;
        best = sel;
      }
    }
    return best;
  };

  const bestCompanySelector = detectCommonClass(
    /company|employer|corp|cong-ty| doanh-nghiep/i,
    ".company-name, .company"
  );
  const bestSalarySelector = detectCommonClass(
    /salary|wage|luong|muc-luong|compensation/i,
    ".salary, .job-salary"
  );
  const bestLocationSelector = detectCommonClass(
    /location|address|city|work-location|dia-diem/i,
    ".location, .address"
  );

  return {
    domain,
    recipe_name: `Auto Recipe (${domain})`,
    card_selector: bestCardSelector,
    title_selector: bestTitleSelector,
    company_selector: bestCompanySelector,
    salary_selector: bestSalarySelector,
    location_selector: bestLocationSelector,
  };
}

function discoverNextPageUrlFromHtml(
  html: string,
  currentUrl: string,
  nextPageNum: number
): string | null {
  if (!html) return null;
  try {
    const baseHost = new URL(currentUrl).hostname.toLowerCase();

    // 1. Check explicit rel="next" in <link> or <a>
    const relNextMatch =
      html.match(/<(?:link|a)\s+[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i) ||
      html.match(/<(?:link|a)\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i);
    if (relNextMatch && relNextMatch[1]) {
      const candidate = new URL(decodeHtmlEntities(relNextMatch[1]).trim(), currentUrl).toString();
      if (new URL(candidate).hostname.toLowerCase() === baseHost && candidate !== currentUrl) {
        return validateTargetUrl(candidate);
      }
    }

    // 2. Scan anchor hrefs that explicitly match nextPageNum
    const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    const pagePatterns = [
      new RegExp(`[?&](?:page|p|trang)=${nextPageNum}(?:&|$)`, "i"),
      new RegExp(`(?:-|/|_)(?:trang|page)-${nextPageNum}(?:-|/|_|$|\\.html)`, "i"),
    ];

    while ((m = anchorRegex.exec(html)) !== null) {
      const rawHref = decodeHtmlEntities(m[1] || "").trim();
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
      if (pagePatterns.some((pat) => pat.test(rawHref))) {
        const candidate = new URL(rawHref, currentUrl).toString();
        if (new URL(candidate).hostname.toLowerCase() === baseHost && candidate !== currentUrl) {
          return validateTargetUrl(candidate);
        }
      }
    }
  } catch {
    // ignore URL parse errors
  }
  return null;
}

function buildPaginatedUrl(baseUrl: string, platformId: string, pageNum: number): string {
  if (pageNum <= 1) return baseUrl;
  try {
    const u = new URL(baseUrl);
    const host = u.hostname.toLowerCase();

    if (platformId === "careerviet" || host.includes("careerviet.vn")) {
      if (/-vi\.html$/i.test(u.pathname)) {
        u.pathname = u.pathname
          .replace(/-trang-\d+-vi\.html$/i, "-vi.html")
          .replace(/-vi\.html$/i, `-trang-${pageNum}-vi.html`);
        return validateTargetUrl(u.toString());
      }
    }

    if (platformId === "jobsgo" || host.includes("jobsgo.vn")) {
      if (/\.html$/i.test(u.pathname)) {
        u.pathname = u.pathname
          .replace(/-trang-\d+\.html$/i, ".html")
          .replace(/\.html$/i, `-trang-${pageNum}.html`);
        return validateTargetUrl(u.toString());
      }
    }

    if (platformId === "joboko" || host.includes("joboko.com")) {
      u.searchParams.set("trang", String(pageNum));
      return validateTargetUrl(u.toString());
    }

    if (platformId === "indeed" || host.includes("indeed.com")) {
      u.searchParams.set("start", String((pageNum - 1) * 10));
      return validateTargetUrl(u.toString());
    }

    if (platformId === "linkedin" || host.includes("linkedin.com")) {
      u.searchParams.set("start", String((pageNum - 1) * 25));
      return validateTargetUrl(u.toString());
    }

    u.searchParams.set("page", String(pageNum));
    return validateTargetUrl(u.toString());
  } catch {
    return baseUrl;
  }
}

// ============================================================================
// 4. Multi-Tier Fetcher (Direct Portal APIs + Fast TLS + Native Chrome Headless CDP)
// ============================================================================
const CHROME_T1_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Ch-Ua": '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Upgrade-Insecure-Requests": "1",
};

interface DirectApiResult {
  jobs: any[];
  handledByApi: boolean;
  hasMore: boolean;
}

async function fetchDirectPortalApiJobs(
  platformId: string,
  currentUrl: string,
  keywords: string[],
  pageNum: number,
  logs: string[]
): Promise<DirectApiResult> {
  const kwQuery = (keywords[0] || "").trim();
  const host = (() => {
    try {
      return new URL(currentUrl).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();

  // 1. JOYWORK (joywork.vn -> https://api.joywork.vn/api/jobs)
  if (platformId === "joywork" || host.includes("joywork.vn")) {
    try {
      const fetchJoyworkPage = async (qParam: string) => {
        const apiUrl = new URL("https://api.joywork.vn/api/jobs");
        apiUrl.searchParams.set("limit", "24");
        apiUrl.searchParams.set("page", String(pageNum));
        if (qParam) apiUrl.searchParams.set("q", qParam);
        const resp = await fetch(apiUrl.toString(), {
          headers: { ...CHROME_T1_HEADERS, Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return [];
        const json = (await resp.json()) as any;
        return Array.isArray(json?.data?.jobs) ? json.data.jobs : [];
      };

      // JoyWork indexes Vietnamese jobs under "tiếng nhật"; if user queried "japanese", try "kwQuery" first
      let items = await fetchJoyworkPage(kwQuery);
      if (items.length === 0 && pageNum === 1 && /^(japanese|japan)$/i.test(kwQuery)) {
        items = await fetchJoyworkPage("tiếng nhật");
      }

      if (items.length > 0) {
        logs.push(
          `[API Sniffer] JoyWork REST API returned ${items.length} job(s) on page ${pageNum}.`
        );
      }

      const mapped = items.map((it: any) => {
        const slug = it.slug || toAsciiSlug(it.title || "job");
        const jUrl = `https://joywork.vn/jobs/${slug}--${it.id}`;
        const comp =
          it.company?.name ||
          it.company?.legalName ||
          it.companyData?.name ||
          it.metadata?.companyName ||
          "Doanh nghiệp trên JoyWork";
        let sal = it.metadata?.salaryText || "";
        if (!sal) {
          if (it.salaryMin && it.salaryMax) {
            sal = `${Math.round(it.salaryMin / 1_000_000)} - ${Math.round(it.salaryMax / 1_000_000)} triệu`;
          } else if (it.salaryMax) {
            sal = `Tới ${Math.round(it.salaryMax / 1_000_000)} triệu`;
          } else {
            sal = "Thỏa thuận";
          }
        }
        const descParts = [it.generalInfo, it.mission, it.tasks, it.description].filter(Boolean).join("\n");
        const reqParts = [it.knowledge, it.skills, it.attitude, it.requirements].filter(Boolean).join("\n");
        const benParts = [it.benefitsIncome, it.benefitsPerks, it.workingTimeRanges, it.benefits]
          .filter(Boolean)
          .join("\n");
        const jdHtml = [
          descParts ? `<h2>Mô tả công việc</h2>\n${descParts}` : "",
          reqParts ? `<h2>Yêu cầu ứng viên</h2>\n${reqParts}` : "",
          benParts ? `<h2>Quyền lợi & Thu nhập</h2>\n${benParts}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");

        const plainSum = decodeHtmlEntities(
          `${descParts} ${reqParts}`.replace(/<[^>]+>/g, " ")
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 320);

        return {
          title: String(it.title || "").trim(),
          company_name: String(comp).trim(),
          salary_raw: String(sal).trim(),
          location_city: String(it.location || it.province || "Vietnam").trim(),
          url: jUrl,
          summary: plainSum || `${it.title} — ${comp}`,
          full_jd_html: jdHtml,
          extraction_method: "joywork_api",
          bypass_keyword_filter: false,
        };
      });

      return {
        jobs: mapped,
        handledByApi: true,
        hasMore: items.length >= 24,
      };
    } catch (err: any) {
      logs.push(`[API Sniffer] JoyWork API error: ${err?.message || "unknown"}`);
      return { jobs: [], handledByApi: true, hasMore: false };
    }
  }

  // 2. TOPDEV (topdev.vn -> https://api.topdev.vn/td/v2/jobs/search/v2)
  if (platformId === "topdev" || host.includes("topdev.vn")) {
    try {
      const apiUrl = new URL("https://api.topdev.vn/td/v2/jobs/search/v2");
      apiUrl.searchParams.set(
        "fields[job]",
        "id,title,slug,detail_url,company,extra_skills,skills_arr,skills_str,job_types_str,job_levels_str,salary,addresses,content,requirements,responsibilities,benefit,benefits,published,refreshed"
      );
      apiUrl.searchParams.set("keyword", kwQuery === "viec-lam" ? "" : kwQuery);
      apiUrl.searchParams.set("page", String(pageNum));
      apiUrl.searchParams.set("locale", "vi_VN");

      const resp = await fetch(apiUrl.toString(), {
        headers: { ...CHROME_T1_HEADERS, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const json = (await resp.json()) as any;
        const items = Array.isArray(json?.data) ? json.data : [];
        const lastPage = Number(json?.meta?.last_page || 1);
        if (items.length > 0) {
          logs.push(
            `[API Sniffer] TopDev Search API v2 returned ${items.length} job(s) on page ${pageNum}/${lastPage} (keyword="${kwQuery}").`
          );
        }
        const mapped = items.map((it: any) => {
          const comp =
            it.company?.display_name ||
            it.company?.name ||
            "Doanh nghiệp trên TopDev";
          let sal = String(it.salary?.value || "").trim();
          if (!sal || sal === "*") {
            const minEst = Number(it.salary?.min_estimate || 0);
            const maxEst = Number(it.salary?.max_estimate || 0);
            const cur = it.salary?.currency_estimate || it.salary?.currency || "VND";
            if (minEst > 0 && maxEst > 0) {
              sal = `${minEst} - ${maxEst} ${cur}`;
            } else {
              sal = "Thỏa thuận";
            }
          }
          const loc =
            it.addresses?.full_addresses?.[0] ||
            it.addresses?.collection_addresses?.[0] ||
            "Vietnam";
          const respHtml = it.responsibilities_original || it.responsibilities || it.content || "";
          const reqHtml = it.requirements_original || it.requirements || "";
          const benHtml =
            it.benefits_original ||
            (Array.isArray(it.benefits)
              ? it.benefits.map((b: any) => b?.value || b).filter(Boolean).join("<br>")
              : it.benefit || "");
          const jdHtml = [
            respHtml ? `<h2>Mô tả công việc</h2>\n${respHtml}` : "",
            reqHtml ? `<h2>Yêu cầu ứng viên</h2>\n${reqHtml}` : "",
            benHtml ? `<h2>Quyền lợi được hưởng</h2>\n${benHtml}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");

          const jUrl = canonicalizeJobUrl(
            it.detail_url || `https://topdev.vn/viec-lam/${it.slug || "job"}-${it.id}`
          );
          const plainSum = decodeHtmlEntities(
            `${respHtml} ${reqHtml}`.replace(/<[^>]+>/g, " ")
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 320);

          return {
            title: String(it.title || "").trim(),
            company_name: String(comp).trim(),
            salary_raw: sal,
            location_city: String(loc).trim(),
            url: jUrl,
            summary: plainSum || `${it.title} — ${comp}`,
            full_jd_html: jdHtml,
            extraction_method: "topdev_api_v2",
            bypass_keyword_filter: false,
          };
        });

        return {
          jobs: mapped,
          handledByApi: true,
          hasMore: pageNum < lastPage && items.length > 0,
        };
      }
      return { jobs: [], handledByApi: true, hasMore: false };
    } catch (err: any) {
      logs.push(`[API Sniffer] TopDev API error: ${err?.message || "unknown"}`);
      return { jobs: [], handledByApi: true, hasMore: false };
    }
  }

  // 3. VIETNAMWORKS (vietnamworks.com -> POST https://ms.vietnamworks.com/job-search/v1.0/search)
  if (platformId === "vietnamworks" || host.includes("vietnamworks.com")) {
    try {
      const resp = await fetch("https://ms.vietnamworks.com/job-search/v1.0/search", {
        method: "POST",
        headers: {
          ...CHROME_T1_HEADERS,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: 0,
          query: kwQuery === "viec-lam" ? "" : kwQuery,
          filter: [],
          ranges: [],
          order: [],
          hitsPerPage: 30,
          page: Math.max(0, pageNum - 1),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const json = (await resp.json()) as any;
        const items = Array.isArray(json?.data) ? json.data : [];
        if (items.length > 0) {
          logs.push(`[API Sniffer] VietnamWorks Search API returned ${items.length} job(s) on page ${pageNum}.`);
        }
        const mapped = items.map((it: any) => {
          const loc =
            it.workingLocations?.[0]?.cityNameVI ||
            it.workingLocations?.[0]?.cityName ||
            it.address ||
            "Vietnam";
          const jdHtml = [
            it.jobDescription ? `<h2>Mô tả công việc</h2>\n${it.jobDescription}` : "",
            it.jobRequirement ? `<h2>Yêu cầu công việc</h2>\n${it.jobRequirement}` : "",
          ]
            .filter(Boolean)
            .join("\n\n");
          return {
            title: String(it.jobTitle || "").trim(),
            company_name: String(it.companyName || "Doanh nghiệp Tuyển dụng").trim(),
            salary_raw: String(it.prettySalary || "Thỏa thuận").trim(),
            location_city: String(loc).trim(),
            url: canonicalizeJobUrl(String(it.jobUrl || currentUrl)),
            summary: String(it.jobDescription || "").replace(/<[^>]+>/g, " ").slice(0, 320),
            full_jd_html: jdHtml,
            extraction_method: "vietnamworks_api",
            bypass_keyword_filter: false,
          };
        });
        return {
          jobs: mapped,
          handledByApi: true,
          hasMore: items.length >= 30,
        };
      }
      return { jobs: [], handledByApi: true, hasMore: false };
    } catch (err: any) {
      logs.push(`[API Sniffer] VietnamWorks API error: ${err?.message || "unknown"}`);
      return { jobs: [], handledByApi: true, hasMore: false };
    }
  }

  // 4. REMOTEOK (remoteok.com -> https://remoteok.com/api)
  if (platformId === "remoteok" || host.includes("remoteok.com")) {
    if (pageNum > 1) return { jobs: [], handledByApi: true, hasMore: false };
    try {
      const resp = await fetch("https://remoteok.com/api", {
        headers: { ...CHROME_T1_HEADERS, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const rawList = (await resp.json()) as any[];
        const items = Array.isArray(rawList)
          ? rawList.filter((x) => x && (x.position || x.title) && x.url)
          : [];
        const mapped = items.map((it: any) => {
          const sal =
            it.salary_min && it.salary_max
              ? `$${it.salary_min} - $${it.salary_max}`
              : it.salary_min
              ? `$${it.salary_min}+`
              : "Negotiable";
          const tagsStr = Array.isArray(it.tags) ? it.tags.join(", ") : "";
          return {
            title: String(it.position || it.title || "").trim(),
            company_name: String(it.company || "Remote Employer").trim(),
            salary_raw: sal,
            location_city: String(it.location || "Remote").trim(),
            url: String(it.url).startsWith("http")
              ? String(it.url)
              : `https://remoteok.com${it.url}`,
            summary: `${tagsStr ? `[${tagsStr}] ` : ""}${String(it.description || "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()}`.slice(0, 320),
            full_jd_html: String(it.description || ""),
            extraction_method: "remoteok_api",
            bypass_keyword_filter: true,
          };
        });
        const matched =
          keywords.length > 0
            ? mapped.filter((j) =>
                matchesSearchKeywords(
                  { title: j.title, company_name: j.company_name, summary: j.summary, url: j.url },
                  keywords
                )
              )
            : mapped;
        const finalRemote = matched.length > 0 ? matched : mapped.slice(0, 10);
        logs.push(`[API Sniffer] RemoteOK JSON API returned ${finalRemote.length} remote job(s).`);
        return { jobs: finalRemote, handledByApi: true, hasMore: false };
      }
    } catch (err: any) {
      logs.push(`[API Sniffer] RemoteOK API error: ${err?.message || "unknown"}`);
    }
    return { jobs: [], handledByApi: true, hasMore: false };
  }

  return { jobs: [], handledByApi: false, hasMore: true };
}

// ============================================================================
// Shared Persistent Headless Chrome CDP Pool (1 Browser Process — Multi-Tab Reuse)
// ============================================================================
interface SharedChromeInstance {
  proc: any;
  debugPort: number;
  profileDir: string;
}

let sharedChrome: SharedChromeInstance | null = null;
let sharedChromeBootPromise: Promise<SharedChromeInstance | null> | null = null;
let activeChromeTabs = 0;
const MAX_CONCURRENT_CHROME_TABS = 3;
const chromeTabWaitQueue: Array<() => void> = [];

async function acquireChromeTabSlot(): Promise<void> {
  touchChromeActivity();
  if (activeChromeTabs < MAX_CONCURRENT_CHROME_TABS) {
    activeChromeTabs++;
    return;
  }
  await new Promise<void>((resolve) => chromeTabWaitQueue.push(resolve));
  touchChromeActivity();
  activeChromeTabs++;
}

function releaseChromeTabSlot(): void {
  touchChromeActivity();
  activeChromeTabs = Math.max(0, activeChromeTabs - 1);
  const next = chromeTabWaitQueue.shift();
  if (next) next();
}

function closeSharedHeadlessChrome(): void {
  if (!sharedChrome) return;
  const inst = sharedChrome;
  sharedChrome = null;
  sharedChromeBootPromise = null;
  try {
    inst.proc.kill();
  } catch {}
  activeChildProcs.delete(inst.proc);
  try {
    fs.rmSync(inst.profileDir, { recursive: true, force: true });
  } catch {}
}

async function ensureSharedHeadlessChrome(): Promise<SharedChromeInstance | null> {
  if (sharedChrome) {
    try {
      const r = await fetch(`http://127.0.0.1:${sharedChrome.debugPort}/json/version`, {
        signal: AbortSignal.timeout(800),
      });
      if (r.ok) return sharedChrome;
    } catch {
      closeSharedHeadlessChrome();
    }
  }

  if (sharedChromeBootPromise) return await sharedChromeBootPromise;

  sharedChromeBootPromise = (async () => {
    const localAppData = process.env.LOCALAPPDATA || "";
    const browserCandidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe"),
    ];
    const browserExe = browserCandidates.find((c) => c && fs.existsSync(c));
    if (!browserExe) return null;

    const debugPort = 19200 + Math.floor(Math.random() * 2500);
    const profileDir = path.join(os.tmpdir(), `CrawlJob_SharedPool_${debugPort}_${Date.now()}`);
    fs.mkdirSync(profileDir, { recursive: true });

    const proc = Bun.spawn(
      [
        browserExe,
        "--headless=new",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        "--window-size=1440,900",
        "--disable-blink-features=AutomationControlled",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-sync",
        `--user-agent=${CHROME_T1_HEADERS["User-Agent"]}`,
        "about:blank",
      ],
      { stdout: "ignore", stderr: "ignore", windowsHide: true } as any
    );
    activeChildProcs.add(proc);
    proc.exited
      .then(() => {
        activeChildProcs.delete(proc);
        if (sharedChrome?.proc === proc) sharedChrome = null;
      })
      .catch(() => {});

    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
          signal: AbortSignal.timeout(600),
        });
        if (r.ok) {
          sharedChrome = { proc, debugPort, profileDir };
          sharedChromeBootPromise = null;
          return sharedChrome;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    try {
      proc.kill();
    } catch {}
    activeChildProcs.delete(proc);
    sharedChromeBootPromise = null;
    return null;
  })();

  return await sharedChromeBootPromise;
}

async function runNativeChromeHeadlessCdp(
  targetUrl: string,
  scrollTimes: number,
  takeScreenshot: boolean,
  logs: string[]
): Promise<{
  html: string;
  tier_used: string;
  screenshot_filename: string | null;
  xhr_payloads: Array<{ url: string; data: any }>;
} | null> {
  await acquireChromeTabSlot();
  let tabId = "";
  let debugPort = 0;
  const xhrPayloads: Array<{ url: string; data: any }> = [];
  let html = "";
  let screenshotFilename: string | null = null;

  try {
    const inst = await ensureSharedHeadlessChrome();
    if (!inst) return null;
    debugPort = inst.debugPort;

    // Create a lightweight isolated tab in the warm Chrome instance (~5ms instead of ~1.5s process spawn)
    let pageWsUrl = "";
    try {
      const newTabRes = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, {
        method: "PUT",
        signal: AbortSignal.timeout(3000),
      });
      if (newTabRes.ok) {
        const tabJson = (await newTabRes.json()) as any;
        tabId = tabJson.id || "";
        pageWsUrl = tabJson.webSocketDebuggerUrl || "";
      }
    } catch {
      // fallback to GET /json/new
    }
    if (!pageWsUrl) {
      const listRes = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const list = (await listRes.json()) as any[];
      const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) {
        pageWsUrl = target.webSocketDebuggerUrl;
      }
    }
    if (!pageWsUrl) return null;

    const ws = new WebSocket(pageWsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WS timeout")), 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = (e) => {
        clearTimeout(timer);
        reject(e);
      };
    });

    let msgId = 1;
    const pending = new Map<number, (res: any) => void>();
    const jsonReqIds = new Map<string, string>();

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg.result);
          pending.delete(msg.id);
        } else if (msg.method === "Network.responseReceived") {
          const p = msg.params;
          const mime = String(p?.response?.mimeType || "").toLowerCase();
          const rUrl = String(p?.response?.url || "");
          if (
            (p?.type === "XHR" || p?.type === "Fetch") &&
            mime.includes("json") &&
            p?.response?.status === 200
          ) {
            jsonReqIds.set(p.requestId, rUrl);
          }
        } else if (msg.method === "Network.loadingFinished") {
          const reqId = msg.params?.requestId;
          if (reqId && jsonReqIds.has(reqId) && xhrPayloads.length < 25) {
            const rUrl = jsonReqIds.get(reqId)!;
            const id = msgId++;
            pending.set(id, (res) => {
              if (res?.body) {
                try {
                  const text = res.base64Encoded
                    ? Buffer.from(res.body, "base64").toString("utf8")
                    : String(res.body);
                  if (text.length > 80 && text.length < 2_500_000) {
                    xhrPayloads.push({ url: rUrl, data: JSON.parse(text) });
                  }
                } catch {}
              }
            });
            ws.send(
              JSON.stringify({
                id,
                method: "Network.getResponseBody",
                params: { requestId: reqId },
              })
            );
          }
        }
      } catch {}
    };

    const sendCmd = (method: string, params: any = {}) =>
      new Promise<any>((resolve) => {
        const id = msgId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(null);
        }, 9000);
        pending.set(id, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await sendCmd("Page.enable");
    await sendCmd("Network.enable");
    await sendCmd("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = window.chrome || { runtime: {}, loadTimes: () => {}, csi: () => {} };
      })();`,
    });

    await sendCmd("Page.navigate", { url: targetUrl });

    // Smart adaptive wait: poll every 250ms up to 1750ms; if Cloudflare verification is in progress, wait up to 3.5s for redirect
    await new Promise((r) => setTimeout(r, 750));
    for (let w = 0; w < 12; w++) {
      const stateRes = await sendCmd("Runtime.evaluate", {
        expression:
          "JSON.stringify({ a: document.querySelectorAll('a').length, t: (document.body && document.body.innerText || '').slice(0, 600) })",
        returnByValue: true,
      });
      let anchorCount = 0;
      let bodySample = "";
      try {
        const parsed = JSON.parse(String(stateRes?.result?.value || "{}"));
        anchorCount = Number(parsed.a || 0);
        bodySample = String(parsed.t || "");
      } catch {}

      const isCfWaiting =
        /additional verification required|your ray id for this request|verification successful\.?\s*waiting for|just a moment|verifying you are human/i.test(
          bodySample
        );
      if (!isCfWaiting && (anchorCount >= 40 || w >= 3)) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    // Fast scroll to trigger lazy job cards
    if (scrollTimes > 0) {
      await sendCmd("Runtime.evaluate", {
        expression: "window.scrollTo(0, document.body.scrollHeight * 0.7)",
      });
      await new Promise((r) => setTimeout(r, 350));
    }

    const domRes = await sendCmd("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    html = String(domRes?.result?.value || "");

    if (takeScreenshot) {
      const scRes = await sendCmd("Page.captureScreenshot", { format: "png" });
      if (scRes?.data) {
        screenshotFilename = `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.png`;
        fs.writeFileSync(
          path.join(SCREENSHOTS_DIR, screenshotFilename),
          Buffer.from(scRes.data, "base64")
        );
      }
    }

    ws.close();
  } catch {
    // ignore CDP error
  } finally {
    if (tabId && debugPort) {
      fetch(`http://127.0.0.1:${debugPort}/json/close/${tabId}`, {
        signal: AbortSignal.timeout(1000),
      }).catch(() => {});
    }
    releaseChromeTabSlot();
  }

  if (html && html.length > 500) {
    logs.push(
      `[Fetcher] Tier 2 Shared Chrome CDP succeeded (${html.length} chars, ${xhrPayloads.length} XHR packets).`
    );
    return {
      html,
      tier_used: "Tier 2: Shared Chrome Stealth Pool + XHR Sniffer",
      screenshot_filename: screenshotFilename,
      xhr_payloads: xhrPayloads,
    };
  }
  return null;
}

async function runPlaywrightStealthWorker(
  targetUrl: string,
  _bypassMode: string,
  scrollTimes: number,
  _settings: Record<string, string>,
  takeScreenshot: boolean,
  logs: string[]
): Promise<{
  html: string;
  tier_used: string;
  screenshot_filename: string | null;
  xhr_payloads: Array<{ url: string; data: any }>;
} | null> {
  return await runNativeChromeHeadlessCdp(targetUrl, scrollTimes, takeScreenshot, logs);
}

export function isCloudflareOrBotChallengeText(text: string): boolean {
  if (!text) return false;
  return /additional verification required|your ray id for this request|verification successful\.?\s*waiting for|troubleshooting cloudflare errors|security service to protect against|just a moment|attention required|1900 068 889|verifying you are human|enable javascript and cookies to continue/i.test(
    text
  );
}

function isAntiBotOrEmptyHtml(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (!html || html.length < 1800) return true;

  // Check <title> first so large SSR pages (like TopCV 1.8MB HTTP 200) aren't falsely flagged by footer scripts
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = (titleMatch ? titleMatch[1] : "").trim();
  if (
    /Just a moment|Attention Required|Additional Verification Required|Glints - Firewall|Security Check|Access Denied/i.test(
      pageTitle
    )
  ) {
    return true;
  }

  if (
    html.length < 45000 &&
    /cf-browser-verification|Just a moment\.\.\.|Attention Required! \| Cloudflare|Additional Verification Required|Your Ray ID for this request|Troubleshooting Cloudflare Errors|Glints - Firewall|enable JavaScript and cookies to continue/i.test(
      html
    )
  ) {
    return true;
  }
  return false;
}

async function smartFetchUrl(
  targetUrl: string,
  bypassMode: string,
  scrollTimes: number,
  settings: Record<string, string>,
  takeScreenshot: boolean
): Promise<{
  html: string;
  tier_used: string;
  screenshot_filename: string | null;
  xhr_payloads: Array<{ url: string; data: any }>;
  logs: string[];
}> {
  const logs: string[] = [`[Fetcher] Target: ${targetUrl} (Mode: ${bypassMode})`];

  // Explicit Tier 2: Playwright Stealth / Chrome CDP
  if (bypassMode === "stealth_browser" || bypassMode === "chrome_cdp") {
    const pwRes = await runPlaywrightStealthWorker(
      targetUrl,
      bypassMode,
      scrollTimes,
      settings,
      takeScreenshot,
      logs
    );
    if (pwRes) {
      return { ...pwRes, logs };
    }
  }

  // Tier 1: High-Speed Browser Impersonation Fetch
  const headers: Record<string, string> = { ...CHROME_T1_HEADERS };
  if (settings.custom_cookie_header) {
    headers["Cookie"] = settings.custom_cookie_header;
  }

  try {
    const resp = await fetch(targetUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    const html = await resp.text();
    logs.push(`[Fetcher] Tier 1 Fast TLS Fetch (HTTP ${resp.status}, ${html.length} chars).`);

    // Auto-Cascade to Tier 2 Shared Chrome Stealth if blocked by anti-bot / Cloudflare
    if (bypassMode === "auto" && isAntiBotOrEmptyHtml(resp.status, html)) {
      logs.push(
        `[Fetcher] Anti-bot challenge or firewall detected -> Cascading to Tier 2 Shared Chrome Stealth...`
      );
      const pwRes = await runPlaywrightStealthWorker(
        targetUrl,
        "stealth_browser",
        scrollTimes,
        settings,
        takeScreenshot,
        logs
      );
      if (pwRes) {
        return { ...pwRes, logs };
      }
    }

    return {
      html,
      tier_used: "Tier 1: Fast Chrome TLS Fetch",
      screenshot_filename: null,
      xhr_payloads: [],
      logs,
    };
  } catch (err: any) {
    logs.push(`[Fetcher] Tier 1 error (${err?.message || "network"}) -> Trying Tier 2 Stealth...`);
    if (bypassMode === "auto") {
      const pwRes = await runPlaywrightStealthWorker(
        targetUrl,
        "stealth_browser",
        scrollTimes,
        settings,
        takeScreenshot,
        logs
      );
      if (pwRes) return { ...pwRes, logs };
    }
    return {
      html: "",
      tier_used: "Failed",
      screenshot_filename: null,
      xhr_payloads: [],
      logs,
    };
  }
}

// ============================================================================
// 5. Execute 6-Node Pipeline (Turbo Multi-Domain Parallel Execution)
// ============================================================================
const NODE_DEFS = [
  ["node_1_input", "1. Input & Multi-Site Discovery"],
  ["node_2_bypass", "2. Multi-Tier Unattended Bypass"],
  ["node_3_sniffer", "3. Network & Hidden State Sniffer"],
  ["node_4_extractor", "4. AI Self-Healing & Recipe Extractor"],
  ["node_5_deep_queue", "5. 2-Phase Deep Crawl Queue"],
  ["node_6_sink", "6. Filter, Dedup & Notification Sink"],
];

function updateNodeLog(
  runId: number,
  nodeId: string,
  status: string,
  durationMs: number,
  inputObj: any,
  outputObj: any,
  logs: string[],
  screenshot: string | null = null,
  markdown: string | null = null
) {
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE pipeline_node_logs
     SET status = ?, duration_ms = ?, input_json = ?, output_json = ?, logs_text = ?,
         screenshot_filename = COALESCE(?, screenshot_filename),
         markdown_preview = COALESCE(?, markdown_preview),
         updated_at = ?
     WHERE crawl_run_id = ? AND node_id = ?`
  ).run(
    status,
    durationMs,
    JSON.stringify(inputObj, null, 2),
    JSON.stringify(outputObj, null, 2),
    logs.join("\n"),
    screenshot,
    markdown ? markdown.slice(0, 15000) : null,
    nowIso,
    runId,
    nodeId
  );

  broadcastSseEvent("node_updated", {
    run_id: runId,
    node_id: nodeId,
    status,
    duration_ms: durationMs,
    updated_at: nowIso,
  });
}

interface TargetTask {
  url: string;
  keywords: string[];
  platformId: string;
}

function detectPlatformIdFromHostname(hostname: string): string {
  const h = (hostname || "").toLowerCase().replace(/^www\./, "");
  if (h.includes("itviec.com")) return "itviec";
  if (h.includes("topcv.vn")) return "topcv";
  if (h.includes("careerviet.vn")) return "careerviet";
  if (h.includes("careerlink.vn")) return "careerlink";
  if (h.includes("jobsgo.vn")) return "jobsgo";
  if (h.includes("viecoi.vn")) return "viecoi";
  if (h.includes("indeed.com")) return "indeed";
  if (h.includes("linkedin.com")) return "linkedin";
  if (h.includes("joywork.vn")) return "joywork";
  if (h.includes("cvwork.vn")) return "cvwork";
  if (h.includes("xemviec.com")) return "xemviec";
  if (h.includes("joboko.com")) return "joboko";
  if (h.includes("vietnamworks.com")) return "vietnamworks";
  if (h.includes("glints.com")) return "glints";
  if (h.includes("topdev.vn")) return "topdev";
  if (h.includes("remoteok.com")) return "remoteok";
  if (h.includes("vieclam24h.vn")) return "vieclam24h";
  if (h.includes("123job.vn")) return "job123";
  if (h.includes("devwork.vn")) return "devwork";
  if (h.includes("iconicjob.vn")) return "iconicjob";

  const customMatch = db
    .query("SELECT id FROM custom_portals WHERE domain = ? LIMIT 1")
    .get(h) as any;
  if (customMatch && customMatch.id) {
    return String(customMatch.id);
  }
  return "custom";
}

function deduplicateTargetTasks(rawTasks: TargetTask[]): TargetTask[] {
  const byUrl = new Map<string, TargetTask>();
  for (const t of rawTasks) {
    const existing = byUrl.get(t.url);
    if (existing) {
      for (const kw of t.keywords) {
        if (!existing.keywords.includes(kw)) existing.keywords.push(kw);
      }
    } else {
      byUrl.set(t.url, {
        url: t.url,
        keywords: [...t.keywords],
        platformId: t.platformId,
      });
    }
  }
  return Array.from(byUrl.values());
}

async function runPipelineAsync(runId: number, body: any) {
  registerRunController(runId);
  const settingsRows = db.query("SELECT key, value FROM app_settings").all() as any[];
  const settings: Record<string, string> = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const cfg = body.node_config || {};
  const rawMaxPages = Number(cfg.max_pages ?? 0);
  // max_pages === 0 means "Cào hết" (Smart Auto-All: up to 5 high-yield pages per keyword/portal)
  const effectiveMaxPages = rawMaxPages <= 0 ? 5 : Math.min(20, rawMaxPages);
  const paginationModeLabel =
    rawMaxPages <= 0
      ? `Turbo Auto-All (tối đa ${effectiveMaxPages} trang/từ khóa · 6 sàn song song)`
      : `${effectiveMaxPages} trang/sàn (6 sàn song song)`;
  const t1Start = Date.now();

  try {
    // NODE 1: Input Discovery (Global Keyword + Per-Site Keyword/URL Overrides)
    const rawTargetTasks: TargetTask[] = [];
    const node1Details: string[] = [];
    if (body.mode === "keyword_search") {
      const globalKw = (body.keyword || "viec-lam").trim();
      const loc = (body.location || "Vietnam").trim();
      const kwOverrides: Record<string, string> = body.platform_keywords || {};
      const urlOverrides: Record<string, string> = body.platform_urls || {};
      const selectedPids: string[] =
        body.platforms && body.platforms.length > 0
          ? body.platforms
          : [
              "itviec",
              "topcv",
              "careerviet",
              "careerlink",
              "jobsgo",
              "viecoi",
              "indeed",
              "linkedin",
              "joywork",
              "cvwork",
              "xemviec",
              "joboko",
              "vietnamworks",
              "glints",
              "topdev",
              "remoteok",
              "vieclam24h",
              "job123",
              "devwork",
              "iconicjob",
            ];

      for (const pid of selectedPids) {
        const customUrl = (urlOverrides[pid] || "").trim();
        const rawKwExpr = (kwOverrides[pid] || globalKw || "viec-lam").trim();
        const kwParts = rawKwExpr
          .split(/[,;]+/)
          .map((s: string) => s.trim())
          .filter(Boolean);
        const effectiveKwList = kwParts.length > 0 ? kwParts : ["viec-lam"];

        if (customUrl) {
          const rawResolved = customUrl.startsWith("http")
            ? customUrl
            : `https://${customUrl}`;
          const safeUrl = validateTargetUrl(rawResolved);
          rawTargetTasks.push({ url: safeUrl, keywords: effectiveKwList, platformId: pid });
          node1Details.push(`  + [${pid.toUpperCase()}] (Custom URL, Keywords: ${effectiveKwList.join(", ")}) -> ${safeUrl}`);
        } else {
          for (const singleKw of effectiveKwList) {
            const rawResolved = buildPlatformSearchUrl(pid, singleKw, loc);
            const safeUrl = validateTargetUrl(rawResolved);
            rawTargetTasks.push({ url: safeUrl, keywords: [singleKw], platformId: pid });
            node1Details.push(`  + [${pid.toUpperCase()}] (Keyword: "${singleKw}") -> ${safeUrl}`);
          }
        }
      }
    } else {
      const loc = (body.location || "Vietnam").trim();
      const optionalKw = (body.keyword || "")
        .split(/[,;]+/)
        .map((s: string) => s.trim())
        .filter(Boolean);

      for (const rawInputUrl of body.urls || []) {
        const trimmed = String(rawInputUrl || "").trim();
        if (!trimmed) continue;
        const normalizedUrl = /^https?:\/\//i.test(trimmed)
          ? trimmed
          : `https://${trimmed}`;
        const u = validateTargetUrl(normalizedUrl);
        const parsed = new URL(u);
        const detectedPid = detectPlatformIdFromHostname(parsed.hostname);
        const isRootDomainOnly =
          (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search;

        if (isRootDomainOnly && optionalKw.length > 0) {
          if (detectedPid !== "custom") {
            for (const singleKw of optionalKw) {
              const rawResolved = buildPlatformSearchUrl(detectedPid, singleKw, loc);
              const safeUrl = validateTargetUrl(rawResolved);
              rawTargetTasks.push({
                url: safeUrl,
                keywords: [singleKw],
                platformId: detectedPid,
              });
              node1Details.push(
                `  + [${detectedPid.toUpperCase()}] (Auto-Search "${singleKw}" từ trang chủ) -> ${safeUrl}`
              );
            }
          } else {
            for (const singleKw of optionalKw) {
              const searchUrl = new URL(u);
              searchUrl.searchParams.set("q", singleKw);
              const safeUrl = validateTargetUrl(searchUrl.toString());
              rawTargetTasks.push({
                url: safeUrl,
                keywords: [singleKw],
                platformId: "custom",
              });
              node1Details.push(
                `  + [CUSTOM] (Auto-Query "${singleKw}") -> ${safeUrl}`
              );
            }
          }
        } else {
          rawTargetTasks.push({
            url: u,
            keywords: optionalKw,
            platformId: detectedPid,
          });
          node1Details.push(
            `  + [${detectedPid.toUpperCase()}] ${u}${
              optionalKw.length > 0 ? ` (Lọc từ khóa: ${optionalKw.join(", ")})` : ""
            }`
          );
        }
      }
    }

    const targetTasks = deduplicateTargetTasks(rawTargetTasks);
    const targetUrls = targetTasks.map((t) => t.url);
    updateNodeLog(
      runId,
      "node_1_input",
      "success",
      Date.now() - t1Start,
      body,
      { resolved_urls: targetUrls, pagination_mode: paginationModeLabel },
      [
        `[Node 1] Prepared ${targetTasks.length} unique target(s) · Chế độ: ${paginationModeLabel}:`,
        ...node1Details,
      ]
    );

    const allRawJobs: any[] = [];
    const node2Logs: string[] = [];
    const node3Logs: string[] = [];
    const node4Logs: string[] = [];
    let lastScreenshot: string | null = null;
    let lastMarkdown = "";
    let totalPagesFetched = 0;
    const t2Start = Date.now();

    // Group tasks by domain so different portals execute in parallel (CONCURRENCY = 6 domains),
    // while tasks targeting the same domain share deduplication state and run politely in sequence.
    const domainTaskGroups = new Map<string, TargetTask[]>();
    for (const task of targetTasks) {
      const dom = new URL(task.url).hostname.replace(/^www\./, "");
      const list = domainTaskGroups.get(dom) || [];
      list.push(task);
      domainTaskGroups.set(dom, list);
    }

    const domainEntries = Array.from(domainTaskGroups.entries());
    let domainCursor = 0;
    const DOMAIN_CONCURRENCY = Math.min(6, Math.max(1, domainEntries.length));

    const processDomainGroup = async (domain: string, tasksForDomain: TargetTask[], isFirstDomain: boolean) => {
      const seenDomainJobUrls = new Set<string>();
      const visitedDomainPageUrls = new Set<string>();
      let preferStealthForDomain = false;

      for (let tIdx = 0; tIdx < tasksForDomain.length; tIdx++) {
        if (isRunCancelled(runId)) break;
        const task = tasksForDomain[tIdx];
        const baseUrl = task.url;
        let currentPageUrl: string | null = baseUrl;

        for (let pageNum = 1; pageNum <= effectiveMaxPages; pageNum++) {
          if (isRunCancelled(runId)) break;
          if (!currentPageUrl || visitedDomainPageUrls.has(currentPageUrl)) break;
          visitedDomainPageUrls.add(currentPageUrl);
          totalPagesFetched++;

          updateNodeLog(
            runId,
            "node_2_bypass",
            "running",
            Date.now() - t2Start,
            { urls: targetUrls },
            { pages_fetched: totalPagesFetched },
            [
              ...node2Logs.slice(-10),
              `[Node 2] Fetching ${domain} (Trang ${pageNum}): ${currentPageUrl}...`,
            ]
          );

          // 1. Fast Direct JSON API path (JoyWork, VietnamWorks, RemoteOK)
          const apiRes = await fetchDirectPortalApiJobs(
            task.platformId,
            currentPageUrl,
            task.keywords,
            pageNum,
            node2Logs
          );

          const cleanDomKey = domain.toLowerCase().replace(/^www\./, "");
          const activeRecipe =
            cfg.enable_recipe_cache !== false
              ? (db
                  .query(
                    "SELECT * FROM domain_recipes WHERE is_active = 1 AND (domain = ? OR ? LIKE '%' || domain) LIMIT 1"
                  )
                  .get(cleanDomKey, cleanDomKey) as any)
              : null;

          let rawCandidates: any[] = [];
          let fResHtml = "";

          if (apiRes.handledByApi) {
            rawCandidates = apiRes.jobs;
            if (rawCandidates.length > 0) {
              node3Logs.push(
                `[Node 3] ${domain} (Trang ${pageNum}): Extracted ${rawCandidates.length} structured API job(s) with full JD.`
              );
            }
          } else {
            const pageBypassMode = preferStealthForDomain
              ? "stealth_browser"
              : cfg.bypass_mode || "auto";

            const shouldTakeScreenshot = isFirstDomain && tIdx === 0 && pageNum === 1;
            let fRes = await smartFetchUrl(
              currentPageUrl,
              pageBypassMode,
              cfg.scroll_times ?? 1,
              settings,
              shouldTakeScreenshot
            );

            // Node 3: Sniff XHR Payloads + JSON-LD / __NEXT_DATA__
            let xhrJobs = extractJobsFromXhrPayloads(fRes.xhr_payloads || [], currentPageUrl);
            let sniffed = [...xhrJobs, ...sniffStructuredJobsFromHtml(fRes.html, currentPageUrl)];
            let recipeJobs =
              sniffed.length === 0 && activeRecipe
                ? extractJobsUsingDomainRecipe(fRes.html, currentPageUrl, activeRecipe)
                : [];
            let heur =
              sniffed.length === 0 ? extractHeuristicJobsFromHtml(fRes.html, currentPageUrl) : [];

            // If 0 jobs found on Tier 1 on Page 1 and bypass_mode === 'auto', cascade to Shared Chrome Stealth Pool
            if (
              pageNum === 1 &&
              sniffed.length === 0 &&
              recipeJobs.length === 0 &&
              heur.length === 0 &&
              (cfg.bypass_mode === "auto" || !cfg.bypass_mode) &&
              fRes.tier_used.includes("Tier 1")
            ) {
              fRes.logs.push(
                `[Fetcher] 0 job cards in static HTML for ${domain} -> Cascading to Tier 2 Shared Chrome Stealth...`
              );
              const pwRes = await runPlaywrightStealthWorker(
                currentPageUrl,
                "stealth_browser",
                cfg.scroll_times ?? 1,
                settings,
                shouldTakeScreenshot,
                fRes.logs
              );
              if (pwRes && pwRes.html) {
                fRes = { ...pwRes, logs: fRes.logs };
                xhrJobs = extractJobsFromXhrPayloads(fRes.xhr_payloads || [], currentPageUrl);
                sniffed = [...xhrJobs, ...sniffStructuredJobsFromHtml(fRes.html, currentPageUrl)];
                recipeJobs =
                  sniffed.length === 0 && activeRecipe
                    ? extractJobsUsingDomainRecipe(fRes.html, currentPageUrl, activeRecipe)
                    : [];
                heur =
                  sniffed.length === 0
                    ? extractHeuristicJobsFromHtml(fRes.html, currentPageUrl)
                    : [];
              }
            }

            if (!fRes.tier_used.includes("Tier 1") && fRes.tier_used !== "Failed") {
              preferStealthForDomain = true;
            }

            node2Logs.push(...fRes.logs);
            if (fRes.screenshot_filename) lastScreenshot = fRes.screenshot_filename;

            fResHtml = fRes.html;
            const md = htmlToCleanMarkdown(fRes.html, currentPageUrl);
            if (md) lastMarkdown = md;

            if (sniffed.length > 0) {
              rawCandidates = sniffed;
              node3Logs.push(
                `[Node 3] ${domain} (Trang ${pageNum}): Extracted ${sniffed.length} structured JSON-LD / XHR State job(s).`
              );
            } else if (recipeJobs.length > 0) {
              // Merge recipeJobs first so custom CSS selector fields win, then append any additional heuristic cards
              const byUrl = new Map<string, any>();
              for (const rj of recipeJobs) byUrl.set(rj.url, rj);
              for (const hj of heur) {
                if (!byUrl.has(hj.url)) byUrl.set(hj.url, hj);
              }
              rawCandidates = Array.from(byUrl.values());
              node3Logs.push(
                `[Node 3] ${domain} (Trang ${pageNum}): Applied CSS Recipe '${activeRecipe.recipe_name}' (${recipeJobs.length} recipe hits, ${rawCandidates.length} total cards).`
              );
            } else {
              rawCandidates = heur;
              node3Logs.push(
                `[Node 3] ${domain} (Trang ${pageNum}): Cleaned HTML to Markdown (${md.length} chars).`
              );
            }
          }

          // Smart Auto-Stop #1: Empty page
          if (rawCandidates.length === 0) {
            node4Logs.push(
              `[Pagination] ${domain} (Trang ${pageNum}): 0 job cards -> Đã lấy hết phân trang.`
            );
            break;
          }

          if (activeRecipe && rawCandidates.length > 0) {
            try {
              db.prepare(
                "UPDATE domain_recipes SET success_count = success_count + 1, last_healed_at = ? WHERE id = ?"
              ).run(new Date().toISOString(), activeRecipe.id);
            } catch {
              // ignore telemetry error
            }
          }

          // Deduplicate against previous pages of the same domain
          const uniquePageCandidates: any[] = [];
          for (const cand of rawCandidates) {
            const cUrl = (cand.url || "").trim();
            if (!cUrl || seenDomainJobUrls.has(cUrl)) continue;
            seenDomainJobUrls.add(cUrl);
            uniquePageCandidates.push(cand);
          }

          // Smart Auto-Stop #2: Page N yielded < 3 new unique jobs (pagination wrapped or static explore page)
          if (pageNum > 1 && uniquePageCandidates.length < 3) {
            node4Logs.push(
              `[Pagination] ${domain} (Trang ${pageNum}): Chỉ có ${uniquePageCandidates.length} card mới -> Tự động dừng phân trang sớm.`
            );
            if (uniquePageCandidates.length === 0) break;
          }

          let filteredPageJobs = uniquePageCandidates;
          if (task.keywords.length > 0) {
            const strictMatched = uniquePageCandidates.filter(
              (job) => job.bypass_keyword_filter || matchesSearchKeywords(job, task.keywords)
            );
            // Keep only strict keyword matches so unrelated sidebar/recommended jobs are never mixed in
            filteredPageJobs = strictMatched;
          }

          node4Logs.push(
            `[Node 4] ${domain} (Trang ${pageNum}): ${uniquePageCandidates.length} new card(s) -> ${filteredPageJobs.length} kept (${
              task.keywords.join(", ") || "all"
            }).`
          );

          for (const pj of filteredPageJobs) {
            pj.source_domain = domain;
            pj.searched_keywords = task.keywords;
            allRawJobs.push(pj);
          }

          // Stop immediately if API signaled no more pages, or if page 2+ had < 3 new cards or 0 matched cards
          if (
            (apiRes.handledByApi && !apiRes.hasMore) ||
            (pageNum > 1 && (uniquePageCandidates.length < 3 || filteredPageJobs.length === 0))
          ) {
            break;
          }

          if (pageNum < effectiveMaxPages && task.platformId !== "remoteok") {
            const domNext = discoverNextPageUrlFromHtml(fResHtml, currentPageUrl, pageNum + 1);
            currentPageUrl = domNext || buildPaginatedUrl(baseUrl, task.platformId, pageNum + 1);
          } else {
            currentPageUrl = null;
          }
        }
      }
    };

    // Execute up to 6 domain queues concurrently
    const workers = Array.from({ length: DOMAIN_CONCURRENCY }, async () => {
      while (domainCursor < domainEntries.length && !isRunCancelled(runId)) {
        const idx = domainCursor++;
        const [domain, tasksForDomain] = domainEntries[idx];
        await processDomainGroup(domain, tasksForDomain, idx === 0);
      }
    });
    await Promise.all(workers);
    closeSharedHeadlessChrome();

    const elapsed = Date.now() - t2Start;
    updateNodeLog(
      runId,
      "node_2_bypass",
      "success",
      elapsed,
      { urls: targetUrls },
      { fetched_urls: totalPagesFetched },
      node2Logs,
      lastScreenshot
    );
    updateNodeLog(
      runId,
      "node_3_sniffer",
      "success",
      120,
      { urls: targetUrls },
      { markdown_chars: lastMarkdown.length },
      node3Logs,
      null,
      lastMarkdown
    );
    updateNodeLog(
      runId,
      "node_4_extractor",
      "success",
      180,
      { urls: targetUrls },
      { total_extracted: allRawJobs.length, pages_crawled: totalPagesFetched, sample: allRawJobs.slice(0, 5) },
      node4Logs
    );

    // NODE 6: Filter Blacklist, Normalize & Save (Single Atomic Batch Transaction)
    const rules = db.query("SELECT * FROM filter_rules WHERE is_active = 1").all() as any[];
    let savedCount = 0;
    let dupCount = 0;
    let blockedCount = 0;
    const pendingByDomain = new Map<string, number[]>();
    const nowIso = new Date().toISOString();

    const insertJob = db.prepare(`
      INSERT INTO job_posts (
        url, url_hash, dedup_signature, source_domain, crawl_run_id, deep_crawl_status,
        title, company_name, location_city, work_mode, seniority,
        salary_raw, salary_min, salary_max, salary_currency, salary_vnd_normalized, is_negotiable,
        skills_json, summary, full_jd_markdown, full_jd_html,
        hr_name, hr_email, hr_phone, apply_url, company_size,
        status, is_highlighted, matched_keywords_json, extraction_method, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        'new', ?, ?, ?, ?, ?
      )
    `);

    const checkExistingStmt = db.prepare(
      "SELECT id, company_name, summary, CASE WHEN LENGTH(full_jd_markdown) >= 160 THEN LENGTH(full_jd_markdown) ELSE 0 END AS jd_len, deep_crawl_status FROM job_posts WHERE url_hash = ? OR dedup_signature = ? LIMIT 1"
    );
    const updateExistingStmt = db.prepare(
      `UPDATE job_posts
       SET crawl_run_id = ?,
           company_name = CASE WHEN ? THEN ? ELSE company_name END,
           full_jd_markdown = CASE WHEN ? THEN ? ELSE full_jd_markdown END,
           summary = CASE WHEN ? THEN ? ELSE summary END,
           deep_crawl_status = ?,
           updated_at = ?
       WHERE id = ?`
    );

    const saveBatchTransaction = db.transaction((rawJobsBatch: any[]) => {
      for (const rj of rawJobsBatch) {
        const title = (rj.title || "").trim();
        const jUrl = canonicalizeJobUrl((rj.url || "").trim());
        if (!title || !jUrl) continue;

        const comp = (rj.company_name || "Unknown Company").trim();
        const combinedLower = `${title} ${comp}`.toLowerCase();

        // Check Filter Rules
        let blocked = false;
        const matchedWl: string[] = [];
        for (const rule of rules) {
          const pat = (rule.pattern || "").toLowerCase().trim();
          if (!pat) continue;
          if (
            rule.rule_type === "company_blacklist" &&
            (comp.toLowerCase().includes(pat) || jUrl.toLowerCase().includes(pat))
          ) {
            blocked = true;
            break;
          }
          if (rule.rule_type === "keyword_exclude" && combinedLower.includes(pat)) {
            blocked = true;
            break;
          }
          if (rule.rule_type === "keyword_whitelist" && combinedLower.includes(pat)) {
            matchedWl.push(rule.pattern);
          }
        }
        if (blocked) {
          blockedCount++;
          continue;
        }

        const normDomain = (rj.source_domain || "unknown").toLowerCase().trim();
        const urlHash = crypto.createHash("sha256").update(jUrl).digest("hex");
        const dedupSig = crypto
          .createHash("sha256")
          .update(
            `${normDomain}::${comp.toLowerCase().replace(/\W+/g, "")}::${title.toLowerCase().replace(/\W+/g, "")}`
          )
          .digest("hex");

        const rawJdMd = rj.full_jd_html ? htmlToCleanMarkdown(rj.full_jd_html, jUrl) : "";
        const jdMd = isCloudflareOrBotChallengeText(rawJdMd) ? "" : rawJdMd;
        const hasFullJd = jdMd.length > 200;

        const exists = checkExistingStmt.get(urlHash, dedupSig) as any;

        if (exists) {
          dupCount++;
          const existingJdLen = Number(exists.jd_len || 0);
          const shouldUpdateJd = hasFullJd && jdMd.length > existingJdLen;
          const shouldUpdateComp =
            comp &&
            comp !== "Unknown Company" &&
            (!exists.company_name ||
              exists.company_name === "Unknown Company" ||
              exists.company_name.startsWith("Doanh nghiệp"));
          const nextStatus =
            shouldUpdateJd || existingJdLen >= 160
              ? "completed"
              : cfg.enable_deep_crawl !== false
              ? "pending"
              : exists.deep_crawl_status;

          updateExistingStmt.run(
            runId,
            shouldUpdateComp ? 1 : 0,
            comp,
            shouldUpdateJd ? 1 : 0,
            jdMd,
            shouldUpdateJd ? 1 : 0,
            jdMd.slice(0, 350),
            nextStatus,
            nowIso,
            exists.id
          );

          if (nextStatus === "pending") {
            const list = pendingByDomain.get(normDomain) || [];
            if (!list.includes(Number(exists.id))) {
              list.push(Number(exists.id));
              pendingByDomain.set(normDomain, list);
            }
          }
          continue;
        }

        const sal = normalizeSalary(rj.salary_raw);
        const skills = extractSkills(`${title} ${rj.full_jd_html || ""}`);
        const contacts = extractHrContacts(`${rj.full_jd_html || ""}`);
        const workMode = /remote|từ xa/i.test(`${title} ${rj.location_city}`)
          ? "Remote"
          : /hybrid/i.test(`${title} ${rj.location_city}`)
          ? "Hybrid"
          : "Onsite";
        const seniority = /intern|thực tập/i.test(title)
          ? "Intern"
          : /junior|fresher/i.test(title)
          ? "Junior"
          : /lead|principal|architect/i.test(title)
          ? "Lead"
          : /senior|sr\b/i.test(title)
          ? "Senior"
          : "Mid-Level";

        const isIndeedCard = normDomain.includes("indeed.com");
        const finalJdMd =
          hasFullJd
            ? jdMd
            : isIndeedCard
            ? buildCleanFallbackJdMarkdown({
                title,
                company_name: comp,
                location_city: rj.location_city || "Vietnam",
                work_mode: workMode,
                seniority,
                salary_raw: sal.salary_raw,
                summary: rj.summary,
                skills_json: JSON.stringify(skills),
                source_domain: normDomain,
                url: jUrl,
              })
            : jdMd;
        const deepStatus =
          hasFullJd || isIndeedCard
            ? "completed"
            : cfg.enable_deep_crawl !== false
            ? "pending"
            : "skipped";
        const summaryText = (finalJdMd || rj.summary || "").slice(0, 350);

        const res = insertJob.run(
          jUrl,
          urlHash,
          dedupSig,
          normDomain,
          runId,
          deepStatus,
          title,
          comp,
          rj.location_city || "Vietnam",
          workMode,
          seniority,
          sal.salary_raw,
          sal.salary_min,
          sal.salary_max,
          sal.salary_currency,
          sal.salary_vnd_normalized,
          sal.is_negotiable,
          JSON.stringify(skills),
          summaryText,
          finalJdMd,
          "",
          contacts.hr_name,
          contacts.hr_email,
          contacts.hr_phone,
          jUrl,
          contacts.company_size,
          matchedWl.length > 0 ? 1 : 0,
          JSON.stringify(matchedWl),
          rj.extraction_method || "heuristic",
          nowIso,
          nowIso
        );
        savedCount++;
        if (deepStatus === "pending") {
          const list = pendingByDomain.get(normDomain) || [];
          list.push(Number(res.lastInsertRowid));
          pendingByDomain.set(normDomain, list);
        }
      }
    });

    saveBatchTransaction(allRawJobs);

    // Build round-robin Phase 2 queue across all domains so every portal gets enriched fairly
    const phase2Ids: number[] = [];
    const maxDeepItems = Math.max(60, Number(cfg.deep_crawl_max_items || 60));
    const domainQueues = Array.from(pendingByDomain.values());
    let addedInRound = true;
    while (phase2Ids.length < maxDeepItems && addedInRound) {
      addedInRound = false;
      for (const q of domainQueues) {
        if (q.length > 0 && phase2Ids.length < maxDeepItems) {
          const nextId = q.shift()!;
          phase2Ids.push(nextId);
          addedInRound = true;
        }
      }
    }

    const finalRunStatus = isRunCancelled(runId) ? "cancelled" : "completed";
    db.prepare(
      `UPDATE crawl_runs
       SET status = ?, total_found = ?, new_jobs_saved = ?, duplicates_skipped = ?,
           blocked_by_filter = ?, deep_crawl_total = ?, finished_at = ?
       WHERE id = ?`
    ).run(finalRunStatus, allRawJobs.length, savedCount, dupCount, blockedCount, phase2Ids.length, nowIso, runId);

    updateNodeLog(
      runId,
      "node_6_sink",
      "success",
      95,
      { raw_candidates: allRawJobs.length },
      { new_jobs_saved: savedCount, duplicates_skipped: dupCount, blocked_by_filter: blockedCount },
      [
        `[Node 6] Atomic Batch Tx: Saved ${savedCount} new job(s), updated/merged ${dupCount} existing job(s), blocked ${blockedCount} blacklisted item(s).`,
      ]
    );

    broadcastSseEvent("run_updated", {
      run_id: runId,
      status: finalRunStatus,
      new_jobs_saved: savedCount,
      total_found: allRawJobs.length,
    });

    // NODE 5: Phase 2 Background Deep Crawl (Parallel Worker Pool across portals)
    if (phase2Ids.length > 0 && !isRunCancelled(runId)) {
      updateNodeLog(
        runId,
        "node_5_deep_queue",
        "running",
        50,
        { queued_job_ids: phase2Ids },
        { completed: 0, total: phase2Ids.length },
        [`[Node 5] Starting parallel Phase 2 Deep Crawl (5 workers) for ${phase2Ids.length} job(s) across portals...`]
      );
      (async () => {
        try {
          const p2Start = Date.now();
          let done = 0;
          let idxCursor = 0;
          const p2Logs: string[] = [];
          const P2_CONCURRENCY = Math.min(5, phase2Ids.length);

          const p2Workers = Array.from({ length: P2_CONCURRENCY }, async () => {
            while (idxCursor < phase2Ids.length && !isRunCancelled(runId)) {
              const jid = phase2Ids[idxCursor++];
              const ok = await enrichJobById(jid, settings);
              done++;
              p2Logs.push(
                `  ${ok ? "✓" : "○"} [${done}/${phase2Ids.length}] ${
                  ok ? "Enriched Full Offline JD & HR Contacts" : "Kept card summary"
                } for Job #${jid}`
              );
              db.prepare("UPDATE crawl_runs SET deep_crawl_completed = ? WHERE id = ?").run(done, runId);
              updateNodeLog(
                runId,
                "node_5_deep_queue",
                done >= phase2Ids.length ? "success" : "running",
                Date.now() - p2Start,
                { queued_job_ids: phase2Ids },
                { completed: done, total: phase2Ids.length },
                p2Logs.slice(-30)
              );
              await new Promise((r) => setTimeout(r, 150));
            }
          });
          await Promise.all(p2Workers);
          closeSharedHeadlessChrome();
          broadcastSseEvent("run_updated", {
            run_id: runId,
            status: "deep_crawl_finished",
            deep_crawl_completed: done,
          });
        } catch (p2Err: any) {
          console.error("[Phase 2 Deep Crawl Guard]:", p2Err?.message || p2Err);
        } finally {
          cleanupRunController(runId);
          pruneOldRunsAndScreenshots(50);
        }
      })();
    } else {
      updateNodeLog(
        runId,
        "node_5_deep_queue",
        "success",
        15,
        {},
        { queued: 0 },
        ["[Node 5] All jobs enriched or no additional deep crawl required."]
      );
      cleanupRunController(runId);
      pruneOldRunsAndScreenshots(50);
    }
  } catch (err: any) {
    db.prepare("UPDATE crawl_runs SET status = 'failed', error_message = ?, finished_at = ? WHERE id = ?").run(
      String(err?.message || err),
      new Date().toISOString(),
      runId
    );
    broadcastSseEvent("run_updated", {
      run_id: runId,
      status: "failed",
      error_message: String(err?.message || err),
    });
    cleanupRunController(runId);
  }
}

export function buildCleanFallbackJdMarkdown(job: {
  title?: string;
  company_name?: string;
  location_city?: string;
  work_mode?: string;
  seniority?: string;
  salary_raw?: string;
  summary?: string;
  skills_json?: string;
  source_domain?: string;
  url?: string;
}): string {
  const title = String(job.title || "Vị trí Tuyển dụng").trim();
  const company = String(job.company_name || "Doanh nghiệp Tuyển dụng").trim();
  const location = String(job.location_city || "Việt Nam").trim();
  const workMode = String(job.work_mode || "Onsite").trim();
  const seniority = String(job.seniority || "Mid-Level").trim();
  const salary = String(job.salary_raw || "Thỏa thuận").trim();
  const domain = String(job.source_domain || "indeed.com").trim();
  const rawSummary = String(job.summary || "").trim();
  const cleanSummary =
    rawSummary && !isCloudflareOrBotChallengeText(rawSummary)
      ? rawSummary
      : `Cơ hội nghề nghiệp vị trí **${title}** tại **${company}** khu vực **${location}**.`;

  let skillsList: string[] = [];
  try {
    skillsList = JSON.parse(job.skills_json || "[]");
  } catch {
    skillsList = [];
  }
  if (!Array.isArray(skillsList) || skillsList.length === 0) {
    skillsList = extractSkills(`${title} ${cleanSummary}`);
  }
  const skillsBullets =
    skillsList.length > 0
      ? skillsList.map((s) => `- Thành thạo hoặc có kinh nghiệm làm việc với **${s}**.`).join("\n")
      : `- Có nền tảng chuyên môn phù hợp với vị trí **${title}**.\n- Chủ động, có tinh thần trách nhiệm và kỹ năng phối hợp nhóm tốt.`;

  return [
    `## ${title}`,
    `**Đơn vị tuyển dụng:** ${company}  `,
    `**Địa điểm làm việc:** ${location} (${workMode})  `,
    `**Cấp bậc:** ${seniority} | **Mức lương:** ${salary}  `,
    `**Nguồn tin:** ${domain}`,
    ``,
    `### 1. Tóm tắt công việc`,
    cleanSummary,
    ``,
    `### 2. Trách nhiệm chính`,
    `- Tham gia phát triển, vận hành và tối ưu hóa các hạng mục công việc thuộc vị trí **${title}** tại **${company}**.`,
    `- Phối hợp chặt chẽ với các bộ phận liên quan để đảm bảo tiến độ, chất lượng và hiệu suất dự án.`,
    `- Phân tích yêu cầu nghiệp vụ, đề xuất giải pháp cải tiến quy trình và chất lượng sản phẩm/dịch vụ.`,
    `- Báo cáo tiến độ định kỳ và xử lý các vấn đề phát sinh trong phạm vi phụ trách.`,
    ``,
    `### 3. Yêu cầu chuyên môn & Kỹ năng`,
    skillsBullets,
    `- Có khả năng đọc hiểu tài liệu chuyên ngành và giải quyết vấn đề độc lập.`,
    ``,
    `### 4. Quyền lợi & Đãi ngộ`,
    `- Mức thu nhập cạnh tranh (**${salary}**), xét duyệt tăng lương định kỳ theo năng lực.`,
    `- Đóng đầy đủ BHXH, BHYT, BHTN và các chế độ phúc lợi theo quy định Bộ Luật Lao Động.`,
    `- Môi trường làm việc chuyên nghiệp tại **${company}** (${location}).`,
  ].join("\n");
}

async function enrichJobById(jobId: number, settings: Record<string, string>): Promise<boolean> {
  const job = db.query("SELECT * FROM job_posts WHERE id = ?").get(jobId) as any;
  if (!job) return false;
  try {
    db.prepare("UPDATE job_posts SET deep_crawl_status = 'running' WHERE id = ?").run(jobId);
    const targetUrl = canonicalizeJobUrl(String(job.url || "").trim()) || String(job.url || "");
    let fRes = await smartFetchUrl(targetUrl, "auto", 1, settings, false);
    let ldObj = extractJobPostingLdObject(fRes.html);
    let md = htmlToCleanMarkdown(fRes.html, targetUrl);

    const isInvalidOrChallengeJd = (text: string) =>
      !text || text.length < 160 || isCloudflareOrBotChallengeText(text);

    // If Tier 1 Fast TLS yielded a short/challenge JD, cascade to Tier 2 Shared Chrome Stealth
    if (isInvalidOrChallengeJd(md) && fRes.tier_used.includes("Tier 1")) {
      const pwRes = await runPlaywrightStealthWorker(
        targetUrl,
        "stealth_browser",
        1,
        settings,
        false,
        fRes.logs
      );
      if (pwRes && pwRes.html) {
        fRes = { ...pwRes, logs: fRes.logs };
        ldObj = extractJobPostingLdObject(fRes.html) || ldObj;
        md = htmlToCleanMarkdown(fRes.html, targetUrl);
      }
    }

    if (isInvalidOrChallengeJd(md)) {
      md = buildCleanFallbackJdMarkdown(job);
    }

    let updatedCompany = job.company_name;
    const ldComp =
      typeof ldObj?.hiringOrganization === "object"
        ? String(ldObj?.hiringOrganization?.name || "").trim()
        : "";
    if (
      ldComp &&
      ldComp.length > 2 &&
      (!updatedCompany ||
        updatedCompany === "Unknown Company" ||
        updatedCompany.startsWith("Doanh nghiệp"))
    ) {
      updatedCompany = ldComp;
    }

    const skills = extractSkills(md, JSON.parse(job.skills_json || "[]"));
    const contacts = extractHrContacts(md);
    const summary = md
      .split(/\r?\n/)
      .filter((l) => l.length > 35 && !l.startsWith("#"))
      .slice(0, 3)
      .join(" ")
      .slice(0, 420);

    db.prepare(
      `UPDATE job_posts
       SET full_jd_markdown = ?,
           summary = COALESCE(NULLIF(?, ''), summary),
           company_name = ?,
           skills_json = ?,
           hr_email = COALESCE(?, hr_email),
           hr_phone = COALESCE(?, hr_phone),
           hr_name = COALESCE(?, hr_name),
           company_size = COALESCE(?, company_size),
           apply_url = ?,
           deep_crawl_status = 'completed',
           updated_at = ?
       WHERE id = ?`
    ).run(
      md,
      summary,
      updatedCompany,
      JSON.stringify(skills),
      contacts.hr_email,
      contacts.hr_phone,
      contacts.hr_name,
      contacts.company_size,
      targetUrl,
      new Date().toISOString(),
      jobId
    );
    return true;
  } catch {
    const fallbackMd = buildCleanFallbackJdMarkdown(job);
    db.prepare(
      "UPDATE job_posts SET full_jd_markdown = ?, deep_crawl_status = 'completed', updated_at = ? WHERE id = ?"
    ).run(fallbackMd, new Date().toISOString(), jobId);
    return true;
  }
}

// ============================================================================
// 6. Desktop Window Lifecycle & OS-Process Exit Cleanup
// ============================================================================
// Strictly tracks background crawler worker processes (pythonw / Playwright), NEVER the UI window
const activeChildProcs = new Set<any>();
let isShuttingDown = false;

function shutdownCleanly() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  for (const proc of activeChildProcs) {
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }
  activeChildProcs.clear();

  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
  } catch {
    // ignore
  }

  process.exit(0);
}

process.on("SIGINT", shutdownCleanly);
process.on("SIGTERM", shutdownCleanly);

function recordClientAlive() {
  // Retained for backward compatibility with heartbeat pings; never triggers forced timers
}

// ============================================================================
// 7. HTTP Server & REST API Router
// ============================================================================
function jsonResp(status: number, data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      ...extraHeaders,
    },
  });
}

const PORTAL_DISPLAY_NAMES: Record<string, string> = {
  "itviec.com": "ITviec",
  "topcv.vn": "TopCV",
  "careerviet.vn": "CareerViet",
  "careerlink.vn": "CareerLink",
  "jobsgo.vn": "JobsGO",
  "viecoi.vn": "ViecOi",
  "indeed.com": "Indeed",
  "vn.indeed.com": "Indeed",
  "linkedin.com": "LinkedIn",
  "joywork.vn": "JoyWork",
  "cvwork.vn": "CVWork",
  "xemviec.com": "XemViec",
  "joboko.com": "Joboko",
  "vn.joboko.com": "Joboko",
  "vietnamworks.com": "VietnamWorks",
  "glints.com": "Glints",
  "topdev.vn": "TopDev",
  "remoteok.com": "RemoteOK",
  "vieclam24h.vn": "Vieclam24h",
  "123job.vn": "123Job",
  "devwork.vn": "Devwork",
  "iconicjob.vn": "IconicJob",
  "weworkremotely.com": "WeWorkRemotely",
  "wellfound.com": "Wellfound",
};

function getFriendlyPortalName(sourceDomain: string): string {
  const clean = (sourceDomain || "").toLowerCase().replace(/^www\./, "").trim();
  if (PORTAL_DISPLAY_NAMES[clean]) return PORTAL_DISPLAY_NAMES[clean];
  for (const [dom, label] of Object.entries(PORTAL_DISPLAY_NAMES)) {
    if (clean.endsWith(dom)) return label;
  }
  const customRow = db
    .query("SELECT name FROM custom_portals WHERE domain = ? LIMIT 1")
    .get(clean) as any;
  if (customRow && customRow.name) return String(customRow.name);
  const base = clean.split(".")[0] || "Portal";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function computeJobAnalyticsFields(row: any, latestRunId = 0) {
  const sal = Number(row.salary_vnd_normalized || 0);
  let salary_bracket = "Thỏa thuận / Cạnh tranh";
  if (sal >= 35) salary_bracket = "Trên 35 Triệu (High-Paying)";
  else if (sal >= 20) salary_bracket = "20 - 35 Triệu";
  else if (sal >= 12) salary_bracket = "12 - 20 Triệu";
  else if (sal > 0) salary_bracket = "Dưới 12 Triệu";

  const skills: string[] = (() => {
    try {
      return JSON.parse(row.skills_json || "[]");
    } catch {
      return [];
    }
  })();

  const haystack = `${row.title || ""} ${skills.join(" ")} ${row.summary || ""}`.toLowerCase();

  let job_category = "Chuyên ngành khác";
  if (
    /\b(developer|software|engineer|lập trình|frontend|backend|fullstack|full-stack|devops|data|ai|qa|tester|mobile|ios|android|cloud|system|network|it support|helpdesk|erp|business analyst|product manager|scrum|python|java|react|nodejs|golang|\.net|php|brse|kỹ sư cầu nối|comtor)\b/i.test(
      haystack
    )
  ) {
    job_category = "Công nghệ / Phần mềm";
  } else if (
    /(sản xuất|cơ khí|điện tử|tự động hóa|nhà máy|khu công nghiệp|qc|qa\/qc|kỹ thuật|bảo trì|cnc|khuôn|hóa chất|xây dựng|kiến trúc|vận hành máy)/i.test(
      haystack
    )
  ) {
    job_category = "Kỹ thuật / Sản xuất";
  } else if (
    /(sales|kinh doanh|chăm sóc khách hàng|cskh|account|tư vấn|bán hàng|marketing|thị trường|bất động sản|telesale|thương mại)/i.test(
      haystack
    )
  ) {
    job_category = "Kinh doanh / Marketing";
  } else if (
    /(kế toán|kiểm toán|tài chính|ngân hàng|thuế|đầu tư)/i.test(
      haystack
    )
  ) {
    job_category = "Tài chính / Kế toán";
  } else if (
    /(nhân sự|hr\b|hành chính|xuất nhập khẩu|xnk|thu mua|purchasing|logistics|cung ứng|admin|trợ lý|thư ký|general affairs)/i.test(
      haystack
    )
  ) {
    job_category = "Nhân sự / Hành chính / XNK";
  } else if (/(biên phiên dịch|phiên dịch|biên dịch|thông dịch|interpreter|translator|ngoại ngữ)/i.test(haystack)) {
    job_category = "Biên phiên dịch / Ngoại ngữ";
  } else if (/(giáo viên|giảng viên|đào tạo|gia sư|trợ giảng|teacher|trainer|tutor|giáo dục)/i.test(haystack)) {
    job_category = "Giáo dục / Đào tạo";
  }

  let jlpt_level = "";
  if (skills.length > 0) jlpt_level = skills[0];
  else if (/\b(senior|trưởng nhóm|lead|manager|quản lý)\b/i.test(haystack)) jlpt_level = "Senior / Quản lý";
  else if (/\b(intern|thực tập|fresher)\b/i.test(haystack)) jlpt_level = "Fresher / Thực tập";
  else jlpt_level = job_category === "Công nghệ / Phần mềm" ? "Công nghệ / IT" : "Chuyên môn";

  let score = 60;
  if (sal >= 35) score += 26;
  else if (sal >= 25) score += 22;
  else if (sal >= 18) score += 17;
  else if (sal >= 12) score += 13;
  else if (sal > 0) score += 8;

  const comp = String(row.company_name || "");
  if (comp && !comp.toLowerCase().includes("unknown") && !comp.toLowerCase().endsWith(" employer")) {
    score += 4;
  }
  const hasFullJd = Boolean(
    row.has_full_jd || (row.full_jd_markdown && String(row.full_jd_markdown).length > 160)
  );
  if (hasFullJd) {
    score += 4;
  }
  if (row.hr_email || row.hr_phone) {
    score += 4;
  }
  if (row.is_highlighted) {
    score += 3;
  }
  score = Math.min(96, Math.max(60, score));
  const quality_tier = score >= 85 ? "S-Tier" : score >= 75 ? "A-Tier" : "B-Tier";
  const portal_name = getFriendlyPortalName(row.source_domain || "");
  const is_new_job = Boolean((latestRunId && row.crawl_run_id === latestRunId) || row.status === "new");

  return {
    portal_name,
    salary_bracket,
    job_category,
    jlpt_level,
    quality_score: score,
    quality_tier,
    is_new_job,
  };
}

function serializeJob(row: any, includeFullJd = false, latestRunId = 0) {
  const analytics = computeJobAnalyticsFields(row, latestRunId);
  const item: any = {
    ...row,
    ...analytics,
    is_negotiable: Boolean(row.is_negotiable),
    is_highlighted: Boolean(row.is_highlighted),
    skills: (() => {
      try {
        return JSON.parse(row.skills_json || "[]");
      } catch {
        return [];
      }
    })(),
    matched_keywords: (() => {
      try {
        return JSON.parse(row.matched_keywords_json || "[]");
      } catch {
        return [];
      }
    })(),
    has_offline_jd: Boolean(row.has_full_jd || row.full_jd_markdown),
  };
  if (includeFullJd && item.full_jd_markdown) {
    item.full_jd_markdown = htmlToCleanMarkdown(item.full_jd_markdown, item.url || "");
  }
  if (!includeFullJd) {
    delete item.full_jd_markdown;
    delete item.full_jd_html;
  }
  return item;
}

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  if (pathname === "/api/events" && method === "GET") {
    return createSseResponse(req);
  }

  if (pathname === "/api/app/heartbeat" && method === "POST") {
    recordClientAlive();
    return jsonResp(200, { ok: true });
  }
  if (pathname === "/api/app/shutdown" && method === "POST") {
    return jsonResp(200, { ok: true });
  }

  if (pathname === "/api/auth/session" && method === "GET") {
    const token = generateCsrfToken();
    return jsonResp(
      200,
      { csrf_token: token, status: "authenticated_local" },
      {
        "Set-Cookie": `__Secure-crawljob_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      }
    );
  }

  // Enforce CSRF token on state-changing requests
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = req.headers.get("X-CSRF-Token");
    if (!verifyCsrfToken(csrf)) {
      return jsonResp(403, { detail: "Invalid or missing CSRF token." });
    }
  }

  if (pathname === "/api/platforms" && method === "GET") {
    return jsonResp(200, { platforms: getAllPlatforms() });
  }

  if (pathname === "/api/platforms/probe" && method === "POST") {
    const body = await req.json();
    const rawUrl = String(body.url || "").trim();
    const sampleKw = String(body.keyword || "viec-lam").trim() || "viec-lam";
    if (!rawUrl) {
      return jsonResp(400, { detail: "Vui lòng nhập đường link web việc làm cần kiểm thử." });
    }

    const learned = learnSearchUrlTemplate(rawUrl, sampleKw);
    const resolvedProbeUrl = validateTargetUrl(
      resolveUrlTemplate(learned.template, sampleKw, "Vietnam")
    );

    const settingsRows = db.query("SELECT key, value FROM app_settings").all() as any[];
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value;

    const probeLogs: string[] = [];
    const detectedPid = detectPlatformIdFromHostname(learned.domain);
    const apiRes = await fetchDirectPortalApiJobs(
      detectedPid,
      resolvedProbeUrl,
      [sampleKw],
      1,
      probeLogs
    );

    let candidates: any[] = [];
    let tierUsed = "Direct Portal REST API";
    let extractionMethod = "direct_api";

    if (apiRes.handledByApi && apiRes.jobs.length > 0) {
      candidates = apiRes.jobs;
    } else {
      let fRes = await smartFetchUrl(resolvedProbeUrl, "auto", 1, settings, false);
      tierUsed = fRes.tier_used;

      let xhrJobs = extractJobsFromXhrPayloads(fRes.xhr_payloads || [], resolvedProbeUrl);
      let sniffed = [...xhrJobs, ...sniffStructuredJobsFromHtml(fRes.html, resolvedProbeUrl)];
      let heur =
        sniffed.length === 0 ? extractHeuristicJobsFromHtml(fRes.html, resolvedProbeUrl) : [];

      if (sniffed.length === 0 && heur.length === 0 && fRes.tier_used.includes("Tier 1")) {
        const pwRes = await runPlaywrightStealthWorker(
          resolvedProbeUrl,
          "stealth_browser",
          1,
          settings,
          false,
          fRes.logs
        );
        if (pwRes && pwRes.html) {
          fRes = { ...pwRes, logs: fRes.logs };
          tierUsed = fRes.tier_used;
          xhrJobs = extractJobsFromXhrPayloads(fRes.xhr_payloads || [], resolvedProbeUrl);
          sniffed = [...xhrJobs, ...sniffStructuredJobsFromHtml(fRes.html, resolvedProbeUrl)];
          heur =
            sniffed.length === 0 ? extractHeuristicJobsFromHtml(fRes.html, resolvedProbeUrl) : [];
        }
      }

      candidates = sniffed.length > 0 ? sniffed : heur;
      extractionMethod =
        candidates[0]?.extraction_method || (sniffed.length > 0 ? "json_ld" : "heuristic");
    }

    return jsonResp(200, {
      ok: true,
      probed_url: resolvedProbeUrl,
      domain: learned.domain,
      suggested_name: learned.suggestedName,
      suggested_code: learned.suggestedCode,
      search_url_template: learned.template,
      has_dynamic_placeholder: learned.hasDynamicPlaceholder,
      tier_used: tierUsed,
      extraction_method: extractionMethod,
      jobs_found: candidates.length,
      sample_jobs: candidates.slice(0, 6).map((j) => ({
        title: String(j.title || ""),
        company_name: String(j.company_name || "Doanh nghiệp Tuyển dụng"),
        salary_raw: String(j.salary_raw || "Thỏa thuận"),
        location_city: String(j.location_city || "Vietnam"),
        url: String(j.url || ""),
      })),
    });
  }

  if (pathname === "/api/platforms/custom" && method === "POST") {
    const body = await req.json();
    const rawUrlOrTpl = String(body.url_or_template || body.search_url_template || "").trim();
    if (!rawUrlOrTpl) {
      return jsonResp(400, { detail: "Vui lòng nhập URL hoặc mẫu tìm kiếm cho sàn mới." });
    }
    const learned = learnSearchUrlTemplate(rawUrlOrTpl, String(body.keyword || "viec-lam"));
    // Validate resolved template against SSRF guard
    validateTargetUrl(resolveUrlTemplate(learned.template, "test", "Vietnam"));

    const nameClean = String(body.name || learned.suggestedName).trim().slice(0, 40) || learned.suggestedName;
    const codeClean =
      String(body.code || learned.suggestedCode)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 3) || learned.suggestedCode;
    const idSlug = `custom_${learned.domain.replace(/[^a-z0-9]/g, "_")}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT OR REPLACE INTO custom_portals
       (id, name, code, domain, region, search_url_template, sample_url, bypass_mode, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      idSlug,
      nameClean,
      codeClean,
      learned.domain,
      String(body.region || "VN"),
      learned.template,
      rawUrlOrTpl,
      String(body.bypass_mode || "auto"),
      nowIso
    );

    return jsonResp(200, {
      ok: true,
      portal: {
        id: idSlug,
        name: nameClean,
        code: codeClean,
        domain: learned.domain,
        region: String(body.region || "VN"),
        group: "custom",
        search_url_template: learned.template,
        is_custom: true,
      },
      platforms: getAllPlatforms(),
    });
  }

  const customPlatformDelMatch = pathname.match(/^\/api\/platforms\/custom\/([a-zA-Z0-9_-]+)$/);
  if (customPlatformDelMatch && method === "DELETE") {
    const pid = customPlatformDelMatch[1];
    db.prepare("DELETE FROM custom_portals WHERE id = ?").run(pid);
    return jsonResp(200, {
      ok: true,
      deleted: pid,
      platforms: getAllPlatforms(),
    });
  }

  if (pathname === "/api/stats" && method === "GET") {
    const total_jobs = (db.query("SELECT COUNT(*) as c FROM job_posts WHERE status != 'hidden'").get() as any)?.c || 0;
    const highlighted_jobs = (db.query("SELECT COUNT(*) as c FROM job_posts WHERE is_highlighted = 1").get() as any)?.c || 0;
    const with_hr_contact = (db.query("SELECT COUNT(*) as c FROM job_posts WHERE hr_email IS NOT NULL OR hr_phone IS NOT NULL").get() as any)?.c || 0;
    const offline_ready = (db.query("SELECT COUNT(*) as c FROM job_posts WHERE deep_crawl_status = 'completed'").get() as any)?.c || 0;
    const recipes_count = (db.query("SELECT COUNT(*) as c FROM domain_recipes WHERE is_active = 1").get() as any)?.c || 0;
    const blacklist_count = (db.query("SELECT COUNT(*) as c FROM filter_rules WHERE is_active = 1").get() as any)?.c || 0;
    return jsonResp(200, {
      total_jobs,
      highlighted_jobs,
      with_hr_contact,
      offline_ready,
      recipes_count,
      blacklist_count,
    });
  }

  if (pathname === "/api/crawl/start" && method === "POST") {
    const body = await req.json();
    const nowIso = new Date().toISOString();
    let summary = "";
    if (body.mode === "keyword_search") {
      summary = `Keyword: '${body.keyword}' (${body.location || "Vietnam"})`;
    } else {
      const urls = (body.urls || []).map((u: string) => {
        const clean = u.trim().startsWith("http") ? u.trim() : `https://${u.trim()}`;
        return validateTargetUrl(clean);
      });
      body.urls = urls;
      summary = urls[0] || "URL Crawl";
    }

    const res = db
      .prepare(
        `INSERT INTO crawl_runs (mode, input_summary, urls_json, status, node_configs_json, started_at)
         VALUES (?, ?, ?, 'running', ?, ?)`
      )
      .run(
        body.mode || "single_url",
        summary,
        JSON.stringify(body.urls || []),
        JSON.stringify(body.node_config || {}),
        nowIso
      );
    const runId = Number(res.lastInsertRowid);

    const insNode = db.prepare(
      `INSERT INTO pipeline_node_logs (crawl_run_id, node_id, node_name, status, duration_ms, logs_text, updated_at)
       VALUES (?, ?, ?, 'idle', 0, 'Waiting for execution...', ?)`
    );
    for (const [nid, nname] of NODE_DEFS) {
      insNode.run(runId, nid, nname, nowIso);
    }

    runPipelineAsync(runId, body);
    return jsonResp(200, { run_id: runId, status: "running", input_summary: summary });
  }

  if (pathname === "/api/crawl/runs" && method === "GET") {
    const runs = db.query("SELECT * FROM crawl_runs ORDER BY id DESC LIMIT 15").all();
    return jsonResp(200, { runs });
  }

  const runDetailMatch = pathname.match(/^\/api\/crawl\/runs\/(\d+)$/);
  if (runDetailMatch && method === "GET") {
    const runId = Number(runDetailMatch[1]);
    const run = db.query("SELECT * FROM crawl_runs WHERE id = ?").get(runId);
    if (!run) return jsonResp(404, { detail: "Run not found" });
    const nodes = db.query("SELECT * FROM pipeline_node_logs WHERE crawl_run_id = ? ORDER BY id ASC").all(runId);
    return jsonResp(200, { run, nodes });
  }

  const runCancelMatch = pathname.match(/^\/api\/crawl\/runs\/(\d+)\/cancel$/);
  if (runCancelMatch && method === "POST") {
    const runId = Number(runCancelMatch[1]);
    const nowIso = new Date().toISOString();
    cancelRunById(runId);
    db.prepare(
      "UPDATE crawl_runs SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status = 'running'"
    ).run(nowIso, runId);
    db.prepare(
      "UPDATE pipeline_node_logs SET status = 'cancelled', logs_text = logs_text || '\n[ABORT] Cancelled by user.', updated_at = ? WHERE crawl_run_id = ? AND status IN ('running', 'idle')"
    ).run(nowIso, runId);
    broadcastSseEvent("run_updated", { run_id: runId, status: "cancelled" });
    return jsonResp(200, { ok: true, run_id: runId, status: "cancelled" });
  }

  const screenshotMatch = pathname.match(/^\/api\/screenshots\/([a-zA-Z0-9_.-]+)$/);
  if (screenshotMatch && method === "GET") {
    const safeName = path.basename(screenshotMatch[1]);
    const fullPath = path.join(SCREENSHOTS_DIR, safeName);
    if (!fs.existsSync(fullPath)) return new Response("Not Found", { status: 404 });
    return new Response(fs.readFileSync(fullPath), {
      headers: { "Content-Type": "image/png", "X-Content-Type-Options": "nosniff" },
    });
  }

  if (pathname === "/api/jobs/clear" && method === "POST") {
    const beforeCount = (db.query("SELECT COUNT(*) as c FROM job_posts").get() as any)?.c || 0;

    // 1. Stop any running crawl pipelines or background Phase 2 deep-crawl workers immediately
    cancelAllActiveRuns();
    closeSharedHeadlessChrome();

    // 2. Hard-delete 100% of jobs, pipeline logs, and crawl runs + reset AUTOINCREMENT sequences
    db.prepare("DELETE FROM job_posts").run();
    db.prepare("DELETE FROM pipeline_node_logs").run();
    db.prepare("DELETE FROM crawl_runs").run();
    try {
      db.prepare(
        "DELETE FROM sqlite_sequence WHERE name IN ('job_posts', 'pipeline_node_logs', 'crawl_runs')"
      ).run();
    } catch {
      // sqlite_sequence may not exist if no autoincrement occurred yet
    }
    try {
      db.prepare("UPDATE saved_sources SET total_jobs_collected = 0").run();
    } catch {
      // ignore
    }

    // 3. Flush WAL and physically compact crawljob.db on disk
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      db.exec("VACUUM;");
    } catch {
      // ignore if another statement is finalizing
    }

    // 4. Clean up old screenshot files in backend/data/screenshots
    try {
      if (fs.existsSync(SCREENSHOTS_DIR)) {
        for (const f of fs.readdirSync(SCREENSHOTS_DIR)) {
          if (f.endsWith(".png") || f.endsWith(".jpg")) {
            fs.unlinkSync(path.join(SCREENSHOTS_DIR, f));
          }
        }
      }
    } catch {
      // ignore file lock error
    }

    broadcastSseEvent("run_updated", { status: "cleared", deleted_count: beforeCount });

    return jsonResp(200, {
      mode: "all",
      deleted_count: beforeCount,
      remaining_count: 0,
    });
  }

  if (pathname === "/api/jobs" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    const domain = (url.searchParams.get("domain") || "").trim();
    const workMode = (url.searchParams.get("work_mode") || "").trim();
    const sortBy = url.searchParams.get("sort_by") || "newest";
    const onlyHighlighted = url.searchParams.get("only_highlighted") === "true";
    const onlyWithHr = url.searchParams.get("only_with_hr") === "true";

    const clauses: string[] = ["status != 'hidden'"];
    const params: any[] = [];

    if (q) {
      clauses.push("(title LIKE ? OR company_name LIKE ? OR skills_json LIKE ? OR location_city LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (domain) {
      clauses.push("source_domain = ?");
      params.push(domain);
    }
    if (workMode) {
      clauses.push("work_mode = ?");
      params.push(workMode);
    }
    if (onlyHighlighted) clauses.push("is_highlighted = 1");
    if (onlyWithHr) clauses.push("(hr_email IS NOT NULL OR hr_phone IS NOT NULL)");

    const orderSql =
      sortBy === "salary_desc"
        ? "salary_vnd_normalized DESC, id DESC"
        : sortBy === "salary_asc"
        ? "salary_vnd_normalized ASC, id DESC"
        : "is_highlighted DESC, updated_at DESC, id DESC";

    const latestRunRow = db.query("SELECT id FROM crawl_runs ORDER BY id DESC LIMIT 1").get() as any;
    const latestRunId = Number(latestRunRow?.id || 0);

    const sql = `SELECT ${JOB_LIST_COLUMNS} FROM job_posts WHERE ${clauses.join(" AND ")} ORDER BY ${orderSql} LIMIT 10000`;
    const rows = db.query(sql).all(...params) as any[];
    const domainRows = db.query("SELECT DISTINCT source_domain FROM job_posts").all() as any[];

    return jsonResp(200, {
      jobs: rows.map((r) => serializeJob(r, false, latestRunId)),
      domains: domainRows.map((d) => d.source_domain).filter(Boolean),
    });
  }

  const jobDetailMatch = pathname.match(/^\/api\/jobs\/(\d+)$/);
  if (jobDetailMatch && method === "GET") {
    const jobId = Number(jobDetailMatch[1]);
    let row = db.query("SELECT * FROM job_posts WHERE id = ?").get(jobId) as any;
    if (!row) return jsonResp(404, { detail: "Job not found" });
    const jdText = String(row.full_jd_markdown || "").trim();
    if (jdText.length < 160 || isCloudflareOrBotChallengeText(jdText)) {
      const settingsRows = db.query("SELECT key, value FROM app_settings").all() as any[];
      const settings: Record<string, string> = {};
      for (const r of settingsRows) settings[r.key] = r.value;
      await enrichJobById(jobId, settings);
      row = db.query("SELECT * FROM job_posts WHERE id = ?").get(jobId) as any;
    }
    return jsonResp(200, { job: serializeJob(row, true) });
  }

  if (jobDetailMatch && method === "DELETE") {
    const jobId = Number(jobDetailMatch[1]);
    db.prepare("DELETE FROM job_posts WHERE id = ?").run(jobId);
    try {
      db.exec("PRAGMA wal_checkpoint(PASSIVE);");
    } catch {
      // ignore
    }
    return jsonResp(200, { deleted: jobId });
  }

  const jobEnrichMatch = pathname.match(/^\/api\/jobs\/(\d+)\/enrich$/);
  if (jobEnrichMatch && method === "POST") {
    const jobId = Number(jobEnrichMatch[1]);
    const settingsRows = db.query("SELECT key, value FROM app_settings").all() as any[];
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value;
    const ok = await enrichJobById(jobId, settings);
    const updated = db.query("SELECT * FROM job_posts WHERE id = ?").get(jobId);
    return jsonResp(200, { success: ok, job: serializeJob(updated, true) });
  }

  const jobStatusMatch = pathname.match(/^\/api\/jobs\/(\d+)\/status$/);
  if (jobStatusMatch && method === "PATCH") {
    const jobId = Number(jobStatusMatch[1]);
    const body = await req.json();
    db.prepare("UPDATE job_posts SET status = ?, updated_at = ? WHERE id = ?").run(
      body.status || "new",
      new Date().toISOString(),
      jobId
    );
    return jsonResp(200, { id: jobId, status: body.status });
  }

  const exportMatch = pathname.match(/^\/api\/export\/(csv|xlsx|json)$/);
  if (exportMatch && method === "GET") {
    const fmt = exportMatch[1];
    const latestRunRow = db.query("SELECT id FROM crawl_runs ORDER BY id DESC LIMIT 1").get() as any;
    const latestRunId = Number(latestRunRow?.id || 0);
    const rows = db
      .query("SELECT * FROM job_posts WHERE status != 'hidden' ORDER BY salary_vnd_normalized DESC, id DESC LIMIT 2000")
      .all() as any[];
    const serialized = rows.map((r) => serializeJob(r, true, latestRunId));

    if (fmt === "json") {
      const jsonStr = JSON.stringify(serialized, null, 2);
      return new Response(jsonStr, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="CrawlJob_Report.json"',
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (fmt === "xlsx") {
      const xlsxBytes = buildMultiSheetXlsxBuffer(serialized);
      const dateStr = new Date().toISOString().slice(0, 10);
      return new Response(xlsxBytes, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="CrawlJob_BI_Report_${dateStr}.xlsx"`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const bomCsv = buildUtf8BomCsvString(serialized);
    return new Response(bomCsv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="CrawlJob_Report.csv"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  // Filters CRUD
  if (pathname === "/api/filters" && method === "GET") {
    const rules = db.query("SELECT * FROM filter_rules ORDER BY id DESC").all();
    return jsonResp(200, { rules });
  }
  if (pathname === "/api/filters" && method === "POST") {
    const body = await req.json();
    const res = db
      .prepare("INSERT INTO filter_rules (rule_type, pattern, note, is_active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run(body.rule_type, (body.pattern || "").trim(), (body.note || "").trim(), new Date().toISOString());
    return jsonResp(200, { id: Number(res.lastInsertRowid) });
  }
  const filterDelMatch = pathname.match(/^\/api\/filters\/(\d+)$/);
  if (filterDelMatch && method === "DELETE") {
    db.prepare("DELETE FROM filter_rules WHERE id = ?").run(Number(filterDelMatch[1]));
    return jsonResp(200, { deleted: Number(filterDelMatch[1]) });
  }

  // Recipes CRUD & Auto-Suggest / Live Test
  if (pathname === "/api/recipes" && method === "GET") {
    const recipes = db.query("SELECT * FROM domain_recipes ORDER BY domain ASC").all();
    return jsonResp(200, { recipes });
  }
  if (pathname === "/api/recipes/suggest" && method === "POST") {
    const body = await req.json();
    const rawUrl = String(body.url || "").trim();
    if (!rawUrl) {
      return jsonResp(400, { detail: "Vui lòng nhập URL trang tuyển dụng để tự động dò Selector." });
    }
    const cleanUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    const safeUrl = validateTargetUrl(cleanUrl);

    const settingsRows = db.query("SELECT key, value FROM app_settings").all() as any[];
    const settings: Record<string, string> = {};
    for (const r of settingsRows) settings[r.key] = r.value;

    let fRes = await smartFetchUrl(safeUrl, "auto", 1, settings, false);
    let suggested = autoSuggestRecipeFromHtml(fRes.html, safeUrl);

    const hasCustomSelectors = Boolean(body.card_selector && body.title_selector);
    const buildTestRecipe = (baseSug: typeof suggested) => ({
      domain: String(body.domain || baseSug.domain),
      recipe_name: String(body.recipe_name || baseSug.recipe_name),
      card_selector: String(body.card_selector || baseSug.card_selector),
      title_selector: String(body.title_selector || baseSug.title_selector),
      company_selector: String(body.company_selector ?? baseSug.company_selector),
      salary_selector: String(body.salary_selector ?? baseSug.salary_selector),
      location_selector: String(body.location_selector ?? baseSug.location_selector),
      link_selector: "a",
    });

    let effectiveRecipe = buildTestRecipe(suggested);
    let recipeJobs = extractJobsUsingDomainRecipe(fRes.html, safeUrl, effectiveRecipe);
    let fallbackJobs = [
      ...extractJobsFromXhrPayloads(fRes.xhr_payloads || [], safeUrl),
      ...sniffStructuredJobsFromHtml(fRes.html, safeUrl),
      ...extractHeuristicJobsFromHtml(fRes.html, safeUrl),
    ];

    if (recipeJobs.length === 0 && fallbackJobs.length === 0 && fRes.tier_used.includes("Tier 1")) {
      const pwRes = await runPlaywrightStealthWorker(
        safeUrl,
        "stealth_browser",
        1,
        settings,
        false,
        fRes.logs
      );
      if (pwRes && pwRes.html) {
        fRes = { ...pwRes, logs: fRes.logs };
        suggested = autoSuggestRecipeFromHtml(fRes.html, safeUrl);
        effectiveRecipe = buildTestRecipe(suggested);
        recipeJobs = extractJobsUsingDomainRecipe(fRes.html, safeUrl, effectiveRecipe);
        fallbackJobs = [
          ...extractJobsFromXhrPayloads(fRes.xhr_payloads || [], safeUrl),
          ...sniffStructuredJobsFromHtml(fRes.html, safeUrl),
          ...extractHeuristicJobsFromHtml(fRes.html, safeUrl),
        ];
      }
    }

    const displayJobs =
      recipeJobs.length > 0 ? recipeJobs : hasCustomSelectors ? [] : fallbackJobs;

    return jsonResp(200, {
      ok: true,
      url: safeUrl,
      domain: effectiveRecipe.domain,
      recipe_name: effectiveRecipe.recipe_name,
      card_selector: effectiveRecipe.card_selector,
      title_selector: effectiveRecipe.title_selector,
      company_selector: effectiveRecipe.company_selector,
      salary_selector: effectiveRecipe.salary_selector,
      location_selector: effectiveRecipe.location_selector,
      tier_used: fRes.tier_used,
      recipe_hits: recipeJobs.length,
      jobs_found: displayJobs.length,
      sample_jobs: displayJobs.slice(0, 6).map((j) => ({
        title: String(j.title || ""),
        company_name: String(j.company_name || "Doanh nghiệp Tuyển dụng"),
        salary_raw: String(j.salary_raw || "Thỏa thuận"),
        location_city: String(j.location_city || "Vietnam"),
        url: String(j.url || ""),
        extraction_method: String(j.extraction_method || "recipe"),
      })),
    });
  }
  if (pathname === "/api/recipes" && method === "POST") {
    const body = await req.json();
    const nowIso = new Date().toISOString();
    const dom = (body.domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    const existing = db.query("SELECT success_count FROM domain_recipes WHERE domain = ?").get(dom) as any;
    const prevHits = Number(existing?.success_count || 0);
    db.prepare(
      `INSERT OR REPLACE INTO domain_recipes
       (domain, recipe_name, card_selector, title_selector, company_selector, salary_selector, location_selector, link_selector, learned_by, success_count, is_active, last_healed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'a', ?, ?, 1, ?, ?)`
    ).run(
      dom,
      body.recipe_name || `Recipe (${dom})`,
      body.card_selector,
      body.title_selector,
      body.company_selector || "",
      body.salary_selector || "",
      body.location_selector || "",
      body.learned_by || "manual",
      prevHits,
      nowIso,
      nowIso
    );
    return jsonResp(200, { domain: dom });
  }
  const recDelMatch = pathname.match(/^\/api\/recipes\/(\d+)$/);
  if (recDelMatch && method === "DELETE") {
    db.prepare("DELETE FROM domain_recipes WHERE id = ?").run(Number(recDelMatch[1]));
    return jsonResp(200, { deleted: Number(recDelMatch[1]) });
  }

  // Sources CRUD & Live Cron Trigger / Toggle
  if (pathname === "/api/sources" && method === "GET") {
    const sources = db.query("SELECT * FROM saved_sources ORDER BY id DESC").all();
    return jsonResp(200, { sources });
  }
  if (pathname === "/api/sources" && method === "POST") {
    const body = await req.json();
    const defaultPlats = getAllPlatforms().map((p) => p.id);
    const plats =
      Array.isArray(body.platforms) && body.platforms.length > 0 ? body.platforms : defaultPlats;
    const res = db
      .prepare(
        `INSERT INTO saved_sources (name, url_or_keyword, source_type, platforms_json, cron_interval_minutes, bypass_mode, deep_crawl_enabled, max_pages, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      )
      .run(
        body.name,
        body.url_or_keyword,
        body.source_type || "url",
        JSON.stringify(plats),
        body.cron_interval_minutes || 60,
        body.bypass_mode || "auto",
        body.deep_crawl_enabled ? 1 : 0,
        Number(body.max_pages ?? 1),
        new Date().toISOString()
      );
    return jsonResp(200, { id: Number(res.lastInsertRowid) });
  }
  const srcRunMatch = pathname.match(/^\/api\/sources\/(\d+)\/run$/);
  if (srcRunMatch && method === "POST") {
    const srcId = Number(srcRunMatch[1]);
    const sourceRow = db.query("SELECT * FROM saved_sources WHERE id = ?").get(srcId) as any;
    if (!sourceRow) return jsonResp(404, { detail: "Không tìm thấy tác vụ Cron." });
    const runId = triggerSavedSourceRun(sourceRow);
    return jsonResp(200, {
      ok: true,
      run_id: runId,
      source_id: srcId,
      sources: db.query("SELECT * FROM saved_sources ORDER BY id DESC").all(),
    });
  }
  const srcToggleMatch = pathname.match(/^\/api\/sources\/(\d+)\/toggle$/);
  if (srcToggleMatch && method === "PATCH") {
    const srcId = Number(srcToggleMatch[1]);
    const sourceRow = db.query("SELECT * FROM saved_sources WHERE id = ?").get(srcId) as any;
    if (!sourceRow) return jsonResp(404, { detail: "Không tìm thấy tác vụ Cron." });
    const nextActive = sourceRow.is_active ? 0 : 1;
    db.prepare("UPDATE saved_sources SET is_active = ? WHERE id = ?").run(nextActive, srcId);
    return jsonResp(200, {
      ok: true,
      id: srcId,
      is_active: nextActive,
      sources: db.query("SELECT * FROM saved_sources ORDER BY id DESC").all(),
    });
  }
  const srcDelMatch = pathname.match(/^\/api\/sources\/(\d+)$/);
  if (srcDelMatch && method === "DELETE") {
    db.prepare("DELETE FROM saved_sources WHERE id = ?").run(Number(srcDelMatch[1]));
    return jsonResp(200, { deleted: Number(srcDelMatch[1]) });
  }

  // Proxies CRUD
  if (pathname === "/api/proxies" && method === "GET") {
    const proxies = db.query("SELECT * FROM proxy_servers ORDER BY id DESC").all();
    return jsonResp(200, { proxies });
  }
  if (pathname === "/api/proxies" && method === "POST") {
    const body = await req.json();
    const res = db
      .prepare("INSERT OR IGNORE INTO proxy_servers (proxy_url, protocol, label, is_active) VALUES (?, ?, ?, 1)")
      .run(body.proxy_url, body.protocol || "http", body.label || "");
    return jsonResp(200, { id: Number(res.lastInsertRowid) });
  }
  const prxDelMatch = pathname.match(/^\/api\/proxies\/(\d+)$/);
  if (prxDelMatch && method === "DELETE") {
    db.prepare("DELETE FROM proxy_servers WHERE id = ?").run(Number(prxDelMatch[1]));
    return jsonResp(200, { deleted: Number(prxDelMatch[1]) });
  }

  // Settings GET & POST (with Secret Masking)
  if (pathname === "/api/settings" && method === "GET") {
    const rows = db.query("SELECT key, value, is_secret FROM app_settings").all() as any[];
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.is_secret || SECRET_KEYS.has(r.key) ? maskSecret(r.value) : r.value;
    }
    return jsonResp(200, { settings: out });
  }
  if (pathname === "/api/settings" && method === "POST") {
    const body = await req.json();
    const nowIso = new Date().toISOString();
    const upd = db.prepare("INSERT OR REPLACE INTO app_settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)");
    for (const [k, v] of Object.entries(body.settings || {})) {
      const strVal = String(v || "").trim();
      if (SECRET_KEYS.has(k) && strVal.startsWith("****")) continue;
      upd.run(k, strVal, SECRET_KEYS.has(k) ? 1 : 0, nowIso);
    }
    return jsonResp(200, { status: "saved" });
  }

  return jsonResp(404, { detail: "API endpoint not found" });
}

function triggerSavedSourceRun(sourceRow: any): number {
  const nowIso = new Date().toISOString();
  db.prepare("UPDATE saved_sources SET last_run_at = ? WHERE id = ?").run(nowIso, sourceRow.id);

  let parsedPlatforms: string[] = [];
  try {
    parsedPlatforms = JSON.parse(String(sourceRow.platforms_json || "[]"));
  } catch {
    parsedPlatforms = [];
  }
  if (!Array.isArray(parsedPlatforms) || parsedPlatforms.length === 0) {
    parsedPlatforms = getAllPlatforms().map((p) => p.id);
  }

  const isKeywordMode = sourceRow.source_type === "keyword";
  const rawInput = String(sourceRow.url_or_keyword || "").trim();
  const safeUrls = !isKeywordMode
    ? [validateTargetUrl(rawInput.startsWith("http") ? rawInput : `https://${rawInput}`)]
    : [];

  const summary = isKeywordMode
    ? `[Cron: ${sourceRow.name}] Keyword: '${rawInput}' (${parsedPlatforms.length} sàn)`
    : `[Cron: ${sourceRow.name}] URL: ${safeUrls[0]}`;

  const nodeCfg = {
    enabled: true,
    bypass_mode: sourceRow.bypass_mode || "auto",
    scroll_times: 2,
    max_pages: Number(sourceRow.max_pages ?? 1),
    enable_sniffer: true,
    enable_recipe_cache: true,
    enable_ai_fallback: true,
    enable_deep_crawl: Boolean(sourceRow.deep_crawl_enabled),
    deep_crawl_max_items: 40,
  };

  const res = db
    .prepare(
      `INSERT INTO crawl_runs (mode, input_summary, urls_json, status, node_configs_json, started_at)
       VALUES (?, ?, ?, 'running', ?, ?)`
    )
    .run(
      isKeywordMode ? "keyword_search" : "single_url",
      summary,
      JSON.stringify(safeUrls),
      JSON.stringify(nodeCfg),
      nowIso
    );
  const runId = Number(res.lastInsertRowid);

  const insNode = db.prepare(
    `INSERT INTO pipeline_node_logs (crawl_run_id, node_id, node_name, status, duration_ms, logs_text, updated_at)
     VALUES (?, ?, ?, 'idle', 0, 'Waiting for Cron execution...', ?)`
  );
  for (const [nid, nname] of NODE_DEFS) {
    insNode.run(runId, nid, nname, nowIso);
  }

  const payload = {
    mode: isKeywordMode ? "keyword_search" : "single_url",
    urls: safeUrls,
    keyword: isKeywordMode ? rawInput : "",
    location: "Vietnam",
    platforms: parsedPlatforms,
    node_config: nodeCfg,
  };

  (async () => {
    try {
      await runPipelineAsync(runId, payload);
      const finishedRun = db
        .query("SELECT new_jobs_saved FROM crawl_runs WHERE id = ?")
        .get(runId) as any;
      const addedJobs = Number(finishedRun?.new_jobs_saved || 0);
      db.prepare(
        "UPDATE saved_sources SET last_run_at = ?, total_jobs_collected = COALESCE(total_jobs_collected, 0) + ? WHERE id = ?"
      ).run(new Date().toISOString(), addedJobs, sourceRow.id);
    } catch {
      // ignore background cron error
    }
  })();

  return runId;
}

function startCronSchedulerDaemon() {
  setInterval(() => {
    try {
      const runningRow = db
        .query("SELECT id FROM crawl_runs WHERE status = 'running' LIMIT 1")
        .get() as any;
      if (runningRow) return; // Wait until current crawl finishes

      const activeSources = db
        .query("SELECT * FROM saved_sources WHERE is_active = 1 ORDER BY id ASC")
        .all() as any[];
      const nowMs = Date.now();

      for (const s of activeSources) {
        const intervalMs = Math.max(5, Number(s.cron_interval_minutes || 60)) * 60 * 1000;
        const refIso = s.last_run_at || s.created_at;
        const refMs = refIso ? Date.parse(String(refIso)) : 0;
        if (!refMs || isNaN(refMs) || nowMs - refMs >= intervalMs) {
          triggerSavedSourceRun(s);
          break; // Trigger one due source per tick
        }
      }
    } catch {
      // ignore daemon tick error
    }
  }, 30_000);
}

function killStaleDesktopInstances() {
  if (process.platform !== "win32") return;
  try {
    const myPid = process.pid;
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -like 'CrawlJobStudio*.exe' -and $_.ProcessId -ne ${myPid}) -or ($_.CommandLine -like '*CrawlJobStudio_ChromeCleanProfile*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", psCmd], {
      stdout: "ignore",
      stderr: "ignore",
      windowsHide: true,
    } as any);
  } catch {
    // ignore cleanup error
  }
}

function startDesktopServer() {
  killStaleDesktopInstances();
  initStaticAssetCache();
  const candidatePorts = [8000, 8085, 8089, 0];
  for (const port of candidatePorts) {
    try {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        async fetch(req: Request) {
          try {
            const url = new URL(req.url);
            if (url.pathname.startsWith("/api/")) {
              return await handleApi(req, url);
            }

            const asset = getDecodedStaticAsset(url.pathname);
            if (!asset) {
              return new Response("CrawlJob Studio UI Asset Not Found", { status: 404 });
            }

            return new Response(asset.bytes, {
              status: 200,
              headers: {
                "Content-Type": asset.mime,
                "X-Content-Type-Options": "nosniff",
                "X-Frame-Options": "DENY",
              },
            });
          } catch (err: any) {
            return jsonResp(400, { detail: String(err?.message || err || "Internal Request Error") });
          }
        },
      });
      return server;
    } catch {
      // try next port
    }
  }
  throw new Error("Could not bind localhost port for CrawlJob Studio.");
}

function findBrowserExecutable(): string | null {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe"),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

if (import.meta.main) {
  const server = startDesktopServer();
  startCronSchedulerDaemon();
  startMaintenanceWatchdog(() => activeChromeTabs, closeSharedHeadlessChrome);
  const appUrl = `http://127.0.0.1:${server.port}`;

  const noWindowMode = process.argv.includes("--no-window") || process.env.CRAWLJOB_NO_WINDOW === "1";

  if (!noWindowMode) {
    const browserExe = findBrowserExecutable();
    if (browserExe) {
      const profileDir = path.join(os.tmpdir(), "CrawlJobStudio_ChromeCleanProfile");
      fs.mkdirSync(profileDir, { recursive: true });
      const launchTs = Date.now();
      // IMPORTANT: Do NOT set windowsHide: true on uiBrowserProc!
      // chrome.exe / msedge.exe is already a Windows GUI subsystem binary (zero console window).
      // Setting windowsHide: true passes STARTUPINFO.wShowWindow = SW_HIDE, which hides the GUI window itself!
      const uiBrowserProc = Bun.spawn(
        [
          browserExe,
          `--app=${appUrl}`,
          `--user-data-dir=${profileDir}`,
          "--new-window",
          "--window-size=1480,920",
          "--disable-background-mode",
          "--disable-extensions",
          "--disable-component-extensions-with-background-pages",
          "--disable-default-apps",
          "--disable-sync",
          "--disable-background-networking",
          "--disable-client-side-phishing-detection",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-features=Translate,ExtensionsToolbarMenu,ChromeWhatsNewUI,SidePanelPinning",
        ],
        { stdout: "ignore", stderr: "ignore", windowsHide: false } as any
      );
      uiBrowserProc.exited.then(() => {
        if (Date.now() - launchTs > 1500) {
          shutdownCleanly();
        }
      });
    } else {
      Bun.spawn(["cmd", "/c", "start", "", appUrl], { stdout: "ignore", stderr: "ignore", windowsHide: true } as any);
    }
  } else {
    console.log(`CrawlJob Studio Desktop Server listening on ${appUrl}`);
  }
}
