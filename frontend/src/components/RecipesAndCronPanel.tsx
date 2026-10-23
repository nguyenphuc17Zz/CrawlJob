import React, { useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Code2,
  Edit3,
  ExternalLink,
  Globe,
  Layers,
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { apiRequest } from "../api/client";
import { CustomSelect } from "./ui/CustomSelect";

interface Props {
  recipes: any[];
  sources: any[];
  platforms: any[];
  onAddRecipe: (payload: any) => Promise<void>;
  onDeleteRecipe: (id: number) => Promise<void>;
  onAddSource: (payload: any) => Promise<void>;
  onDeleteSource: (id: number) => Promise<void>;
  onRunSourceNow: (id: number) => Promise<void>;
  onToggleSource: (id: number) => Promise<void>;
}

export const RecipesAndCronPanel: React.FC<Props> = ({
  recipes,
  sources,
  platforms,
  onAddRecipe,
  onDeleteRecipe,
  onAddSource,
  onDeleteSource,
  onRunSourceNow,
  onToggleSource,
}) => {
  // Cron form state
  const [srcName, setSrcName] = useState("");
  const [srcUrlOrKw, setSrcUrlOrKw] = useState("");
  const [srcType, setSrcType] = useState<"url" | "keyword">("keyword");
  const [portalScope, setPortalScope] = useState<"all" | "jp_excel" | "it" | "custom">("all");
  const [customSelectedPlatforms, setCustomSelectedPlatforms] = useState<string[]>([
    "itviec",
    "topcv",
    "careerviet",
    "careerlink",
    "vietnamworks",
  ]);
  const [maxPages, setMaxPages] = useState<number>(1);
  const [intervalMin, setIntervalMin] = useState<number>(60);
  const [runningSourceId, setRunningSourceId] = useState<number | null>(null);

  // Recipe form & Auto-Suggest / Test state
  const [probeUrl, setProbeUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<any | null>(null);

  const [domain, setDomain] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [cardSelector, setCardSelector] = useState("");
  const [titleSelector, setTitleSelector] = useState("");
  const [companySelector, setCompanySelector] = useState("");
  const [salarySelector, setSalarySelector] = useState("");
  const [locationSelector, setLocationSelector] = useState("");
  const [learnedBy, setLearnedBy] = useState("manual");

  const resolveSelectedPlatforms = (): string[] => {
    const allIds =
      platforms.length > 0
        ? platforms.map((p) => p.id)
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
            "timviecnhanh",
            "tuyendung",
          ];

    if (portalScope === "all") return allIds;
    if (portalScope === "jp_excel") {
      return platforms.length > 0
        ? platforms.filter((p) => p.group === "jp_excel").map((p) => p.id)
        : allIds.slice(0, 12);
    }
    if (portalScope === "it") {
      return ["itviec", "topdev", "linkedin", "glints", "remoteok", "vietnamworks"];
    }
    return customSelectedPlatforms.length > 0 ? customSelectedPlatforms : allIds;
  };

  const toggleCustomPlatform = (pid: string) => {
    setCustomSelectedPlatforms((prev) =>
      prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]
    );
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!srcName.trim() || !srcUrlOrKw.trim()) return;
    await onAddSource({
      name: srcName.trim(),
      url_or_keyword: srcUrlOrKw.trim(),
      source_type: srcType,
      platforms: resolveSelectedPlatforms(),
      cron_interval_minutes: intervalMin,
      bypass_mode: "auto",
      deep_crawl_enabled: true,
      max_pages: maxPages,
    });
    setSrcName("");
    setSrcUrlOrKw("");
  };

  const handleTriggerSource = async (id: number) => {
    try {
      setRunningSourceId(id);
      await onRunSourceNow(id);
    } finally {
      setRunningSourceId(null);
    }
  };

  const handleAutoSuggestFromUrl = async (useExistingSelectors = false) => {
    const targetUrl = probeUrl.trim() || (domain.trim() ? `https://${domain.trim()}` : "");
    if (!targetUrl) {
      setProbeError("Vui lòng nhập URL trang tuyển dụng để tự động dò hoặc kiểm thử Selector.");
      return;
    }
    setProbing(true);
    setProbeError(null);
    try {
      const payload: any = { url: targetUrl };
      if (useExistingSelectors && cardSelector.trim() && titleSelector.trim()) {
        payload.domain = domain.trim();
        payload.recipe_name = recipeName.trim();
        payload.card_selector = cardSelector.trim();
        payload.title_selector = titleSelector.trim();
        payload.company_selector = companySelector.trim();
        payload.salary_selector = salarySelector.trim();
        payload.location_selector = locationSelector.trim();
      }
      const res = await apiRequest("/api/recipes/suggest", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setProbeResult(res);
      setDomain(res.domain || "");
      setRecipeName(res.recipe_name || `Auto Recipe (${res.domain})`);
      setCardSelector(res.card_selector || "");
      setTitleSelector(res.title_selector || "");
      setCompanySelector(res.company_selector || "");
      setSalarySelector(res.salary_selector || "");
      setLocationSelector(res.location_selector || "");
      if (!useExistingSelectors) {
        setLearnedBy("auto");
      }
    } catch (err: any) {
      setProbeError(err.message || "Không thể phân tích URL này.");
    } finally {
      setProbing(false);
    }
  };

  const handleLoadRecipeToEditor = (r: any) => {
    setDomain(r.domain || "");
    setRecipeName(r.recipe_name || `Recipe (${r.domain})`);
    setCardSelector(r.card_selector || "");
    setTitleSelector(r.title_selector || "");
    setCompanySelector(r.company_selector || "");
    setSalarySelector(r.salary_selector || "");
    setLocationSelector(r.location_selector || "");
    setLearnedBy(r.learned_by || "manual");
    if (!probeUrl.trim() && r.domain) {
      setProbeUrl(`https://${r.domain}`);
    }
  };

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || !cardSelector.trim() || !titleSelector.trim()) return;
    await onAddRecipe({
      domain: domain.trim(),
      recipe_name: recipeName.trim() || `Custom Recipe (${domain.trim()})`,
      card_selector: cardSelector.trim(),
      title_selector: titleSelector.trim(),
      company_selector: companySelector.trim(),
      salary_selector: salarySelector.trim(),
      location_selector: locationSelector.trim(),
      learned_by: learnedBy,
      link_selector: "a",
    });
    setDomain("");
    setRecipeName("");
    setCardSelector("");
    setTitleSelector("");
    setCompanySelector("");
    setSalarySelector("");
    setLocationSelector("");
  };

  const activeSourcesCount = sources.filter((s) => s.is_active !== 0).length;

  return (
    <div className="space-y-4">
      {/* Section 1: Cron Scheduler */}
      <div className="studio-card overflow-visible">
        <div className="p-4 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 space-y-3 rounded-t-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
                <CalendarClock className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  Lịch chạy định kỳ (Background Cron Daemon)
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Tự động quét ngầm theo chu kỳ hoặc kích hoạt chạy ngay lập tức trên toàn bộ {platforms.length || 16} sàn
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Cron Daemon Active (30s tick)</span>
              </span>
              <span className="font-mono text-zinc-500 dark:text-zinc-400">
                {activeSourcesCount}/{sources.length} lịch đang bật
              </span>
            </div>
          </div>

          <form onSubmit={handleAddSource} className="space-y-2.5 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
              <div className="md:col-span-2">
                <input
                  type="text"
                  value={srcName}
                  onChange={(e) => setSrcName(e.target.value)}
                  placeholder="Tên lịch (VD: Quét Việc Làm Mỗi Sáng)..."
                  className="studio-input w-full h-9 px-3"
                />
              </div>

              <div className="md:col-span-2">
                <CustomSelect
                  value={srcType}
                  onChange={(val) => setSrcType(val as "url" | "keyword")}
                  icon={<Globe className="w-3.5 h-3.5" />}
                  options={[
                    { value: "keyword", label: "Theo Từ khóa" },
                    { value: "url", label: "Theo URL cố định" },
                  ]}
                />
              </div>

              <div className={srcType === "keyword" ? "md:col-span-3" : "md:col-span-4"}>
                <input
                  type="text"
                  value={srcUrlOrKw}
                  onChange={(e) => setSrcUrlOrKw(e.target.value)}
                  placeholder={
                    srcType === "url"
                      ? "https://www.topcv.vn/viec-lam"
                      : "Nhập từ khóa cần quét (phân cách bằng dấu phẩy)"
                  }
                  className="studio-input w-full h-9 px-3"
                />
              </div>

              {srcType === "keyword" && (
                <div className="md:col-span-2">
                  <CustomSelect
                    value={portalScope}
                    onChange={(val) =>
                      setPortalScope(val as "all" | "jp_excel" | "it" | "custom")
                    }
                    icon={<Layers className="w-3.5 h-3.5" />}
                    options={[
                      {
                        value: "all",
                        label: `Tất cả (${platforms.length || 20} sàn)`,
                      },
                      { value: "jp_excel", label: "12 Sàn Phổ Biến" },
                      { value: "it", label: "Nhóm Sàn IT" },
                      {
                        value: "custom",
                        label: `Tùy chọn (${customSelectedPlatforms.length} sàn)`,
                      },
                    ]}
                  />
                </div>
              )}

              <div className="md:col-span-1">
                <CustomSelect
                  value={String(maxPages)}
                  onChange={(val) => setMaxPages(parseInt(val, 10))}
                  options={[
                    { value: "1", label: "1 trang" },
                    { value: "2", label: "2 trang" },
                    { value: "3", label: "3 trang" },
                    { value: "5", label: "5 trang" },
                    { value: "0", label: "Hết trang" },
                  ]}
                />
              </div>

              <div className="md:col-span-1">
                <CustomSelect
                  value={String(intervalMin)}
                  onChange={(val) => setIntervalMin(parseInt(val, 10))}
                  icon={<Clock className="w-3.5 h-3.5" />}
                  options={[
                    { value: "15", label: "15 phút" },
                    { value: "30", label: "30 phút" },
                    { value: "60", label: "1 giờ" },
                    { value: "180", label: "3 giờ" },
                    { value: "720", label: "12 giờ" },
                    { value: "1440", label: "24 giờ" },
                  ]}
                />
              </div>

              <div className="md:col-span-1">
                <button
                  type="submit"
                  className="studio-btn-primary w-full h-9 px-3 flex items-center justify-center gap-1 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm</span>
                </button>
              </div>
            </div>

            {srcType === "keyword" && portalScope === "custom" && (
              <div className="p-2.5 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold text-zinc-500 mr-1">
                  Chọn sàn cho lịch Cron:
                </span>
                {platforms.map((p) => {
                  const checked = customSelectedPlatforms.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleCustomPlatform(p.id)}
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border transition ${
                        checked
                          ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-950 dark:border-zinc-100"
                          : "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </form>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
          {sources.length === 0 ? (
            <div className="p-6 text-center text-zinc-400">
              Chưa có lịch chạy tự động nào. Hãy tạo lịch phía trên để hệ thống tự động quét ngầm!
            </div>
          ) : (
            sources.map((s) => {
              const isActive = s.is_active !== 0;
              let platList: string[] = [];
              try {
                platList = JSON.parse(s.platforms_json || "[]");
              } catch {
                platList = [];
              }
              const lastRunText = s.last_run_at
                ? new Date(s.last_run_at).toLocaleString("vi-VN")
                : "Chưa chạy lần nào";

              return (
                <div
                  key={s.id}
                  className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition ${
                    isActive
                      ? "hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40"
                      : "opacity-60 bg-zinc-50/40 dark:bg-zinc-900/30"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => onToggleSource(s.id)}
                      title={isActive ? "Đang bật (Nhấn để tạm dừng)" : "Đang tạm dừng (Nhấn để bật)"}
                      className={`h-6 px-2 rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 border transition ${
                        isActive
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      {isActive ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-2.5 h-2.5" />
                          <span>Paused</span>
                        </>
                      )}
                    </button>

                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-zinc-900 dark:text-zinc-100">
                          {s.name}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono text-[10px] uppercase">
                          {s.source_type === "keyword"
                            ? `KEYWORD · ${platList.length || platforms.length || 16} SÀN`
                            : "URL"}
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-mono text-[10px]">
                          Mỗi {s.cron_interval_minutes} phút ·{" "}
                          {s.max_pages === 0 ? "Hết trang" : `${s.max_pages || 1} trang/sàn`}
                        </span>
                      </div>

                      <div className="text-zinc-500 dark:text-zinc-400 font-mono text-[11px] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="text-zinc-800 dark:text-zinc-200 font-medium truncate max-w-md">
                          {s.url_or_keyword}
                        </span>
                        <span>• Lần chạy cuối: {lastRunText}</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          • Đã thu thập: +{s.total_jobs_collected || 0} jobs
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={runningSourceId === s.id}
                      onClick={() => handleTriggerSource(s.id)}
                      className="studio-btn-secondary h-7.5 px-2.5 text-xs inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                      title="Kích hoạt chạy tác vụ Cron này ngay lập tức"
                    >
                      {runningSourceId === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>Chạy ngay</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteSource(s.id)}
                      className="h-7.5 w-7.5 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition"
                      title="Xóa lịch Cron"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Section 2: Self-Healing & Auto-Suggest Domain Recipes */}
      <div className="studio-card overflow-hidden">
        <div className="p-4 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
                <Code2 className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  CSS Selector Recipes ({recipes.length}) — Thực thi trực tiếp tại Node 4
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Dán URL bất kỳ để tự động dò CSS Selector hoặc bấm vào từng thẻ Recipe bên dưới để chỉnh sửa &amp; kiểm thử trực tiếp
                </p>
              </div>
            </div>
          </div>

          {/* 1-Click Auto-Suggest & Live Test Bar */}
          <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
              <div className="relative flex-1">
                <Globe className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={probeUrl}
                  onChange={(e) => setProbeUrl(e.target.value)}
                  placeholder="Dán URL trang việc làm (VD: https://www.topcv.vn/tim-viec-lam-tieng-nhat) để tự động dò CSS Selector..."
                  className="studio-input w-full h-9 pl-9 pr-3 font-mono text-xs"
                />
              </div>

              <button
                type="button"
                disabled={probing}
                onClick={() => handleAutoSuggestFromUrl(false)}
                className="studio-btn-secondary h-9 px-3 text-xs inline-flex items-center justify-center gap-1.5 font-semibold shrink-0"
              >
                {probing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                )}
                <span>Tự dò Selector &amp; Test</span>
              </button>

              {cardSelector.trim() && titleSelector.trim() && (
                <button
                  type="button"
                  disabled={probing}
                  onClick={() => handleAutoSuggestFromUrl(true)}
                  className="studio-btn-secondary h-9 px-3 text-xs inline-flex items-center justify-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300 shrink-0"
                  title="Chạy thử bộ CSS Selector đang nhập bên dưới trên URL này"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Test Bộ Selector đang nhập</span>
                </button>
              )}
            </div>

            {probeError && (
              <div className="text-[11px] text-rose-600 dark:text-rose-400 font-medium px-1">
                {probeError}
              </div>
            )}

            {probeResult && (
              <div className="p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      Kết quả Test trên {probeResult.domain}:{" "}
                      <span className="text-emerald-600 dark:text-emerald-400">
                        {probeResult.jobs_found} việc làm
                      </span>{" "}
                      (Recipe khớp trực tiếp: {probeResult.recipe_hits} thẻ)
                    </span>
                  </div>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                    {probeResult.tier_used}
                  </span>
                </div>

                {Array.isArray(probeResult.sample_jobs) && probeResult.sample_jobs.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                    {probeResult.sample_jobs.map((sj: any, idx: number) => (
                      <a
                        key={idx}
                        href={sj.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 transition flex flex-col justify-between gap-1"
                      >
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-1 flex items-center justify-between gap-1">
                          <span className="truncate">{sj.title}</span>
                          <ExternalLink className="w-3 h-3 text-zinc-400 shrink-0" />
                        </div>
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          {sj.company_name}
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                            {sj.salary_raw}
                          </span>
                          <span className="truncate">{sj.location_city}</span>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recipe Editor Form */}
          <form
            onSubmit={handleAddRecipe}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 text-xs"
          >
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Domain (VD: topcv.vn)"
              className="studio-input h-9 px-3"
            />
            <input
              type="text"
              value={cardSelector}
              onChange={(e) => setCardSelector(e.target.value)}
              placeholder="Card Selector (.job-item)"
              className="studio-input h-9 px-3 font-mono"
            />
            <input
              type="text"
              value={titleSelector}
              onChange={(e) => setTitleSelector(e.target.value)}
              placeholder="Title Selector (h3 a)"
              className="studio-input h-9 px-3 font-mono"
            />
            <input
              type="text"
              value={companySelector}
              onChange={(e) => setCompanySelector(e.target.value)}
              placeholder="Company (.company)"
              className="studio-input h-9 px-3 font-mono"
            />
            <input
              type="text"
              value={salarySelector}
              onChange={(e) => setSalarySelector(e.target.value)}
              placeholder="Salary (.salary)"
              className="studio-input h-9 px-3 font-mono"
            />
            <input
              type="text"
              value={locationSelector}
              onChange={(e) => setLocationSelector(e.target.value)}
              placeholder="Location (.address)"
              className="studio-input h-9 px-3 font-mono"
            />
            <button
              type="submit"
              className="studio-btn-primary h-9 px-3 flex items-center justify-center gap-1.5 font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Lưu Recipe</span>
            </button>
          </form>
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {recipes.map((r) => (
            <div
              key={r.id}
              onClick={() => handleLoadRecipeToEditor(r)}
              className="studio-subpanel p-3.5 text-xs space-y-2 hover:border-zinc-400 dark:hover:border-zinc-600 transition cursor-pointer group"
              title="Nhấn để nạp Recipe này lên thanh chỉnh sửa & Test thử"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 truncate">
                    {r.domain}
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10px] font-mono uppercase">
                    {r.learned_by}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`font-mono font-semibold text-[10px] px-1.5 py-0.5 rounded ${
                      r.success_count > 0
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                        : "text-zinc-500 dark:text-zinc-400"
                    }`}
                  >
                    Hits: {r.success_count || 0}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLoadRecipeToEditor(r);
                    }}
                    className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                    title="Chỉnh sửa / Test Recipe"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRecipe(r.id);
                    }}
                    className="text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400"
                    title="Xóa Recipe"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 space-y-1 pt-1.5 border-t border-zinc-200/60 dark:border-zinc-800/80">
                <div className="truncate">
                  <span className="text-zinc-400">Card:</span> {r.card_selector}
                </div>
                <div className="truncate">
                  <span className="text-zinc-400">Title:</span> {r.title_selector}
                </div>
                {r.company_selector && (
                  <div className="truncate">
                    <span className="text-zinc-400">Company:</span> {r.company_selector}
                  </div>
                )}
                {r.salary_selector && (
                  <div className="truncate">
                    <span className="text-zinc-400">Salary:</span> {r.salary_selector}
                  </div>
                )}
                {r.location_selector && (
                  <div className="truncate">
                    <span className="text-zinc-400">Location:</span> {r.location_selector}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
