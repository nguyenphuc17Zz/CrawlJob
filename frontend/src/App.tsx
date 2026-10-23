import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Code2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  Loader2,
  MapPin,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Sparkles,
  Sun,
  Table2,
  Terminal,
  Trash2,
  TrendingUp,
  UserCheck,
} from "lucide-react";
import {
  apiRequest,
  ensureCsrfSession,
  JobItem,
  NodeConfig,
  PipelineNodeTelemetry,
} from "./api/client";
import { CrawlerCommandCenter } from "./components/CrawlerCommandCenter";
import { FilterBlacklistPanel } from "./components/FilterBlacklistPanel";
import { N8nPipelineCanvas } from "./components/N8nPipelineCanvas";
import { OfflineJdDrawer } from "./components/OfflineJdDrawer";
import { RecipesAndCronPanel } from "./components/RecipesAndCronPanel";
import { ResultsStudio } from "./components/ResultsStudio";
import { SettingsCenter } from "./components/SettingsCenter";

export const App: React.FC = () => {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("crawljob_theme");
      if (saved === "dark" || saved === "light") return saved;
    } catch {
      // ignore
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    try {
      localStorage.setItem("crawljob_theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<
    "pipeline" | "results" | "analytics" | "blacklist" | "recipes_cron" | "settings"
  >("pipeline");

  const [stats, setStats] = useState<any>({
    total_jobs: 0,
    highlighted_jobs: 0,
    with_hr_contact: 0,
    offline_ready: 0,
    recipes_count: 0,
    blacklist_count: 0,
  });

  const [platforms, setPlatforms] = useState<any[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [domains, setDomains] = useState<string[]>([]);

  // Active CrawlRun & Node Telemetry
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [activeRunInfo, setActiveRunInfo] = useState<any | null>(null);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [pipelineNodes, setPipelineNodes] = useState<PipelineNodeTelemetry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const prevRunningRef = useRef(false);

  // Offline JD Drawer
  const [drawerJob, setDrawerJob] = useState<JobItem | null>(null);
  const [enrichingSingle, setEnrichingSingle] = useState(false);

  // Filter rules, Recipes, Sources, Settings, Proxies
  const [filterRules, setFilterRules] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [proxies, setProxies] = useState<any[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [nodeConfig, setNodeConfig] = useState<NodeConfig>({
    enabled: true,
    bypass_mode: "auto",
    scroll_times: 2,
    max_pages: 0,
    enable_sniffer: true,
    enable_recipe_cache: true,
    enable_ai_fallback: true,
    enable_deep_crawl: true,
    deep_crawl_delay_min: 1.5,
    deep_crawl_delay_max: 3.0,
    deep_crawl_max_items: 60,
    enable_filter_blacklist: true,
    enable_notifications: true,
    custom_ai_instruction: "",
  });

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const fetchStatsAndJobs = useCallback(async () => {
    try {
      const [st, jRes] = await Promise.all([
        apiRequest("/api/stats"),
        apiRequest("/api/jobs"),
      ]);
      setStats(st);
      setJobs(jRes.jobs || []);
      setDomains(jRes.domains || []);
    } catch {
      // ignore initial load error
    }
  }, []);

  const fetchAuxiliaryData = useCallback(async () => {
    try {
      const [platRes, filtRes, recRes, srcRes, setRes, prxRes, runsRes] =
        await Promise.all([
          apiRequest("/api/platforms"),
          apiRequest("/api/filters"),
          apiRequest("/api/recipes"),
          apiRequest("/api/sources"),
          apiRequest("/api/settings"),
          apiRequest("/api/proxies"),
          apiRequest("/api/crawl/runs?limit=8"),
        ]);
      setPlatforms(platRes.platforms || []);
      setFilterRules(filtRes.rules || []);
      setRecipes(recRes.recipes || []);
      setSources(srcRes.sources || []);
      setSettings(setRes.settings || {});
      setProxies(prxRes.proxies || []);

      const runList = runsRes.runs || [];
      setRecentRuns(runList);
      if (!activeRunId && runList.length > 0) {
        setActiveRunId(runList[0].id);
      }
    } catch {
      // ignore
    }
  }, [activeRunId]);

  useEffect(() => {
    ensureCsrfSession().then(() => {
      fetchStatsAndJobs();
      fetchAuxiliaryData();
    });
  }, [fetchStatsAndJobs, fetchAuxiliaryData]);

  // Real-time Server-Sent Events (SSE) push stream + fallback polling
  useEffect(() => {
    if (!activeRunId) return;
    let timer: any = null;
    let es: EventSource | null = null;

    const pollRun = async () => {
      try {
        const detail = await apiRequest(`/api/crawl/runs/${activeRunId}`);
        setActiveRunInfo(detail.run);
        setPipelineNodes(detail.nodes || []);

        const deepPending =
          detail.run.deep_crawl_total > detail.run.deep_crawl_completed;
        const nowRunning = detail.run.status === "running";
        const stillActive = nowRunning || deepPending;

        if (prevRunningRef.current && !nowRunning) {
          if (detail.run.status === "cancelled") {
            showToast(`Đã dừng quét Run #${activeRunId}.`);
          } else {
            showToast(
              `Hoàn tất quét! Thu thập +${detail.run.new_jobs_saved || 0} việc làm mới.`
            );
          }
        }
        prevRunningRef.current = nowRunning;
        setIsRunning(nowRunning);

        fetchStatsAndJobs();
        if (stillActive) {
          timer = setTimeout(pollRun, 3500);
        }
      } catch {
        setIsRunning(false);
      }
    };

    pollRun();

    try {
      es = new EventSource("/api/events");
      es.addEventListener("node_updated", (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (Number(data.run_id) === Number(activeRunId)) {
            setPipelineNodes((prev) =>
              prev.map((n) =>
                n.node_id === data.node_id
                  ? {
                      ...n,
                      status: data.status,
                      duration_ms: data.duration_ms,
                      logs_text: data.logs_text,
                      items_in: data.items_in,
                      items_out: data.items_out,
                      screenshot_url: data.screenshot_url || n.screenshot_url,
                      updated_at: data.updated_at,
                    }
                  : n
              )
            );
          }
        } catch {
          // ignore parse error
        }
      });
      es.addEventListener("run_updated", (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (Number(data.run_id) === Number(activeRunId)) {
            pollRun();
          }
        } catch {
          // ignore
        }
      });
    } catch {
      // EventSource fallback to polling
    }

    return () => {
      if (timer) clearTimeout(timer);
      if (es) es.close();
    };
  }, [activeRunId, fetchStatsAndJobs]);

  const portalJobCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      if (j.portal_name) counts[j.portal_name] = (counts[j.portal_name] || 0) + 1;
      if (j.source_domain) counts[j.source_domain] = (counts[j.source_domain] || 0) + 1;
    }
    return counts;
  }, [jobs]);

  const handleStartCrawl = async (payload: {
    mode: "single_url" | "bulk_urls" | "keyword_search";
    urls: string[];
    keyword: string;
    location: string;
    platforms: string[];
    platform_keywords?: Record<string, string>;
    platform_urls?: Record<string, string>;
  }) => {
    try {
      setIsRunning(true);
      prevRunningRef.current = true;
      const res = await apiRequest("/api/crawl/start", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          node_config: nodeConfig,
        }),
      });
      setActiveRunId(res.run_id);
      fetchAuxiliaryData();
      showToast(`Pipeline Run #${res.run_id} đã khởi chạy`);
    } catch (err: any) {
      setIsRunning(false);
      prevRunningRef.current = false;
      showToast(`Lỗi: ${err.message}`);
    }
  };

  const handleCancelCrawl = async () => {
    if (!activeRunId) return;
    try {
      await apiRequest(`/api/crawl/runs/${activeRunId}/cancel`, {
        method: "POST",
      });
      setIsRunning(false);
      prevRunningRef.current = false;
      showToast(`Đang dừng Pipeline Run #${activeRunId}...`);
    } catch (err: any) {
      showToast(`Lỗi khi dừng quét: ${err.message}`);
    }
  };

  const handleOpenOfflineJd = async (jobOrId: JobItem | number) => {
    const jobId = typeof jobOrId === "number" ? jobOrId : jobOrId.id;
    try {
      const res = await apiRequest(`/api/jobs/${jobId}`);
      setDrawerJob(res.job);
    } catch (err: any) {
      showToast(`Không thể mở JD: ${err.message}`);
    }
  };

  const handleEnrichSingleJob = async (jobId: number) => {
    try {
      setEnrichingSingle(true);
      const res = await apiRequest(`/api/jobs/${jobId}/enrich`, {
        method: "POST",
      });
      setDrawerJob(res.job);
      fetchStatsAndJobs();
      showToast("Đã cập nhật đầy đủ nội dung JD & liên hệ HR");
    } catch (err: any) {
      showToast(`Lỗi Deep Crawl: ${err.message}`);
    } finally {
      setEnrichingSingle(false);
    }
  };

  const handleChangeJobStatus = async (jobId: number, status: string) => {
    await apiRequest(`/api/jobs/${jobId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    fetchStatsAndJobs();
  };

  const handleDeleteJob = async (jobId: number) => {
    await apiRequest(`/api/jobs/${jobId}`, { method: "DELETE" });
    if (drawerJob?.id === jobId) {
      setDrawerJob(null);
    }
    fetchStatsAndJobs();
    showToast("Đã xóa việc làm khỏi Database");
  };

  const handleClearJobs = async (_mode: "all" | "keep_saved" = "all") => {
    try {
      const res = await apiRequest("/api/jobs/clear", {
        method: "POST",
        body: JSON.stringify({ mode: "all" }),
      });
      setIsRunning(false);
      prevRunningRef.current = false;
      setActiveRunId(null);
      setActiveRunInfo(null);
      setPipelineNodes([]);
      setRecentRuns([]);
      setDrawerJob(null);
      await fetchStatsAndJobs();
      await fetchAuxiliaryData();
      showToast(
        `Đã xóa sạch 100% (${res.deleted_count} việc làm) trong Database & dọn sạch bộ nhớ!`
      );
    } catch (err: any) {
      showToast(`Lỗi xóa dữ liệu: ${err.message}`);
    }
  };

  const jdCoveragePct =
    stats.total_jobs > 0
      ? Math.min(100, Math.round((stats.offline_ready / stats.total_jobs) * 100))
      : 0;

  const hrCoveragePct =
    stats.total_jobs > 0
      ? Math.min(100, Math.round((stats.with_hr_contact / stats.total_jobs) * 100))
      : 0;

  const tabTitles: Record<typeof activeTab, string> = {
    pipeline: "Pipeline & Điều Khiển Quét",
    results: "Bảng Kết Quả Tuyển Dụng",
    analytics: "Phân Tích & Thống Kê BI",
    blacklist: "Bộ Lọc & Blacklist",
    recipes_cron: "Selector Recipes & Lịch Cron",
    settings: "Cấu Hình Hệ Thống",
  };

  const navGroups: {
    groupLabel: string;
    items: {
      id: typeof activeTab;
      label: string;
      icon: React.ReactNode;
      badge?: number | string;
    }[];
  }[] = [
    {
      groupLabel: "KHÔNG GIAN LÀM VIỆC",
      items: [
        {
          id: "pipeline",
          label: "Pipeline & Quét",
          icon: <Layers className="w-4 h-4" />,
        },
        {
          id: "results",
          label: "Bảng Kết Quả",
          icon: <Table2 className="w-4 h-4" />,
          badge: stats.total_jobs,
        },
        {
          id: "analytics",
          label: "Thống Kê BI",
          icon: <BarChart3 className="w-4 h-4" />,
          badge: `${domains.length || 0}`,
        },
      ],
    },
    {
      groupLabel: "QUY TẮC & HỆ THỐNG",
      items: [
        {
          id: "blacklist",
          label: "Bộ Lọc & Blacklist",
          icon: <Filter className="w-4 h-4" />,
          badge: stats.blacklist_count,
        },
        {
          id: "recipes_cron",
          label: "Recipes & Lịch Cron",
          icon: <Code2 className="w-4 h-4" />,
          badge: stats.recipes_count,
        },
        {
          id: "settings",
          label: "Cấu Hình",
          icon: <Settings className="w-4 h-4" />,
        },
      ],
    },
  ];

  const isFullViewportTable = activeTab === "results";
  const highSalaryCount = useMemo(
    () => jobs.filter((j) => (j.salary_vnd_normalized || 0) >= 25).length,
    [jobs]
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#09090b] text-slate-900 dark:text-zinc-100 flex items-start">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl bg-indigo-950 dark:bg-zinc-100 text-white dark:text-zinc-950 font-medium text-xs shadow-xl border border-indigo-800 dark:border-zinc-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Left Sidebar (Collapsible w-56 <-> w-14 Icon Rail) */}
      <aside
        className={`sticky top-0 h-screen overflow-y-auto shrink-0 border-r border-slate-200/90 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex flex-col justify-between select-none z-30 transition-all duration-150 ${
          sidebarCollapsed ? "w-14" : "w-56"
        }`}
      >
        <div>
          {/* App Brand Header */}
          <div className="h-11 px-3 border-b border-slate-200/80 dark:border-zinc-800 flex items-center justify-between">
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                <div className="font-bold text-xs tracking-tight text-slate-950 dark:text-zinc-50 truncate">
                  CrawlJob Studio
                </div>
                <span className="text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60">
                  v3.0
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title={sidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng"}
              className={`h-7 w-7 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-500 hover:text-slate-900 dark:hover:text-zinc-100 flex items-center justify-center transition ${
                sidebarCollapsed ? "mx-auto" : ""
              }`}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Categorized Navigation Menu */}
          <div className="p-2 space-y-3">
            {navGroups.map((group) => (
              <div key={group.groupLabel} className="space-y-1">
                {!sidebarCollapsed && (
                  <div className="px-2.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                    {group.groupLabel}
                  </div>
                )}
                {group.items.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      title={sidebarCollapsed ? item.label : undefined}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full h-8.5 ${
                        sidebarCollapsed ? "px-0 justify-center" : "px-2.5 justify-between"
                      } rounded-lg text-xs font-medium flex items-center transition-all ${
                        isActive
                          ? "bg-indigo-600 text-white dark:bg-indigo-500 font-semibold shadow-2xs"
                          : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-900 hover:text-slate-950 dark:hover:text-zinc-100"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 truncate">
                        <span className={isActive ? "opacity-100" : "opacity-75"}>
                          {item.icon}
                        </span>
                        {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                      </span>
                      {!sidebarCollapsed && item.badge !== undefined && (
                        <span
                          className={`font-mono text-[10px] font-semibold tabular-nums px-1.5 py-0.2 rounded ${
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 border border-slate-200/80 dark:border-zinc-800"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Footer: Telemetry Card & Theme Switcher */}
        <div className="p-2.5 border-t border-slate-200/80 dark:border-zinc-800 space-y-2">
          {!sidebarCollapsed ? (
            <>
              <div className="studio-subpanel px-2.5 py-1.5 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-zinc-200">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isRunning ? "bg-indigo-600 dark:bg-indigo-400 animate-ping" : "bg-emerald-500"
                    }`}
                  />
                  <span>{isRunning ? "Đang quét..." : "Sẵn sàng"}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-zinc-400">
                  {domains.length}/{platforms.length || 20} Sàn
                </span>
              </div>

              <div className="p-0.5 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 grid grid-cols-2 gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`h-6.5 px-2 rounded-md flex items-center justify-center gap-1 font-medium transition-all ${
                    theme === "light"
                      ? "bg-white text-slate-950 shadow-2xs border border-slate-200/80"
                      : "text-slate-500 hover:text-slate-900 dark:text-zinc-400"
                  }`}
                >
                  <Sun className="w-3 h-3" />
                  <span>Sáng</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`h-6.5 px-2 rounded-md flex items-center justify-center gap-1 font-medium transition-all ${
                    theme === "dark"
                      ? "bg-zinc-800 text-zinc-100 shadow-2xs border border-zinc-700"
                      : "text-slate-500 hover:text-slate-900 dark:text-zinc-400"
                  }`}
                >
                  <Moon className="w-3 h-3" />
                  <span>Tối</span>
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              title="Đổi giao diện Sáng / Tối"
              className="w-full h-8 rounded-lg bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-center text-slate-700 dark:text-zinc-300"
            >
              {theme === "light" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </aside>

      {/* Main Workspace Container */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${
          isFullViewportTable ? "h-screen overflow-hidden" : ""
        }`}
      >
        {/* Compact Topbar Header (h-11 = 44px) */}
        <header className="sticky top-0 z-20 h-11 shrink-0 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md border-b border-slate-200/90 dark:border-zinc-800 px-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-xs font-bold uppercase tracking-wider text-slate-950 dark:text-zinc-50 truncate">
              {tabTitles[activeTab]}
            </h1>
            {activeRunInfo && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60">
                Run #{activeRunInfo.id}
              </span>
            )}
          </div>

          {/* Right Quick Actions & Status Pill */}
          <div className="flex items-center gap-1.5 text-xs shrink-0">
            {activeTab !== "results" && stats.total_jobs > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("results")}
                className="studio-btn-primary h-7.5 px-2.5 text-xs inline-flex items-center gap-1.5"
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Bảng Kết Quả ({stats.total_jobs})</span>
              </button>
            )}

            {activeTab !== "analytics" && stats.total_jobs > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("analytics")}
                className="studio-btn-secondary h-7.5 px-2.5 text-xs inline-flex items-center gap-1.5"
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="hidden md:inline">Thống Kê BI</span>
              </button>
            )}

            {stats.total_jobs > 0 && (
              <button
                type="button"
                onClick={() => handleClearJobs("all")}
                className="studio-btn-secondary h-7.5 px-2.5 text-xs inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/50"
                title="Xóa sạch 100% dữ liệu trong Database ngay lập tức"
              >
                <Trash2 className="w-3 h-3" />
                <span className="hidden sm:inline">Xóa sạch DB</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                fetchStatsAndJobs();
                fetchAuxiliaryData();
                showToast("Đã làm mới dữ liệu");
              }}
              className="studio-btn-secondary h-7.5 px-2.5 text-xs flex items-center gap-1"
              title="Làm mới dữ liệu"
            >
              <RefreshCw className="w-3 h-3 text-slate-500" />
              <span className="hidden sm:inline">Làm mới</span>
            </button>

            <div className="h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />

            <div className="h-7.5 flex items-center gap-1.5 px-2.5 rounded-lg bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 font-mono text-[11px] text-slate-700 dark:text-zinc-300">
              <strong className="text-indigo-600 dark:text-indigo-400 tabular-nums">
                {stats.total_jobs} Jobs
              </strong>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span className="tabular-nums">{stats.offline_ready} JD</span>
              <span className="text-slate-300 dark:text-zinc-700">|</span>
              <span className="tabular-nums">{stats.with_hr_contact} HR</span>
            </div>
          </div>
        </header>

        {/* Live Crawl Progress Bar when active */}
        {isRunning && (
          <div className="bg-indigo-600 text-white px-4 py-1.5 text-xs shrink-0 flex items-center justify-between gap-2 relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 live-progress-shimmer" />
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>
                Đang thu thập dữ liệu đa luồng trên{" "}
                <strong>{(nodeConfig.selectedPlatforms || []).length} sàn tuyển dụng</strong>...
                Đã phát hiện <strong>{stats.total_jobs} việc làm</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("results")}
              className="px-2 py-0.5 rounded bg-white/15 hover:bg-white/25 text-white font-semibold text-[11px] shrink-0 transition"
            >
              Xem trực tiếp →
            </button>
          </div>
        )}

        {/* Workspace Body */}
        <main
          className={
            isFullViewportTable
              ? "flex-1 min-h-0 flex flex-col overflow-hidden p-2.5 w-full"
              : "flex-1 p-4 space-y-3.5 max-w-[1680px] w-full mx-auto"
          }
        >
          {activeTab === "pipeline" && (
            <>
              {/* 4 Visual Bento KPI Cards with Progress Bars */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Card 1: Kho Việc Làm */}
                <div
                  onClick={() => setActiveTab("results")}
                  className="studio-card p-3.5 cursor-pointer hover:border-indigo-400 dark:hover:border-indigo-500 transition-all group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Kho Việc Làm
                    </span>
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <Briefcase className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-zinc-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {stats.total_jobs.toLocaleString()}
                    </div>
                    <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                      {domains.length}/{platforms.length || 20} sàn có Job
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round((domains.length / Math.max(1, platforms.length || 20)) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Card 2: Full JD Offline */}
                <div
                  onClick={() => setActiveTab("results")}
                  className="studio-card p-3.5 cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500 transition-all group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Full JD Offline
                    </span>
                    <span className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <FileText className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-zinc-50">
                      {stats.offline_ready.toLocaleString()}
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                      Độ phủ {jdCoveragePct}% (Tự động tải)
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${jdCoveragePct}%` }}
                    />
                  </div>
                </div>

                {/* Card 3: Liên Hệ HR */}
                <div
                  onClick={() => setActiveTab("results")}
                  className="studio-card p-3.5 cursor-pointer hover:border-sky-400 dark:hover:border-sky-500 transition-all group"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                      Liên Hệ HR (Email / SĐT)
                    </span>
                    <span className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                      <UserCheck className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xl font-black font-mono tabular-nums text-slate-900 dark:text-zinc-50">
                      {stats.with_hr_contact.toLocaleString()}
                    </div>
                    <span className="text-[11px] font-semibold text-sky-600 dark:text-sky-400">
                      {hrCoveragePct}% bóc tách trực tiếp
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all duration-500"
                      style={{ width: `${hrCoveragePct}%` }}
                    />
                  </div>
                </div>

                {/* Card 4: Lương Cao & Thao tác nhanh */}
                <div className="studio-card p-3.5 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                        Lương ≥25Tr &amp; Xuất File
                      </div>
                      <div className="text-xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {highSalaryCount.toLocaleString()} Jobs
                      </div>
                    </div>
                    <span className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 pt-2">
                    <a
                      href="/api/export/xlsx"
                      className="studio-btn-secondary h-7 px-2.5 text-[11px] font-semibold inline-flex items-center gap-1 flex-1 justify-center"
                    >
                      <FileSpreadsheet className="w-3 h-3 text-emerald-600" />
                      <span>Xuất Excel</span>
                    </a>
                    {stats.total_jobs > 0 && (
                      <button
                        type="button"
                        onClick={() => handleClearJobs("all")}
                        className="studio-btn-secondary h-7 px-2.5 text-[11px] inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        title="Xóa toàn bộ kết quả cũ"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Xóa cũ</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <CrawlerCommandCenter
                platforms={platforms}
                portalJobCounts={portalJobCounts}
                nodeConfig={nodeConfig}
                onChangeConfig={setNodeConfig}
                onStartCrawl={handleStartCrawl}
                onCancelCrawl={handleCancelCrawl}
                onPlatformsChanged={(updated) => {
                  setPlatforms(updated);
                  showToast("Đã cập nhật danh sách sàn tuyển dụng");
                }}
                isRunning={isRunning}
              />

              <N8nPipelineCanvas
                nodes={pipelineNodes}
                nodeConfig={nodeConfig}
                onChangeConfig={setNodeConfig}
                activeRunInfo={activeRunInfo}
                recentRuns={recentRuns}
                onSelectRun={(runId) => setActiveRunId(runId)}
              />

              {/* Live Feed Preview: Việc Làm Vừa Thu Thập (Immediate Feedback without switching tabs) */}
              {jobs.length > 0 && (
                <div className="studio-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                        Việc Làm Vừa Thu Thập ({jobs.length.toLocaleString()} việc làm)
                      </h3>
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400 hidden sm:inline">
                        — Nhấn vào việc làm bất kỳ để đọc JD Offline ngay lập tức
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab("results")}
                      className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      <span>Mở toàn bộ trong Bảng Kết Quả &amp; Chế độ Xem Đôi</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200/70 dark:divide-zinc-800">
                    {jobs.slice(0, 6).map((job) => (
                      <div
                        key={job.id}
                        onClick={() => handleOpenOfflineJd(job.id)}
                        className="p-3.5 hover:bg-indigo-50/40 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors flex flex-col justify-between gap-2 group border-b border-slate-100 dark:border-zinc-800/60"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60">
                              {job.portal_name || job.source_domain}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60">
                              {job.salary_raw || "Thỏa thuận"}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-slate-900 dark:text-zinc-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 line-clamp-1">
                            {job.title}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-zinc-400 flex items-center gap-1 mt-0.5 truncate">
                            <Building2 className="w-3 h-3 shrink-0 text-slate-400" />
                            <span className="truncate">{job.company_name}</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 pt-1">
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{job.location_city}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold">
                            <span>Đọc JD</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {(activeTab === "results" || activeTab === "analytics") && (
            <ResultsStudio
              jobs={jobs}
              domains={domains}
              viewMode={activeTab === "analytics" ? "analytics" : "table"}
              onSwitchViewMode={(mode) =>
                setActiveTab(mode === "analytics" ? "analytics" : "results")
              }
              onRefresh={fetchStatsAndJobs}
              onSelectJob={(job) => handleOpenOfflineJd(job.id)}
              onUpdateStatus={handleChangeJobStatus}
              onDeleteJob={handleDeleteJob}
              onClearJobs={handleClearJobs}
              onGoToPipeline={() => setActiveTab("pipeline")}
            />
          )}

          {activeTab === "blacklist" && (
            <FilterBlacklistPanel
              rules={filterRules}
              onAddRule={async (ruleType, pattern, note) => {
                await apiRequest("/api/filters", {
                  method: "POST",
                  body: JSON.stringify({ rule_type: ruleType, pattern, note }),
                });
                fetchAuxiliaryData();
                fetchStatsAndJobs();
                showToast("Đã lưu quy tắc lọc");
              }}
              onDeleteRule={async (id) => {
                await apiRequest(`/api/filters/${id}`, { method: "DELETE" });
                fetchAuxiliaryData();
                fetchStatsAndJobs();
              }}
            />
          )}

          {activeTab === "recipes_cron" && (
            <RecipesAndCronPanel
              recipes={recipes}
              sources={sources}
              platforms={platforms}
              onAddRecipe={async (payload) => {
                await apiRequest("/api/recipes", {
                  method: "POST",
                  body: JSON.stringify(payload),
                });
                fetchAuxiliaryData();
                fetchStatsAndJobs();
                showToast("Đã lưu CSS Selector Recipe");
              }}
              onDeleteRecipe={async (id) => {
                await apiRequest(`/api/recipes/${id}`, { method: "DELETE" });
                fetchAuxiliaryData();
                fetchStatsAndJobs();
              }}
              onAddSource={async (payload) => {
                await apiRequest("/api/sources", {
                  method: "POST",
                  body: JSON.stringify(payload),
                });
                fetchAuxiliaryData();
                showToast("Đã thêm lịch chạy Cron");
              }}
              onDeleteSource={async (id) => {
                await apiRequest(`/api/sources/${id}`, { method: "DELETE" });
                fetchAuxiliaryData();
              }}
              onRunSourceNow={async (id) => {
                const res = await apiRequest(`/api/sources/${id}/run`, {
                  method: "POST",
                });
                if (res.sources) setSources(res.sources);
                if (res.run_id) {
                  setIsRunning(true);
                  prevRunningRef.current = true;
                  setActiveRunId(res.run_id);
                }
                fetchAuxiliaryData();
                showToast(`Đã kích hoạt chạy lịch Cron (Run #${res.run_id})`);
              }}
              onToggleSource={async (id) => {
                const res = await apiRequest(`/api/sources/${id}/toggle`, {
                  method: "PATCH",
                });
                if (res.sources) setSources(res.sources);
                showToast(
                  res.is_active ? "Đã bật lịch chạy tự động" : "Đã tạm dừng lịch chạy tự động"
                );
              }}
            />
          )}

          {activeTab === "settings" && (
            <SettingsCenter
              settings={settings}
              proxies={proxies}
              onSaveSettings={async (updated) => {
                await apiRequest("/api/settings", {
                  method: "POST",
                  body: JSON.stringify({ settings: updated }),
                });
                fetchAuxiliaryData();
                showToast("Đã lưu cấu hình hệ thống");
              }}
              onAddProxy={async (proxy_url, protocol, label) => {
                await apiRequest("/api/proxies", {
                  method: "POST",
                  body: JSON.stringify({ proxy_url, protocol, label }),
                });
                fetchAuxiliaryData();
                showToast("Đã thêm Proxy mới");
              }}
              onDeleteProxy={async (id) => {
                await apiRequest(`/api/proxies/${id}`, { method: "DELETE" });
                fetchAuxiliaryData();
              }}
            />
          )}
        </main>
      </div>

      <OfflineJdDrawer
        job={drawerJob}
        allJobs={jobs}
        onSelectJob={(jid) => handleOpenOfflineJd(jid)}
        onUpdateStatus={handleChangeJobStatus}
        onClose={() => setDrawerJob(null)}
        onEnrichSingle={handleEnrichSingleJob}
        enriching={enrichingSingle}
      />
    </div>
  );
};
