import React, { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Layers,
  ListPlus,
  Loader2,
  MapPin,
  Play,
  Plus,
  RotateCcw,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { apiRequest, NodeConfig } from "../api/client";
import { CustomSelect } from "./ui/CustomSelect";

export interface PlatformItem {
  id: string;
  name: string;
  code?: string;
  region: string;
  domain: string;
  group?: string;
  search_url_template?: string;
  sample_url?: string;
  bypass_mode?: string;
  is_custom?: boolean;
}

interface ProbeSampleJob {
  title: string;
  company_name: string;
  salary_raw: string;
  location_city: string;
  url: string;
}

interface ProbeResponse {
  ok: boolean;
  probed_url: string;
  domain: string;
  suggested_name: string;
  suggested_code: string;
  search_url_template: string;
  has_dynamic_placeholder: boolean;
  tier_used: string;
  extraction_method: string;
  jobs_found: number;
  sample_jobs: ProbeSampleJob[];
}

interface Props {
  platforms: PlatformItem[];
  portalJobCounts?: Record<string, number>;
  nodeConfig: NodeConfig;
  onChangeConfig: (cfg: NodeConfig) => void;
  onStartCrawl: (payload: {
    mode: "single_url" | "bulk_urls" | "keyword_search";
    urls: string[];
    keyword: string;
    location: string;
    platforms: string[];
    platform_keywords?: Record<string, string>;
    platform_urls?: Record<string, string>;
  }) => Promise<void>;
  onCancelCrawl?: () => void;
  onPlatformsChanged?: (platforms: PlatformItem[]) => void;
  isRunning: boolean;
}

const ALL_20_PORTAL_IDS = [
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

const VN_GENERAL_PORTAL_IDS = [
  "topcv",
  "careerviet",
  "vietnamworks",
  "vieclam24h",
  "job123",
  "iconicjob",
  "careerlink",
  "jobsgo",
  "viecoi",
  "joywork",
  "cvwork",
  "xemviec",
  "joboko",
];

const TECH_IT_PORTAL_IDS = ["itviec", "topdev", "glints", "devwork"];

const GLOBAL_REMOTE_PORTAL_IDS = ["linkedin", "indeed", "remoteok"];

const PORTAL_BRAND_META: Record<
  string,
  { code: string; tag: string; accent: string }
> = {
  itviec: { code: "IT", tag: "IT / Tech", accent: "bg-rose-600 text-white" },
  topcv: { code: "TC", tag: "Đa ngành VN", accent: "bg-emerald-600 text-white" },
  careerviet: { code: "CV", tag: "Enterprise", accent: "bg-blue-600 text-white" },
  careerlink: { code: "CL", tag: "Enterprise", accent: "bg-sky-600 text-white" },
  jobsgo: { code: "JG", tag: "Fast Match", accent: "bg-teal-600 text-white" },
  viecoi: { code: "VO", tag: "Đa ngành VN", accent: "bg-amber-600 text-white" },
  indeed: { code: "IN", tag: "Global / VN", accent: "bg-indigo-600 text-white" },
  linkedin: { code: "LI", tag: "Global Net", accent: "bg-blue-700 text-white" },
  joywork: { code: "JW", tag: "Job Portal", accent: "bg-violet-600 text-white" },
  cvwork: { code: "CW", tag: "Đa ngành VN", accent: "bg-cyan-600 text-white" },
  xemviec: { code: "XV", tag: "Aggregator", accent: "bg-purple-600 text-white" },
  joboko: { code: "JK", tag: "Job Engine", accent: "bg-emerald-700 text-white" },
  vietnamworks: { code: "VW", tag: "Senior / Corp", accent: "bg-orange-600 text-white" },
  glints: { code: "GL", tag: "SEA / Tech", accent: "bg-amber-500 text-zinc-950" },
  topdev: { code: "TD", tag: "Developers", accent: "bg-rose-700 text-white" },
  remoteok: { code: "RO", tag: "Remote Global", accent: "bg-fuchsia-600 text-white" },
  vieclam24h: { code: "24", tag: "Đa ngành VN", accent: "bg-indigo-700 text-white" },
  job123: { code: "12", tag: "Đa ngành VN", accent: "bg-emerald-600 text-white" },
  devwork: { code: "DW", tag: "IT / Headhunt", accent: "bg-sky-600 text-white" },
  iconicjob: { code: "IC", tag: "FDI / Đa ngành", accent: "bg-blue-600 text-white" },
};

function splitKeywordList(raw: string): string[] {
  return (raw || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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

function buildPreviewUrl(
  platformId: string,
  keyword: string,
  location: string,
  allPlatforms: PlatformItem[] = []
): string {
  const firstKw = splitKeywordList(keyword)[0] || "";
  const kwClean = firstKw.trim() || "viec-lam";
  const locClean = (location || "Vietnam").trim();
  const slug = toAsciiSlug(kwClean);
  const kwEnc = encodeURIComponent(kwClean);
  const locEnc = encodeURIComponent(locClean);
  const remoteSlug = slug;

  const map: Record<string, string> = {
    itviec: `https://itviec.com/it-jobs/${remoteSlug}`,
    topcv: `https://www.topcv.vn/tim-viec-lam-${slug}`,
    careerviet: `https://careerviet.vn/viec-lam/${slug}-k-vi.html`,
    careerlink: `https://www.careerlink.vn/viec-lam/k/${kwEnc}`,
    jobsgo: `https://jobsgo.vn/viec-lam-${slug}.html`,
    viecoi: `https://viecoi.vn/tim-viec/${slug}.html`,
    indeed: `https://vn.indeed.com/jobs?q=${kwEnc}&l=${locEnc}`,
    linkedin: `https://www.linkedin.com/jobs/search?keywords=${kwEnc}&location=${locEnc}`,
    joywork: `https://joywork.vn/jobs?q=${kwEnc}`,
    cvwork: `https://cvwork.vn/viec-lam?q=${kwEnc}`,
    xemviec: `https://xemviec.com/viec-lam?q=${kwEnc}`,
    joboko: `https://vn.joboko.com/tim-viec-lam-${slug}`,
    vietnamworks: `https://www.vietnamworks.com/viec-lam?q=${kwEnc}`,
    glints: `https://glints.com/vn/opportunities/jobs/explore?keyword=${kwEnc}`,
    topdev: `https://topdev.vn/jobs/search?keyword=${kwEnc}`,
    remoteok: `https://remoteok.com/remote-${remoteSlug}-jobs`,
    vieclam24h: `https://vieclam24h.vn/tim-kiem-viec-lam-nhanh?q=${kwEnc}`,
    job123: `https://123job.vn/tuyen-dung?q=${kwEnc}`,
    devwork: `https://devwork.vn/viec-lam?keyword=${kwEnc}`,
    iconicjob: `https://iconicjob.vn/viec-lam/tim-viec-lam?kw=${kwEnc}`,
  };
  if (map[platformId]) return map[platformId];

  const customObj = allPlatforms.find((p) => p.id === platformId);
  if (customObj?.search_url_template) {
    return customObj.search_url_template
      .replace(/\{\{keyword\}\}/gi, kwEnc)
      .replace(/\{\{slug\}\}/gi, slug)
      .replace(/\{\{remote_slug\}\}/gi, remoteSlug)
      .replace(/\{\{location\}\}/gi, locEnc);
  }

  return `https://www.topcv.vn/tim-viec-lam-${slug}`;
}

function detectFrontendPlatformId(
  hostname: string,
  allPlatforms: PlatformItem[] = []
): string {
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

  const customMatch = allPlatforms.find((p) => p.domain.toLowerCase() === h);
  if (customMatch) return customMatch.id;
  return "custom";
}

function resolveSingleUrlPreview(
  rawUrl: string,
  keyword: string,
  location: string,
  allPlatforms: PlatformItem[] = []
): { modeLabel: string; previewUrl: string } | null {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return null;
  try {
    const normalized = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(normalized);
    const pid = detectFrontendPlatformId(parsed.hostname, allPlatforms);
    const kwList = splitKeywordList(keyword);
    const isRoot =
      (parsed.pathname === "/" || parsed.pathname === "") && !parsed.search;

    if (isRoot && kwList.length > 0) {
      if (pid !== "custom") {
        return {
          modeLabel: `Tự động tạo link tìm kiếm (${pid.toUpperCase()})`,
          previewUrl: buildPreviewUrl(pid, kwList[0], location, allPlatforms),
        };
      }
      const u = new URL(normalized);
      u.searchParams.set("q", kwList[0]);
      return {
        modeLabel: "Tự động gắn tham số tìm kiếm (?q=)",
        previewUrl: u.toString(),
      };
    }

    if (kwList.length > 0) {
      return {
        modeLabel: `Quét phân trang & lọc theo ${kwList.length} từ khóa (${kwList.join(", ")})`,
        previewUrl: normalized,
      };
    }

    return {
      modeLabel: "Quét toàn bộ việc làm trên URL này (không giới hạn từ khóa)",
      previewUrl: normalized,
    };
  } catch {
    return null;
  }
}

export const CrawlerCommandCenter: React.FC<Props> = ({
  platforms,
  portalJobCounts = {},
  nodeConfig,
  onChangeConfig,
  onStartCrawl,
  onCancelCrawl,
  onPlatformsChanged,
  isRunning,
}) => {
  const [inputMode, setInputMode] = useState<
    "single_url" | "bulk_urls" | "keyword_search"
  >("keyword_search");

  const [singleUrl, setSingleUrl] = useState<string>("");
  const [bulkUrlsText, setBulkUrlsText] = useState<string>("");

  const [keyword, setKeyword] = useState<string>("");
  const [location, setLocation] = useState<string>("Vietnam");
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<string[]>(ALL_20_PORTAL_IDS);
  const [portalGroupTab, setPortalGroupTab] = useState<
    "all" | "vn_general" | "tech_it" | "global_remote" | "has_jobs"
  >("all");
  const [platformKeywords, setPlatformKeywords] = useState<
    Record<string, string>
  >({});
  const [platformUrls, setPlatformUrls] = useState<Record<string, string>>({});
  const [showPerSiteMatrix, setShowPerSiteMatrix] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Add & Auto-Probe New Job Website Modal State
  const [showAddPortalModal, setShowAddPortalModal] = useState<boolean>(false);
  const [newPortalUrlInput, setNewPortalUrlInput] = useState<string>("");
  const [newPortalName, setNewPortalName] = useState<string>("");
  const [newPortalCode, setNewPortalCode] = useState<string>("");
  const [newPortalTemplate, setNewPortalTemplate] = useState<string>("");
  const [probingPortal, setProbingPortal] = useState<boolean>(false);
  const [savingPortal, setSavingPortal] = useState<boolean>(false);
  const [probeResult, setProbeResult] = useState<ProbeResponse | null>(null);
  const [probeError, setProbeError] = useState<string>("");

  const togglePlatform = (pid: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(pid) ? prev.filter((item) => item !== pid) : [...prev, pid]
    );
  };

  const removeSingleKeyword = (targetKw: string) => {
    const remaining = splitKeywordList(keyword).filter(
      (k) => k.toLowerCase() !== targetKw.toLowerCase()
    );
    setKeyword(remaining.join(", "));
  };

  const openAddPortalWithUrl = (prefillUrl = "") => {
    setNewPortalUrlInput(prefillUrl);
    setNewPortalName("");
    setNewPortalCode("");
    setNewPortalTemplate("");
    setProbeResult(null);
    setProbeError("");
    setShowAddPortalModal(true);
  };

  const handleRunLiveProbe = async () => {
    const raw = newPortalUrlInput.trim();
    if (!raw) {
      setProbeError("Vui lòng dán đường link trang việc làm cần kiểm thử.");
      return;
    }
    setProbingPortal(true);
    setProbeError("");
    try {
      const res = await apiRequest<ProbeResponse>("/api/platforms/probe", {
        method: "POST",
        body: JSON.stringify({
          url: raw,
          keyword: splitKeywordList(keyword)[0] || "",
        }),
      });
      setProbeResult(res);
      if (!newPortalName.trim()) setNewPortalName(res.suggested_name);
      if (!newPortalCode.trim()) setNewPortalCode(res.suggested_code);
      setNewPortalTemplate(res.search_url_template);
    } catch (err: any) {
      setProbeError(err?.message || "Không thể kết nối tới đường link này.");
    } finally {
      setProbingPortal(false);
    }
  };

  const handleSaveCustomPortal = async () => {
    const tplOrUrl = (newPortalTemplate || newPortalUrlInput).trim();
    if (!tplOrUrl) {
      setProbeError("Vui lòng nhập URL hoặc bấm Kiểm thử trước khi lưu.");
      return;
    }
    setSavingPortal(true);
    setProbeError("");
    try {
      const res = await apiRequest<{
        ok: boolean;
        portal: PlatformItem;
        platforms: PlatformItem[];
      }>("/api/platforms/custom", {
        method: "POST",
        body: JSON.stringify({
          name: newPortalName.trim(),
          code: newPortalCode.trim(),
          url_or_template: tplOrUrl,
          keyword: splitKeywordList(keyword)[0] || "",
        }),
      });
      if (res.platforms && onPlatformsChanged) {
        onPlatformsChanged(res.platforms);
      }
      if (res.portal?.id) {
        setSelectedPlatforms((prev) =>
          prev.includes(res.portal.id) ? prev : [...prev, res.portal.id]
        );
      }
      setShowAddPortalModal(false);
    } catch (err: any) {
      setProbeError(err?.message || "Lỗi lưu sàn mới.");
    } finally {
      setSavingPortal(false);
    }
  };

  const handleDeleteCustomPortal = async (
    e: React.MouseEvent,
    pid: string
  ) => {
    e.stopPropagation();
    try {
      const res = await apiRequest<{
        ok: boolean;
        deleted: string;
        platforms: PlatformItem[];
      }>(`/api/platforms/custom/${pid}`, {
        method: "DELETE",
      });
      if (res.platforms && onPlatformsChanged) {
        onPlatformsChanged(res.platforms);
      }
      setSelectedPlatforms((prev) => prev.filter((item) => item !== pid));
    } catch {
      // ignore error
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMode === "single_url") {
      if (!singleUrl.trim()) return;
      await onStartCrawl({
        mode: "single_url",
        urls: [singleUrl.trim()],
        keyword: keyword.trim(),
        location: location.trim(),
        platforms: [],
      });
    } else if (inputMode === "bulk_urls") {
      const list = bulkUrlsText
        .split(/\r?\n/)
        .map((u) => u.trim())
        .filter(Boolean);
      if (list.length === 0) return;
      await onStartCrawl({
        mode: "bulk_urls",
        urls: list,
        keyword: keyword.trim(),
        location: location.trim(),
        platforms: [],
      });
    } else {
      await onStartCrawl({
        mode: "keyword_search",
        urls: [],
        keyword: keyword.trim(),
        location: location.trim(),
        platforms: selectedPlatforms,
        platform_keywords: platformKeywords,
        platform_urls: platformUrls,
      });
    }
  };

  const customOverrideCount = Object.entries(platformKeywords).filter(
    ([pid, val]) => selectedPlatforms.includes(pid) && val.trim().length > 0
  ).length;

  const singlePreview = resolveSingleUrlPreview(
    singleUrl,
    keyword,
    location,
    platforms
  );

  const activeKeywordTokens = splitKeywordList(keyword);

  const visiblePlatforms = platforms.filter((p) => {
    if (portalGroupTab === "vn_general") {
      return VN_GENERAL_PORTAL_IDS.includes(p.id) || p.is_custom;
    }
    if (portalGroupTab === "tech_it") {
      return TECH_IT_PORTAL_IDS.includes(p.id);
    }
    if (portalGroupTab === "global_remote") {
      return GLOBAL_REMOTE_PORTAL_IDS.includes(p.id);
    }
    if (portalGroupTab === "has_jobs") {
      const cnt = portalJobCounts[p.name] ?? portalJobCounts[p.domain] ?? 0;
      return cnt > 0;
    }
    return true;
  });

  const portalsWithJobsIds = platforms
    .filter((p) => (portalJobCounts[p.name] ?? portalJobCounts[p.domain] ?? 0) > 0)
    .map((p) => p.id);

  return (
    <div className="studio-card overflow-visible">
      {/* Compact Header Toolbar */}
      <div className="px-4 py-2.5 bg-slate-50/90 dark:bg-zinc-900/75 border-b border-slate-200/90 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2.5 rounded-t-xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex p-0.5 rounded-lg bg-slate-200/75 dark:bg-zinc-800/90 border border-slate-300/60 dark:border-zinc-700/70 text-xs">
            <button
              type="button"
              onClick={() => setInputMode("keyword_search")}
              className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-semibold transition-all ${
                inputMode === "keyword_search"
                  ? "bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Tìm kiếm đa sàn (20 Sàn)</span>
            </button>

            <button
              type="button"
              onClick={() => setInputMode("single_url")}
              className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-semibold transition-all ${
                inputMode === "single_url"
                  ? "bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>URL đơn lẻ</span>
            </button>

            <button
              type="button"
              onClick={() => setInputMode("bulk_urls")}
              className={`px-3 py-1 rounded-md flex items-center gap-1.5 font-semibold transition-all ${
                inputMode === "bulk_urls"
                  ? "bg-white dark:bg-zinc-950 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                  : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
              }`}
            >
              <ListPlus className="w-3.5 h-3.5" />
              <span>Danh sách URL</span>
            </button>
          </div>

          <span className="hidden xl:inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>
              {inputMode === "keyword_search"
                ? "Quét đồng thời 6 luồng tốc độ cao + Tự động bóc tách JD & Liên hệ HR"
                : inputMode === "single_url"
                ? "Nhập link bất kỳ — Tự động học cấu trúc hoặc lưu thành Sàn mới"
                : "Quét hàng loạt đường dẫn tuyển dụng trong 1 lần chạy"}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="w-48">
            <CustomSelect
              size="sm"
              value={String(nodeConfig.max_pages)}
              onChange={(val) =>
                onChangeConfig({
                  ...nodeConfig,
                  max_pages: parseInt(val, 10),
                })
              }
              icon={<Layers className="w-3.5 h-3.5 text-indigo-500" />}
              options={[
                { value: "0", label: "Cào hết phân trang (Auto)" },
                { value: "3", label: "Tối đa 3 trang / sàn" },
                { value: "5", label: "Tối đa 5 trang / sàn" },
                { value: "10", label: "Tối đa 10 trang / sàn" },
                { value: "1", label: "Chỉ lấy Trang 1 (Nhanh)" },
              ]}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-all ${
              showAdvanced
                ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                : "studio-btn-secondary"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Cấu hình sâu</span>
            {showAdvanced ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Command Form */}
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {inputMode === "single_url" && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-end">
              <div className="lg:col-span-6">
                <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  URL mục tiêu hoặc Tên miền sàn tuyển dụng mới
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={singleUrl}
                    onChange={(e) => setSingleUrl(e.target.value)}
                    placeholder="VD: https://topcv.vn/viec-lam hoặc https://ybox.vn/tuyen-dung"
                    className="studio-input w-full h-9.5 pl-9 pr-8 text-xs font-mono"
                  />
                  {singleUrl && (
                    <button
                      type="button"
                      onClick={() => setSingleUrl("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="lg:col-span-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
                    Từ khóa tìm kiếm / lọc (Tùy chọn)
                  </label>
                  {keyword.trim() && (
                    <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-semibold">
                      {activeKeywordTokens.length} từ khóa
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="Nhập từ khóa công việc, kỹ năng (để trống nếu lấy hết)"
                    className="studio-input w-full h-9.5 pl-9 pr-8 text-xs font-medium"
                  />
                  {keyword && (
                    <button
                      type="button"
                      onClick={() => setKeyword("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="lg:col-span-2">
                {isRunning && onCancelCrawl ? (
                  <button
                    type="button"
                    onClick={onCancelCrawl}
                    className="w-full h-9.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow-xs"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Dừng Quét</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isRunning || !singleUrl.trim()}
                    className="studio-btn-primary w-full h-9.5 px-4 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isRunning ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang chạy...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Chạy Pipeline</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {singlePreview && (
              <div className="px-3 py-2 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-200/70 dark:border-indigo-900/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-semibold shrink-0 text-[11px]">
                    {singlePreview.modeLabel}
                  </span>
                  <span className="font-mono text-slate-600 dark:text-zinc-300 truncate">
                    {singlePreview.previewUrl}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openAddPortalWithUrl(singleUrl.trim())}
                    className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 font-semibold inline-flex items-center gap-1 hover:bg-emerald-100/70 transition"
                  >
                    <Wand2 className="w-3 h-3" />
                    <span>Kiểm thử &amp; Lưu thành Chip Sàn</span>
                  </button>
                  <a
                    href={singlePreview.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 shrink-0 font-semibold"
                  >
                    <span>Mở thử</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {inputMode === "bulk_urls" && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
              <div className="lg:col-span-7">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-700 dark:text-zinc-300 font-semibold">
                    Danh sách URL hoặc Tên miền (mỗi dòng 1 địa chỉ):
                  </span>
                  {bulkUrlsText && (
                    <button
                      type="button"
                      onClick={() => setBulkUrlsText("")}
                      className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      <span>Xóa danh sách</span>
                    </button>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={bulkUrlsText}
                  onChange={(e) => setBulkUrlsText(e.target.value)}
                  placeholder="Nhập danh sách URL hoặc tên miền (VD: https://topcv.vn/viec-lam, mỗi dòng 1 địa chỉ)"
                  className="studio-input w-full px-3 py-2 text-xs font-mono leading-relaxed"
                />
              </div>

              <div className="lg:col-span-5 space-y-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Từ khóa lọc áp dụng cho danh sách URL (Tùy chọn)
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Nhập từ khóa công việc, kỹ năng hoặc vị trí..."
                      className="studio-input w-full h-9.5 pl-9 pr-8 text-xs font-medium"
                    />
                    {keyword && (
                      <button
                        type="button"
                        onClick={() => setKeyword("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isRunning && onCancelCrawl ? (
                  <button
                    type="button"
                    onClick={onCancelCrawl}
                    className="w-full h-9.5 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Dừng Quét Ngay</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={isRunning || !bulkUrlsText.trim()}
                    className="studio-btn-primary w-full h-9.5 px-4 text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>Chạy hàng loạt URL</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {inputMode === "keyword_search" && (
          <div className="space-y-3.5">
            {/* Row 1: Hero Global Keyword + Location + Run CTA */}
            <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-zinc-950/60 border border-slate-200/80 dark:border-zinc-800/80 space-y-2.5">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-end">
                <div className="lg:col-span-6">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <span>Từ khóa vị trí / kỹ năng cần thu thập</span>
                      <span className="font-normal text-[11px] text-slate-400">
                        (ngăn cách bằng dấu phẩy `,`)
                      </span>
                    </label>
                    <span
                      className={`text-[11px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                        activeKeywordTokens.length > 0
                          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60"
                          : "text-slate-400 dark:text-zinc-500"
                      }`}
                    >
                      {activeKeywordTokens.length > 0
                        ? `${activeKeywordTokens.length} từ khóa mục tiêu`
                        : "Chế độ quét rộng toàn sàn"}
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      placeholder="Nhập chức danh, kỹ năng hoặc lĩnh vực (để trống nếu muốn lấy toàn bộ việc làm mới)..."
                      className="studio-input w-full h-10 pl-9 pr-8 text-xs font-medium"
                    />
                    {keyword && (
                      <button
                        type="button"
                        onClick={() => setKeyword("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <label className="block text-xs font-bold text-slate-800 dark:text-zinc-200 mb-1">
                    Khu vực làm việc
                  </label>
                  <div className="relative">
                    <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Vietnam, Ho Chi Minh, Ha Noi..."
                      className="studio-input w-full h-10 pl-9 pr-3 text-xs font-medium"
                    />
                  </div>
                </div>

                <div className="lg:col-span-3">
                  {isRunning && onCancelCrawl ? (
                    <button
                      type="button"
                      onClick={onCancelCrawl}
                      className="w-full h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition shadow-sm"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Dừng Quét ({selectedPlatforms.length} sàn)</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isRunning || selectedPlatforms.length === 0}
                      className="studio-btn-primary w-full h-10 px-4 text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isRunning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Đang quét {selectedPlatforms.length} sàn...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>
                            Bắt đầu Quét ({selectedPlatforms.length} sàn)
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Interactive Keyword Chips Preview */}
              {activeKeywordTokens.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                    Đang tìm:
                  </span>
                  {activeKeywordTokens.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 shadow-2xs"
                    >
                      <span>{kw}</span>
                      <button
                        type="button"
                        onClick={() => removeSingleKeyword(kw)}
                        className="text-indigo-400 hover:text-rose-500 transition"
                        title={`Bỏ từ khóa "${kw}"`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Row 2: Categorized 20-Portal Filter Bar & Tactile Matrix */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                {/* Category Tabs + Quick Selection */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-slate-900 dark:text-zinc-100 mr-1">
                    Nguồn quét ({selectedPlatforms.length}/{platforms.length || 20}):
                  </span>

                  {[
                    {
                      id: "all",
                      label: `Tất cả (${platforms.length || 20})`,
                      selectIds:
                        platforms.length > 0
                          ? platforms.map((p) => p.id)
                          : ALL_20_PORTAL_IDS,
                    },
                    {
                      id: "vn_general",
                      label: `Đa ngành VN (${VN_GENERAL_PORTAL_IDS.length})`,
                      selectIds: VN_GENERAL_PORTAL_IDS,
                    },
                    {
                      id: "tech_it",
                      label: `Công nghệ / IT (${TECH_IT_PORTAL_IDS.length})`,
                      selectIds: TECH_IT_PORTAL_IDS,
                    },
                    {
                      id: "global_remote",
                      label: `Quốc tế / Remote (${GLOBAL_REMOTE_PORTAL_IDS.length})`,
                      selectIds: GLOBAL_REMOTE_PORTAL_IDS,
                    },
                    ...(portalsWithJobsIds.length > 0
                      ? [
                          {
                            id: "has_jobs",
                            label: `Đang có Job (${portalsWithJobsIds.length})`,
                            selectIds: portalsWithJobsIds,
                          },
                        ]
                      : []),
                  ].map((grp) => {
                    const isCurrentTab = portalGroupTab === grp.id;
                    return (
                      <button
                        key={grp.id}
                        type="button"
                        onClick={() => {
                          setPortalGroupTab(grp.id as any);
                          setSelectedPlatforms(grp.selectIds);
                        }}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                          isCurrentTab
                            ? "bg-indigo-600 text-white shadow-2xs"
                            : "bg-slate-100 dark:bg-zinc-800/90 text-slate-700 dark:text-zinc-300 hover:bg-slate-200/80 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {grp.label}
                      </button>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setSelectedPlatforms([])}
                    className="px-2 py-1 rounded-md text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 text-[11px] font-medium transition"
                  >
                    Bỏ chọn hết
                  </button>
                </div>

                {/* Right Actions: Add Custom Portal & Per-Site Override Matrix */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openAddPortalWithUrl("")}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100/70 flex items-center gap-1 transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm Sàn Web Mới</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowPerSiteMatrix((v) => !v)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition-all ${
                      showPerSiteMatrix
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "studio-btn-secondary"
                    }`}
                  >
                    <span>
                      Từ khóa &amp; Link riêng từng sàn
                      {customOverrideCount > 0 ? ` (${customOverrideCount})` : ""}
                    </span>
                    {showPerSiteMatrix ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>

              {/* 10-Column High-Clarity Tactile Portal Cards Grid (20+ Portals) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-10 gap-2">
                {visiblePlatforms.map((p) => {
                  const active = selectedPlatforms.includes(p.id);
                  const customKw = (platformKeywords[p.id] || "").trim();
                  const jobCount =
                    portalJobCounts[p.name] ??
                    portalJobCounts[p.domain] ??
                    0;
                  const brand = PORTAL_BRAND_META[p.id] || {
                    code: (p.code || p.name.slice(0, 2)).toUpperCase(),
                    tag: p.region || "Custom",
                    accent: "bg-emerald-600 text-white",
                  };

                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePlatform(p.id)}
                      title={`${p.name} (${p.domain}) — ${jobCount} việc làm trong kho`}
                      className={`group relative px-2.5 py-2 rounded-xl border text-left transition-all flex items-center justify-between gap-1.5 ${
                        active
                          ? "bg-white dark:bg-zinc-900 border-indigo-500/80 dark:border-indigo-500/70 ring-1 ring-indigo-500/15 shadow-xs"
                          : "bg-slate-50/60 dark:bg-zinc-950/40 border-slate-200/80 dark:border-zinc-800/80 opacity-60 hover:opacity-100 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-6 h-6 rounded-lg flex items-center justify-center font-mono text-[10px] font-bold shrink-0 transition-transform group-hover:scale-105 ${
                            active
                              ? brand.accent
                              : "bg-slate-200/80 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400"
                          }`}
                        >
                          {brand.code}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 dark:text-zinc-100 truncate leading-tight">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-zinc-500 truncate leading-tight mt-0.5">
                            {brand.tag}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {p.is_custom && (
                          <span
                            role="button"
                            tabIndex={0}
                            title={`Xóa sàn ${p.name}`}
                            onClick={(e) => handleDeleteCustomPortal(e, p.id)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-600 dark:text-rose-400 transition"
                          >
                            <X className="w-3 h-3" />
                          </span>
                        )}
                        {customKw ? (
                          <span className="text-[10px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            ★
                          </span>
                        ) : jobCount > 0 ? (
                          <span className="px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60 font-bold">
                            {jobCount}
                          </span>
                        ) : null}
                        <span
                          className={`w-3.5 h-3.5 rounded flex items-center justify-center transition-colors ${
                            active
                              ? "bg-indigo-600 text-white"
                              : "border border-slate-300 dark:border-zinc-700"
                          }`}
                        >
                          {active && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {/* Quick "+ Thêm Sàn Mới" Chip at end of grid */}
                <button
                  type="button"
                  onClick={() => openAddPortalWithUrl("")}
                  title="Thêm một trang web tuyển dụng mới vào danh sách cố định"
                  className="px-2.5 py-2 rounded-xl border border-dashed border-emerald-400/90 dark:border-emerald-700/80 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">Thêm Sàn Mới</span>
                </button>
              </div>
            </div>

            {/* Per-Site Keyword & URL Override Matrix */}
            {showPerSiteMatrix && selectedPlatforms.length > 0 && (
              <div className="studio-subpanel overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-100/90 dark:bg-zinc-900 border-b border-slate-200/90 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-slate-800 dark:text-zinc-200">
                    Từ khóa &amp; URL riêng từng sàn
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPlatformKeywords({});
                      setPlatformUrls({});
                    }}
                    className="text-[11px] font-semibold text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white underline flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Đặt lại mặc định</span>
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-slate-200/70 dark:divide-zinc-800/70 text-xs">
                  {platforms
                    .filter((p) => selectedPlatforms.includes(p.id))
                    .map((p, idx) => {
                      const siteKw = platformKeywords[p.id] || "";
                      const effectiveKw = (
                        siteKw ||
                        keyword ||
                        "viec-lam"
                      ).trim();
                      const autoUrl = buildPreviewUrl(
                        p.id,
                        effectiveKw,
                        location,
                        platforms
                      );
                      const customUrl = platformUrls[p.id] || "";
                      const finalUrl = customUrl || autoUrl;
                      const brand = PORTAL_BRAND_META[p.id] || {
                        code: (p.code || p.name.slice(0, 2)).toUpperCase(),
                        tag: p.region,
                      };

                      return (
                        <div
                          key={p.id}
                          className="grid grid-cols-1 md:grid-cols-12 gap-2.5 px-3.5 py-2 items-center hover:bg-white/90 dark:hover:bg-zinc-900/50 transition"
                        >
                          <div className="md:col-span-3 flex items-center gap-2">
                            <span className="font-mono text-[11px] text-slate-400 w-4">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <span className="w-6 h-6 rounded border bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 border-zinc-900 dark:border-zinc-100 flex items-center justify-center font-mono text-[10px] font-bold shrink-0">
                              {brand.code}
                            </span>
                            <div className="min-w-0 flex items-center gap-1.5">
                              <div className="font-bold text-slate-900 dark:text-zinc-100 truncate">
                                {p.name}
                              </div>
                              {p.is_custom && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                  Custom
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="md:col-span-3 relative">
                            <input
                              type="text"
                              value={siteKw}
                              onChange={(e) =>
                                setPlatformKeywords((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              placeholder={
                                keyword
                                  ? `Theo từ khóa chung (${keyword})`
                                  : "Từ khóa riêng cho sàn này..."
                              }
                              className="studio-input w-full h-8 px-2.5 pr-6 text-xs"
                            />
                            {siteKw && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPlatformKeywords((prev) => ({
                                    ...prev,
                                    [p.id]: "",
                                  }))
                                }
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          <div className="md:col-span-6 flex items-center gap-1.5">
                            <input
                              type="text"
                              value={finalUrl}
                              onChange={(e) =>
                                setPlatformUrls((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              className="studio-input flex-1 h-8 px-2.5 text-[11px] font-mono text-slate-600 dark:text-zinc-300"
                            />
                            <a
                              href={finalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="studio-btn-secondary h-8 w-8 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Collapsible Advanced Execution Parameters */}
        {showAdvanced && (
          <div className="studio-subpanel p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                Chế độ vượt rào cản
              </label>
              <CustomSelect
                size="sm"
                value={nodeConfig.bypass_mode}
                onChange={(val) =>
                  onChangeConfig({ ...nodeConfig, bypass_mode: val })
                }
                icon={<Shield className="w-3.5 h-3.5" />}
                options={[
                  { value: "auto", label: "Tự động (TLS → Stealth)" },
                  { value: "fast_tls", label: "Fast TLS Fetch" },
                  { value: "stealth_browser", label: "Playwright Stealth" },
                  { value: "chrome_cdp", label: "Chrome CDP Profile" },
                  { value: "flaresolverr", label: "FlareSolverr Proxy" },
                ]}
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                Chế độ phân trang
              </label>
              <CustomSelect
                size="sm"
                value={String(nodeConfig.max_pages)}
                onChange={(val) =>
                  onChangeConfig({
                    ...nodeConfig,
                    max_pages: parseInt(val, 10),
                  })
                }
                icon={<Layers className="w-3.5 h-3.5" />}
                options={[
                  { value: "0", label: "Cào hết phân trang (Auto)" },
                  { value: "3", label: "Tối đa 3 trang / sàn" },
                  { value: "5", label: "Tối đa 5 trang / sàn" },
                  { value: "10", label: "Tối đa 10 trang / sàn" },
                  { value: "1", label: "Chỉ lấy Trang 1 (Nhanh)" },
                ]}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-zinc-400 mb-1">
                Chỉ dẫn AI bổ sung
              </label>
              <input
                type="text"
                value={nodeConfig.custom_ai_instruction}
                onChange={(e) =>
                  onChangeConfig({
                    ...nodeConfig,
                    custom_ai_instruction: e.target.value,
                  })
                }
                placeholder="VD: Ưu tiên việc làm có công khai mức lương và thông tin liên hệ HR..."
                className="studio-input w-full h-8 px-3 text-xs"
              />
            </div>
          </div>
        )}
      </form>

      {/* Modal: Thêm & Kiểm Thử Sàn Việc Làm Mới (Auto-Learn URL & Live Probe) */}
      {showAddPortalModal && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setShowAddPortalModal(false)}
        >
          <div
            className="bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                  <Wand2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-zinc-100">
                    Thêm &amp; Tự Động Học Web Việc Làm Mới
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Dán đường link trang kết quả tìm kiếm hoặc danh sách việc làm của sàn mới để hệ thống tự học quy luật
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddPortalModal(false)}
                className="h-7 w-7 rounded-lg hover:bg-slate-200/70 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  1. Đường link mẫu của trang web tuyển dụng mới
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Globe className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={newPortalUrlInput}
                      onChange={(e) => setNewPortalUrlInput(e.target.value)}
                      placeholder="VD: https://123job.vn/tuyen-dung hoặc https://ybox.vn/tuyen-dung"
                      className="studio-input w-full h-9 pl-9 pr-3 font-mono text-xs"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={probingPortal || !newPortalUrlInput.trim()}
                    onClick={handleRunLiveProbe}
                    className="studio-btn-secondary h-9 px-3.5 font-semibold inline-flex items-center gap-1.5 shrink-0 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                  >
                    {probingPortal ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang dò cấu trúc...</span>
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" />
                        <span>Kiểm thử tự động</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                  Mẹo: Dán đường link trang kết quả tìm kiếm hoặc danh sách việc làm của sàn mới để hệ thống tự nhận diện biến <code>{"{{keyword}}"}</code> chuẩn nhất.
                </p>
              </div>

              {probeError && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-medium">
                  {probeError}
                </div>
              )}

              {/* Auto-Learned Configuration Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
                <div className="sm:col-span-5">
                  <label className="block font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Tên hiển thị trên Chip Sàn
                  </label>
                  <input
                    type="text"
                    value={newPortalName}
                    onChange={(e) => setNewPortalName(e.target.value)}
                    placeholder="VD: 123Job, YBox, FPT Careers..."
                    className="studio-input w-full h-8.5 px-2.5 text-xs font-semibold"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Mã viết tắt (2 ký tự)
                  </label>
                  <input
                    type="text"
                    maxLength={3}
                    value={newPortalCode}
                    onChange={(e) => setNewPortalCode(e.target.value.toUpperCase())}
                    placeholder="VD: 12, YB"
                    className="studio-input w-full h-8.5 px-2.5 text-xs font-mono uppercase"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                    Chế độ nhận diện
                  </label>
                  <div className="h-8.5 px-2.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center text-[11px] font-mono text-slate-600 dark:text-zinc-300">
                    {probeResult
                      ? probeResult.has_dynamic_placeholder
                        ? "Động theo {{keyword}}"
                        : "Link danh sách cố định"
                      : "Tự động học khi lưu"}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-zinc-300 mb-1">
                  Mẫu URL tìm kiếm tự động (có thể chỉnh sửa <code>{"{{keyword}}"}</code> hoặc <code>{"{{slug}}"}</code>)
                </label>
                <input
                  type="text"
                  value={newPortalTemplate || newPortalUrlInput}
                  onChange={(e) => setNewPortalTemplate(e.target.value)}
                  placeholder="https://ten-mien-moi.vn/tim-viec?q={{keyword}}"
                  className="studio-input w-full h-8.5 px-2.5 font-mono text-xs text-indigo-700 dark:text-indigo-300"
                />
              </div>

              {/* Live Probe Results Preview */}
              {probeResult && (
                <div className="rounded-lg border border-slate-200 dark:border-zinc-800 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-100/90 dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[11px] inline-flex items-center gap-1 ${
                          probeResult.jobs_found > 0
                            ? "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300"
                            : "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300"
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          Phát hiện {probeResult.jobs_found} việc làm ngay trên Trang 1
                        </span>
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        ({probeResult.extraction_method} · {probeResult.tier_used})
                      </span>
                    </div>
                  </div>

                  {probeResult.sample_jobs.length > 0 ? (
                    <div className="divide-y divide-slate-100 dark:divide-zinc-800/70 max-h-48 overflow-y-auto">
                      {probeResult.sample_jobs.map((sj, i) => (
                        <div
                          key={i}
                          className="px-3 py-2 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-zinc-900/40"
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 dark:text-zinc-100 truncate">
                              {sj.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                              {sj.company_name} · {sj.location_city}
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-mono font-semibold text-[11px] shrink-0">
                            {sj.salary_raw}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 text-slate-500 dark:text-zinc-400 text-[11px]">
                      Chưa thấy thẻ job trên URL này. Hãy kiểm tra xem đường link đã dẫn tới trang danh sách việc làm chưa.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-zinc-900 border-t border-slate-200 dark:border-zinc-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddPortalModal(false)}
                className="studio-btn-secondary h-8.5 px-3 text-xs"
              >
                Đóng
              </button>
              <button
                type="button"
                disabled={savingPortal || !(newPortalTemplate || newPortalUrlInput).trim()}
                onClick={handleSaveCustomPortal}
                className="studio-btn-primary h-8.5 px-4 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {savingPortal ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                <span>Lưu vào Danh Sách Sàn Cố Định</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
