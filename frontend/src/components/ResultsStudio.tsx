import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Award,
  BarChart3,
  Bookmark,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Globe,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Phone,
  PlusCircle,
  RefreshCw,
  Search,
  Sparkles,
  Table2,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { apiRequest, JobItem } from "../api/client";
import { CustomSelect } from "./ui/CustomSelect";

interface Props {
  jobs: JobItem[];
  domains: string[];
  viewMode: "table" | "analytics";
  onSwitchViewMode: (mode: "table" | "analytics") => void;
  onRefresh: () => Promise<void>;
  onSelectJob: (job: JobItem) => void;
  onUpdateStatus: (jobId: number, status: string) => Promise<void>;
  onDeleteJob: (jobId: number) => Promise<void>;
  onClearJobs: (mode: "all" | "keep_saved") => Promise<void>;
  onGoToPipeline: () => void;
}

const ALL_KNOWN_PORTALS = [
  "ITviec",
  "TopCV",
  "CareerViet",
  "CareerLink",
  "JobsGO",
  "ViecOi",
  "Indeed",
  "LinkedIn",
  "JoyWork",
  "CVWork",
  "XemViec",
  "Joboko",
  "VietnamWorks",
  "Glints",
  "TopDev",
  "RemoteOK",
  "Vieclam24h",
  "123Job",
  "Devwork",
  "IconicJob",
];

const SALARY_BRACKET_ORDER = [
  "Trên 35 Triệu (High-Paying)",
  "20 - 35 Triệu",
  "12 - 20 Triệu",
  "Dưới 12 Triệu",
  "Thỏa thuận / Cạnh tranh",
];

const CRM_STATUS_OPTIONS = [
  { value: "new", label: "Chưa xem" },
  { value: "saved", label: "Đã lưu" },
  { value: "applied", label: "Đã nộp CV" },
  { value: "rejected", label: "Từ chối" },
];

function getCompanyInitials(name: string): string {
  const clean = (name || "")
    .replace(/^(công ty|cty|tnhh|cổ phần|cp|tập đoàn|chi nhánh)\s+/gi, "")
    .replace(/^(tnhh|cổ phần|cp|mtv)\s+/gi, "")
    .trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
  }
  return (clean.slice(0, 2) || "CO").toUpperCase();
}

export const ResultsStudio: React.FC<Props> = ({
  jobs,
  viewMode,
  onSwitchViewMode,
  onRefresh,
  onSelectJob,
  onUpdateStatus,
  onDeleteJob,
  onClearJobs,
  onGoToPipeline,
}) => {
  const [activeSheet, setActiveSheet] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedWorkMode, setSelectedWorkMode] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedBracket, setSelectedBracket] = useState<string>("");
  const [selectedLocationOrSkill, setSelectedLocationOrSkill] = useState<string>("");
  const [sortBy, setSortBy] = useState<"tier_desc" | "salary_desc" | "salary_asc" | "newest">("tier_desc");
  const [fourthTableMode, setFourthTableMode] = useState<"skills" | "locations">("skills");
  const [clearing, setClearing] = useState<boolean>(false);

  // Master-Detail Split-View & Active/Viewed JD Highlight State
  const [splitView, setSplitView] = useState<boolean>(true);
  const [splitJobDetail, setSplitJobDetail] = useState<JobItem | null>(null);
  const [activeJdId, setActiveJdId] = useState<number | null>(null);
  const [viewedJobIds, setViewedJobIds] = useState<Set<number>>(() => new Set());
  const [loadingSplitJob, setLoadingSplitJob] = useState<boolean>(false);
  const [enrichingSplitJob, setEnrichingSplitJob] = useState<boolean>(false);
  const [copiedContact, setCopiedContact] = useState<string | null>(null);

  // Infinite Scroll State (60 rows per batch for 60fps buttery-smooth rendering)
  const INFINITE_BATCH_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState<number>(INFINITE_BATCH_SIZE);
  const [showScrollTop, setShowScrollTop] = useState<boolean>(false);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLTableRowElement | null>(null);

  // Reset visible count and scroll to top when filter, sort, or active sheet changes
  useEffect(() => {
    setVisibleCount(INFINITE_BATCH_SIZE);
    setShowScrollTop(false);
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTop = 0;
    }
  }, [
    activeSheet,
    searchQuery,
    selectedWorkMode,
    selectedCategory,
    selectedBracket,
    selectedLocationOrSkill,
    sortBy,
  ]);

  // Horizontal Drag-to-Scroll for Sheet Tabs bar
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const isDraggingTabsRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragScrollLeftRef = useRef<number>(0);
  const dragMovedRef = useRef<boolean>(false);
  const [isGrabbingTabs, setIsGrabbingTabs] = useState<boolean>(false);

  const handleTabsMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    isDraggingTabsRef.current = true;
    dragMovedRef.current = false;
    dragStartXRef.current = e.pageX - el.offsetLeft;
    dragScrollLeftRef.current = el.scrollLeft;
    setIsGrabbingTabs(true);
  };

  const handleTabsMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingTabsRef.current) return;
    const el = tabsScrollRef.current;
    if (!el) return;
    const x = e.pageX - el.offsetLeft;
    const walk = (x - dragStartXRef.current) * 1.4;
    if (Math.abs(x - dragStartXRef.current) > 5) {
      dragMovedRef.current = true;
    }
    el.scrollLeft = dragScrollLeftRef.current - walk;
  };

  const handleTabsMouseUpOrLeave = () => {
    if (isDraggingTabsRef.current) {
      isDraggingTabsRef.current = false;
      setIsGrabbingTabs(false);
    }
  };

  const handleTabsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
    }
  };

  const scrollTabsBy = (delta: number) => {
    const el = tabsScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  // Compute portal list with counts (all 16 supported portals always visible)
  const portalGroups = useMemo(() => {
    const map = new Map<string, JobItem[]>();
    for (const p of ALL_KNOWN_PORTALS) {
      map.set(p, []);
    }
    for (const j of jobs) {
      const pName = j.portal_name || j.source_domain || "Khác";
      if (!map.has(pName)) map.set(pName, []);
      map.get(pName)!.push(j);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return ALL_KNOWN_PORTALS.indexOf(a[0]) - ALL_KNOWN_PORTALS.indexOf(b[0]);
    });
  }, [jobs]);

  // Pre-filtered sheet subsets
  const highPayJobs = useMemo(
    () => jobs.filter((j) => Number(j.salary_vnd_normalized || 0) >= 25),
    [jobs]
  );
  const newJobs = useMemo(
    () => jobs.filter((j) => Boolean(j.is_new_job) || j.status === "new"),
    [jobs]
  );
  const techJobs = useMemo(
    () =>
      jobs.filter((j) =>
        [
          "Công nghệ / Phần mềm",
          "IT / Phần mềm",
          "Kỹ thuật / Sản xuất",
          "BrSE (Kỹ sư cầu nối)",
          "IT Comtor",
        ].includes(j.job_category || "")
      ),
    [jobs]
  );
  const hrJobs = useMemo(
    () => jobs.filter((j) => Boolean(j.hr_email || j.hr_phone)),
    [jobs]
  );
  const savedJobs = useMemo(
    () => jobs.filter((j) => j.status === "saved" || j.status === "applied"),
    [jobs]
  );
  const remoteOrIntlJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.work_mode === "Remote" ||
          j.work_mode === "Hybrid" ||
          /remote|toàn quốc|nước ngoài|international/i.test(j.location_city || "")
      ),
    [jobs]
  );

  // Executive KPIs
  const kpiStats = useMemo(() => {
    const total = jobs.length;
    const withSalary = jobs.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
    const avgSalary =
      withSalary.length > 0
        ? withSalary.reduce((acc, j) => acc + Number(j.salary_vnd_normalized || 0), 0) /
          withSalary.length
        : 0;
    const maxSalary =
      withSalary.length > 0
        ? withSalary.reduce((m, j) => Math.max(m, Number(j.salary_vnd_normalized || 0)), 0)
        : 0;
    const activePortals = portalGroups.filter(([, list]) => list.length > 0).length;
    return {
      total,
      portalCount: activePortals,
      newCount: newJobs.length,
      highPayCount: highPayJobs.length,
      techCount: techJobs.length,
      remoteCount: remoteOrIntlJobs.length,
      withSalaryCount: withSalary.length,
      avgSalary,
      maxSalary,
    };
  }, [jobs, portalGroups, newJobs, highPayJobs, techJobs, remoteOrIntlJobs]);

  // Breakdown 1: By Portal
  const portalBreakdown = useMemo(() => {
    const total = Math.max(1, jobs.length);
    return portalGroups.map(([portalName, list]) => {
      const newCnt = list.filter((j) => Boolean(j.is_new_job) || j.status === "new").length;
      const salList = list.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
      const avgSal =
        salList.length > 0
          ? salList.reduce((s, j) => s + Number(j.salary_vnd_normalized || 0), 0) / salList.length
          : 0;
      return {
        portalName,
        count: list.length,
        newCount: newCnt,
        withSalaryCount: salList.length,
        avgSalary: avgSal,
        pct: (list.length / total) * 100,
      };
    });
  }, [jobs.length, portalGroups]);

  // Breakdown 2: By Salary Bracket
  const salaryBracketBreakdown = useMemo(() => {
    const total = Math.max(1, jobs.length);
    return SALARY_BRACKET_ORDER.map((bracket) => {
      const list = jobs.filter(
        (j) => (j.salary_bracket || "Thỏa thuận / Cạnh tranh") === bracket
      );
      const newCnt = list.filter((j) => Boolean(j.is_new_job) || j.status === "new").length;
      const avgScore =
        list.length > 0
          ? Math.round(
              list.reduce((s, j) => s + Number(j.quality_score || 70), 0) / list.length
            )
          : 0;
      const isHot = bracket.includes("35") || bracket.includes("20 - 35");
      return {
        bracket,
        count: list.length,
        newCount: newCnt,
        avgScore,
        isHot,
        pct: (list.length / total) * 100,
      };
    });
  }, [jobs]);

  // Breakdown 3: By Role / Category
  const categoryBreakdown = useMemo(() => {
    const total = Math.max(1, jobs.length);
    const map = new Map<string, JobItem[]>();
    for (const j of jobs) {
      const cat = j.job_category || "Chuyên ngành khác";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(j);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, list]) => {
        const newCnt = list.filter((j) => Boolean(j.is_new_job) || j.status === "new").length;
        const salList = list.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
        const avgSal =
          salList.length > 0
            ? salList.reduce((s, j) => s + Number(j.salary_vnd_normalized || 0), 0) /
              salList.length
            : 0;
        return {
          category,
          count: list.length,
          newCount: newCnt,
          avgSalary: avgSal,
          pct: (list.length / total) * 100,
        };
      });
  }, [jobs]);

  // Breakdown 4: By Skill/JLPT or Location
  const skillOrLocationBreakdown = useMemo(() => {
    const total = Math.max(1, jobs.length);
    const map = new Map<string, JobItem[]>();

    if (fourthTableMode === "skills") {
      for (const j of jobs) {
        const key =
          j.jlpt_level ||
          (Array.isArray(j.skills) && j.skills.length > 0 ? j.skills[0] : "Chuyên môn");
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(j);
      }
    } else {
      for (const j of jobs) {
        const loc = (j.location_city || "Vietnam").trim();
        if (!map.has(loc)) map.set(loc, []);
        map.get(loc)!.push(j);
      }
    }

    return Array.from(map.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([label, list]) => {
        const salList = list.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
        const avgSal =
          salList.length > 0
            ? salList.reduce((s, j) => s + Number(j.salary_vnd_normalized || 0), 0) /
              salList.length
            : 0;
        const maxSal =
          salList.length > 0
            ? salList.reduce((m, j) => Math.max(m, Number(j.salary_vnd_normalized || 0)), 0)
            : 0;
        return {
          label,
          count: list.length,
          avgSalary: avgSal,
          maxSalary: maxSal,
          pct: (list.length / total) * 100,
        };
      });
  }, [jobs, fourthTableMode]);

  // Active sheet base jobs
  const sheetBaseJobs = useMemo(() => {
    if (activeSheet === "all") return jobs;
    if (activeSheet === "high_pay") return highPayJobs;
    if (activeSheet === "new_jobs") return newJobs;
    if (activeSheet === "tech") return techJobs;
    if (activeSheet === "hr_contact") return hrJobs;
    if (activeSheet === "saved") return savedJobs;
    if (activeSheet.startsWith("portal:")) {
      const targetPortal = activeSheet.slice("portal:".length);
      return jobs.filter((j) => (j.portal_name || j.source_domain) === targetPortal);
    }
    return jobs;
  }, [activeSheet, jobs, highPayJobs, newJobs, techJobs, hrJobs, savedJobs]);

  // Apply search, filters, and sort on active sheet
  const filteredSheetJobs = useMemo(() => {
    let list = [...sheetBaseJobs];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (j) =>
          (j.title || "").toLowerCase().includes(q) ||
          (j.company_name || "").toLowerCase().includes(q) ||
          (j.location_city || "").toLowerCase().includes(q) ||
          (j.portal_name || "").toLowerCase().includes(q) ||
          (j.job_category || "").toLowerCase().includes(q) ||
          (j.jlpt_level || "").toLowerCase().includes(q) ||
          (j.skills || []).some((s) => s.toLowerCase().includes(q))
      );
    }

    if (selectedWorkMode) {
      list = list.filter((j) => j.work_mode === selectedWorkMode);
    }
    if (selectedCategory) {
      list = list.filter((j) => (j.job_category || "Chuyên ngành khác") === selectedCategory);
    }
    if (selectedBracket) {
      list = list.filter(
        (j) => (j.salary_bracket || "Thỏa thuận / Cạnh tranh") === selectedBracket
      );
    }
    if (selectedLocationOrSkill) {
      const target = selectedLocationOrSkill.toLowerCase();
      list = list.filter(
        (j) =>
          (j.location_city || "").toLowerCase() === target ||
          (j.jlpt_level || "").toLowerCase() === target ||
          (j.skills || []).some((s) => s.toLowerCase() === target)
      );
    }

    list.sort((a, b) => {
      if (sortBy === "salary_desc") {
        return (
          Number(b.salary_vnd_normalized || 0) - Number(a.salary_vnd_normalized || 0) ||
          b.id - a.id
        );
      }
      if (sortBy === "salary_asc") {
        const sa = Number(a.salary_vnd_normalized || 0) || 999999;
        const sb = Number(b.salary_vnd_normalized || 0) || 999999;
        return sa - sb || b.id - a.id;
      }
      if (sortBy === "newest") {
        return b.id - a.id;
      }
      return (
        Number(b.quality_score || 0) - Number(a.quality_score || 0) ||
        Number(b.salary_vnd_normalized || 0) - Number(a.salary_vnd_normalized || 0) ||
        b.id - a.id
      );
    });

    return list;
  }, [
    sheetBaseJobs,
    searchQuery,
    selectedWorkMode,
    selectedCategory,
    selectedBracket,
    selectedLocationOrSkill,
    sortBy,
  ]);

  // Infinite Scroll slice of filteredSheetJobs
  const paginatedJobs = useMemo(() => {
    return filteredSheetJobs.slice(0, visibleCount);
  }, [filteredSheetJobs, visibleCount]);

  const hasMoreJobs = visibleCount < filteredSheetJobs.length;

  const handleTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const shouldShowTop = el.scrollTop > 280;
    if (shouldShowTop !== showScrollTop) {
      setShowScrollTop(shouldShowTop);
    }
    if (
      visibleCount < filteredSheetJobs.length &&
      el.scrollHeight - el.scrollTop - el.clientHeight < 380
    ) {
      setVisibleCount((prev) =>
        Math.min(filteredSheetJobs.length, prev + INFINITE_BATCH_SIZE)
      );
    }
  };

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const root = tableViewportRef.current;
    if (!sentinel || !root || visibleCount >= filteredSheetJobs.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) =>
            Math.min(filteredSheetJobs.length, prev + INFINITE_BATCH_SIZE)
          );
        }
      },
      { root, rootMargin: "320px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredSheetJobs.length, viewMode]);

  const scrollToTableTop = () => {
    if (tableViewportRef.current) {
      tableViewportRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Active sheet header metadata
  const currentSheetMeta = useMemo(() => {
    const list = filteredSheetJobs;
    const newCnt = list.filter((j) => Boolean(j.is_new_job) || j.status === "new").length;
    const withSal = list.filter((j) => Number(j.salary_vnd_normalized || 0) > 0);
    const maxSal =
      withSal.length > 0
        ? withSal.reduce((m, j) => Math.max(m, Number(j.salary_vnd_normalized || 0)), 0)
        : 0;

    let label = "TỔNG HỢP TẤT CẢ VIỆC LÀM";
    if (activeSheet === "high_pay") label = "TOP LƯƠNG CAO (≥ 25 TRIỆU)";
    else if (activeSheet === "new_jobs") label = "VIỆC LÀM MỚI THU THẬP";
    else if (activeSheet === "tech") label = "CÔNG NGHỆ · KỸ THUẬT · IT";
    else if (activeSheet === "hr_contact") label = "CÓ EMAIL / SĐT HR TRỰC TIẾP";
    else if (activeSheet === "saved") label = "ĐÃ LƯU & ĐÃ NỘP CV";
    else if (activeSheet.startsWith("portal:")) {
      label = `SÀN: ${activeSheet.slice("portal:".length).toUpperCase()}`;
    }

    return {
      label,
      total: list.length,
      newCount: newCnt,
      withSalaryCount: withSal.length,
      maxSalary: maxSal,
    };
  }, [activeSheet, filteredSheetJobs]);

  const resetAllFilters = () => {
    setSearchQuery("");
    setSelectedWorkMode("");
    setSelectedCategory("");
    setSelectedBracket("");
    setSelectedLocationOrSkill("");
  };

  const handleDrilldownPortal = (portalName: string) => {
    resetAllFilters();
    setActiveSheet(`portal:${portalName}`);
    onSwitchViewMode("table");
  };

  const handleDrilldownBracket = (bracket: string) => {
    resetAllFilters();
    setSelectedBracket(bracket);
    setActiveSheet("all");
    onSwitchViewMode("table");
  };

  const handleDrilldownCategory = (category: string) => {
    resetAllFilters();
    setSelectedCategory(category);
    setActiveSheet("all");
    onSwitchViewMode("table");
  };

  const handleDrilldownSkillOrLoc = (label: string) => {
    resetAllFilters();
    setSelectedLocationOrSkill(label);
    setActiveSheet("all");
    onSwitchViewMode("table");
  };

  const handleTriggerClear = async (mode: "all" | "keep_saved" = "all") => {
    setClearing(true);
    try {
      await onClearJobs(mode);
      resetAllFilters();
      setActiveSheet("all");
      setSplitJobDetail(null);
      setActiveJdId(null);
      setViewedJobIds(new Set());
    } finally {
      setClearing(false);
    }
  };

  const jdBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const latestSplitRequestIdRef = useRef<number>(0);

  const markJobViewed = (jobId: number) => {
    setActiveJdId(jobId);
    setViewedJobIds((prev) => {
      if (prev.has(jobId)) return prev;
      const next = new Set(prev);
      next.add(jobId);
      return next;
    });
  };

  const loadSplitJobDetail = async (job: JobItem, isAutoInit: boolean = false) => {
    const reqId = ++latestSplitRequestIdRef.current;
    if (isAutoInit) {
      setActiveJdId(job.id);
    } else {
      markJobViewed(job.id);
    }
    setSplitJobDetail(job);
    setLoadingSplitJob(true);
    if (jdBodyScrollRef.current) {
      jdBodyScrollRef.current.scrollTop = 0;
    }
    try {
      const res = await apiRequest(`/api/jobs/${job.id}`);
      if (latestSplitRequestIdRef.current !== reqId) return;
      if (res?.job) {
        setSplitJobDetail(res.job);
      }
    } catch {
      // keep base job item
    } finally {
      if (latestSplitRequestIdRef.current === reqId) {
        setLoadingSplitJob(false);
      }
    }
  };

  const handleEnrichSplitJob = async (jobId: number) => {
    setEnrichingSplitJob(true);
    try {
      const res = await apiRequest(`/api/jobs/${jobId}/enrich`, {
        method: "POST",
      });
      if (res?.job) {
        setSplitJobDetail(res.job);
      }
      await onRefresh();
    } catch {
      // ignore
    } finally {
      setEnrichingSplitJob(false);
    }
  };

  const handleCopyContact = (e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedContact(text);
    setTimeout(() => setCopiedContact(null), 1800);
  };

  // Auto-select first job in Split-View when filtered sheet list changes
  useEffect(() => {
    if (!splitView || viewMode !== "table") return;
    if (filteredSheetJobs.length === 0) {
      setSplitJobDetail(null);
      setActiveJdId(null);
      return;
    }
    const stillInList =
      activeJdId !== null && filteredSheetJobs.some((j) => j.id === activeJdId);
    if (!stillInList) {
      loadSplitJobDetail(filteredSheetJobs[0], true);
    }
  }, [splitView, viewMode, filteredSheetJobs]);

  const renderTierBadge = (job: JobItem) => {
    const tier = job.quality_tier || "B-Tier";
    const score = job.quality_score || 65;
    if (tier === "S-Tier") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200/90 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70 tabular-nums">
          <Award className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>S · {score}đ</span>
        </span>
      );
    }
    if (tier === "A-Tier") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/90 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70 tabular-nums">
          <span>A · {score}đ</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700 tabular-nums">
        <span>B · {score}đ</span>
      </span>
    );
  };

  const hasActiveFilters = Boolean(
    searchQuery ||
      selectedWorkMode ||
      selectedCategory ||
      selectedBracket ||
      selectedLocationOrSkill
  );

  const bracketOptions = useMemo(
    () => [
      { value: "", label: "Khung lương: Tất cả" },
      ...SALARY_BRACKET_ORDER.map((b) => ({ value: b, label: b })),
    ],
    []
  );

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "Ngành nghề: Tất cả" },
      ...categoryBreakdown.map((c) => ({
        value: c.category,
        label: `${c.category} (${c.count})`,
      })),
    ],
    [categoryBreakdown]
  );

  const workModeOptions = useMemo(
    () => [
      { value: "", label: "Hình thức: Tất cả" },
      { value: "Remote", label: "Remote" },
      { value: "Hybrid", label: "Hybrid" },
      { value: "Onsite", label: "Onsite" },
    ],
    []
  );

  const sortOptions = useMemo(
    () => [
      { value: "tier_desc", label: "Sắp xếp: Điểm Tier" },
      { value: "salary_desc", label: "Lương: Cao → Thấp" },
      { value: "salary_asc", label: "Lương: Thấp → Cao" },
      { value: "newest", label: "Mới thu thập nhất" },
    ],
    []
  );

  if (jobs.length === 0) {
    return (
      <div className="studio-card p-12 text-center space-y-3 my-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto border border-indigo-200/80 dark:border-indigo-800/70">
          <FileSpreadsheet className="w-5 h-5" />
        </div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-50">
          Chưa có dữ liệu việc làm trong bộ nhớ
        </h2>
        <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
          Hãy chuyển sang trang Pipeline &amp; Quét để nhập từ khóa hoặc danh sách URL cần thu thập.
        </p>
        <button
          type="button"
          onClick={onGoToPipeline}
          className="studio-btn-primary h-9 px-4 text-xs inline-flex items-center gap-1.5"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>Bắt đầu quét từ khóa mới</span>
        </button>
      </div>
    );
  }

  /* ==========================================================================
     MODE A: EXECUTIVE BI ANALYTICS DASHBOARD (Sleek Bento Grid + Visual Bars)
     ========================================================================== */
  if (viewMode === "analytics") {
    const activePortalsWithData = portalBreakdown.filter((p) => p.count > 0);
    return (
      <div className="space-y-4">
        {/* Compact BI Header Bar */}
        <div className="studio-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 flex items-center justify-center text-white shrink-0 shadow-xs">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-50">
                  Trung Tâm Phân Tích &amp; Thống Kê Tuyển Dụng (BI)
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70 tabular-nums">
                  {kpiStats.total} Jobs · {kpiStats.portalCount}/20 Sàn hoạt động
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                Nhấn vào bất kỳ thẻ chỉ số hoặc dòng biểu đồ nào để mở thẳng Bảng Kết Quả đã lọc tương ứng
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSwitchViewMode("table")}
              className="studio-btn-primary h-8.5 px-3.5 text-xs inline-flex items-center gap-1.5"
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Mở Bảng Kết Quả ({jobs.length})</span>
            </button>

            <a
              href="/api/export/xlsx"
              className="studio-btn-secondary h-8.5 px-3 text-xs inline-flex items-center gap-1.5 font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Xuất Báo Cáo Excel (.xlsx)</span>
            </a>

            <button
              type="button"
              disabled={jobs.length === 0 || clearing}
              onClick={() => handleTriggerClear("all")}
              className="studio-btn-secondary h-8.5 px-3 text-xs inline-flex items-center gap-1.5 font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/50"
              title="Xóa sạch 100% việc làm trong Database ngay lập tức"
            >
              {clearing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Xóa sạch DB</span>
            </button>
          </div>
        </div>

        {/* 6 Executive KPI Cards with Progress Bars */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setActiveSheet("all");
              onSwitchViewMode("table");
            }}
            className="text-left studio-card p-3.5 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all group"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center justify-between">
              <span>TỔNG VIỆC LÀM</span>
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-indigo-600 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-zinc-50 mt-1 font-mono tabular-nums">
              {kpiStats.total.toLocaleString()}
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-indigo-600 rounded-full"
                style={{ width: `${Math.min(100, Math.round((kpiStats.portalCount / 20) * 100))}%` }}
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
              Phủ sóng {kpiStats.portalCount}/20 sàn
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setActiveSheet("new_jobs");
              onSwitchViewMode("table");
            }}
            className="text-left studio-card p-3.5 hover:border-sky-400 dark:hover:border-sky-700 transition-all group"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center justify-between">
              <span>VIỆC LÀM MỚI</span>
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-sky-600 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-zinc-50 mt-1 font-mono tabular-nums">
              {kpiStats.newCount.toLocaleString()}
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-sky-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((kpiStats.newCount / Math.max(1, kpiStats.total)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 tabular-nums">
              Chiếm {((kpiStats.newCount / Math.max(1, kpiStats.total)) * 100).toFixed(1)}% tổng số
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setActiveSheet("high_pay");
              onSwitchViewMode("table");
            }}
            className="text-left studio-card p-3.5 hover:border-emerald-400 dark:hover:border-emerald-700 transition-all group"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
              <span>LƯƠNG CAO (≥25TR)</span>
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-emerald-600 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 font-mono tabular-nums">
              {kpiStats.highPayCount.toLocaleString()}
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((kpiStats.highPayCount / Math.max(1, kpiStats.total)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 tabular-nums">
              Đỉnh:{" "}
              <strong className="text-slate-800 dark:text-zinc-200">
                {kpiStats.maxSalary > 0 ? `${kpiStats.maxSalary.toFixed(1)} Tr` : "Thỏa thuận"}
              </strong>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setActiveSheet("tech");
              onSwitchViewMode("table");
            }}
            className="text-left studio-card p-3.5 hover:border-indigo-400 dark:hover:border-indigo-700 transition-all group"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
              <span>CÔNG NGHỆ / IT</span>
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-indigo-600 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-zinc-50 mt-1 font-mono tabular-nums">
              {kpiStats.techCount.toLocaleString()}
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-indigo-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((kpiStats.techCount / Math.max(1, kpiStats.total)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
              Phần mềm &amp; Kỹ thuật
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setSelectedWorkMode("Remote");
              setActiveSheet("all");
              onSwitchViewMode("table");
            }}
            className="text-left studio-card p-3.5 hover:border-amber-400 dark:hover:border-amber-700 transition-all group"
          >
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center justify-between">
              <span>REMOTE / HYBRID</span>
              <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-amber-600 transition-opacity" />
            </div>
            <div className="text-2xl font-bold text-slate-900 dark:text-zinc-50 mt-1 font-mono tabular-nums">
              {kpiStats.remoteCount.toLocaleString()}
            </div>
            <div className="w-full h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-amber-500 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((kpiStats.remoteCount / Math.max(1, kpiStats.total)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
              Làm từ xa · Linh hoạt
            </div>
          </button>

          <div className="studio-card p-3.5 bg-emerald-50/45 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/50">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              LƯƠNG TRUNG BÌNH
            </div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 mt-1 font-mono tabular-nums">
              {kpiStats.avgSalary > 0 ? `${kpiStats.avgSalary.toFixed(1)} Tr` : "Thỏa thuận"}
            </div>
            <div className="w-full h-1.5 bg-emerald-200/60 dark:bg-emerald-950 rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-emerald-600 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((kpiStats.withSalaryCount / Math.max(1, kpiStats.total)) * 100))}%`,
                }}
              />
            </div>
            <div className="text-[11px] text-slate-600 dark:text-zinc-400 mt-1 tabular-nums">
              {kpiStats.withSalaryCount} job công khai lương
            </div>
          </div>
        </div>

        {/* Visual Distribution Charts Row (Top Portals & Salary Distribution) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* Chart A: Visual Portal Share */}
          <div className="studio-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                  Biểu Đồ Tỷ Trọng Nguồn Tuyển Dụng
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Phân bổ việc làm thu thập được giữa các cổng tuyển dụng đang có dữ liệu
                </p>
              </div>
              <span className="studio-badge font-mono text-[11px]">
                {activePortalsWithData.length}/20 sàn có job
              </span>
            </div>

            <div className="space-y-2">
              {(activePortalsWithData.length > 0
                ? activePortalsWithData.slice(0, 6)
                : portalBreakdown.slice(0, 6)
              ).map((item) => (
                <div
                  key={item.portalName}
                  onClick={() => handleDrilldownPortal(item.portalName)}
                  className="cursor-pointer group space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{item.portalName}</span>
                    </span>
                    <span className="font-mono text-[11px] text-slate-600 dark:text-zinc-400 tabular-nums">
                      <strong className="text-slate-900 dark:text-zinc-100">{item.count}</strong> jobs ({item.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(item.count > 0 ? 5 : 0, item.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart B: Visual Salary Distribution */}
          <div className="studio-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                  Biểu Đồ Phân Khúc Mức Lương
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                  Tương quan số lượng việc làm theo các dải thu nhập quy đổi (Triệu VNĐ/tháng)
                </p>
              </div>
              <span className="studio-badge font-mono text-[11px] text-emerald-700 dark:text-emerald-300">
                TB: {kpiStats.avgSalary > 0 ? `${kpiStats.avgSalary.toFixed(1)} Tr` : "Thỏa thuận"}
              </span>
            </div>

            <div className="space-y-2.5">
              {salaryBracketBreakdown.map((item) => (
                <div
                  key={item.bracket}
                  onClick={() => handleDrilldownBracket(item.bracket)}
                  className="cursor-pointer group space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 dark:text-zinc-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                      {item.bracket}
                    </span>
                    <span className="font-mono text-[11px] text-slate-600 dark:text-zinc-400 tabular-nums">
                      <strong className="text-slate-900 dark:text-zinc-100">{item.count}</strong> jobs ({item.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        item.isHot
                          ? "bg-gradient-to-r from-emerald-600 to-teal-400"
                          : "bg-gradient-to-r from-slate-500 to-slate-400"
                      }`}
                      style={{ width: `${Math.max(item.count > 0 ? 5 : 0, item.pct)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 2x2 Bento Breakdown Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {/* Table 1: Portal Breakdown */}
          <div className="studio-card overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                1. Thống Kê Theo 20 Cổng Tuyển Dụng (Click mở Bảng)
              </span>
              <span className="studio-badge font-mono tabular-nums text-[11px]">
                {portalBreakdown.length} sàn
              </span>
            </div>
            <div className="overflow-auto max-h-[260px]">
              <table className="luxury-table">
                <thead>
                  <tr>
                    <th className="py-2 px-3">Cổng Tuyển Dụng</th>
                    <th className="py-2 px-3 text-right">Tổng</th>
                    <th className="py-2 px-3 text-right">Mới</th>
                    <th className="py-2 px-3 text-right">Lương TB</th>
                    <th className="py-2 px-3 w-36">Tỷ Trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {portalBreakdown.map((item) => (
                    <tr
                      key={item.portalName}
                      onClick={() => handleDrilldownPortal(item.portalName)}
                      className="cursor-pointer group"
                    >
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        <div className="flex items-center gap-1.5">
                          <Globe className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span>{item.portalName}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-950 dark:text-zinc-50 font-mono tabular-nums">
                        {item.count}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 dark:text-zinc-400 font-mono tabular-nums">
                        {item.newCount}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                        {item.avgSalary > 0 ? `${item.avgSalary.toFixed(1)} Tr` : "Thỏa thuận"}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-600 dark:bg-indigo-400 rounded-full"
                              style={{ width: `${Math.max(item.count > 0 ? 4 : 0, item.pct)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 dark:text-zinc-400 w-10 text-right tabular-nums">
                            {item.pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2: Salary Bracket Breakdown */}
          <div className="studio-card overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                2. Phân Khúc Mức Lương Quy Đổi (Click lọc Bảng)
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Triệu VNĐ/tháng</span>
            </div>
            <div className="overflow-auto max-h-[260px]">
              <table className="luxury-table">
                <thead>
                  <tr>
                    <th className="py-2 px-3">Phân Khúc Mức Lương</th>
                    <th className="py-2 px-3 text-right">Số Job</th>
                    <th className="py-2 px-3 text-right">Điểm TB</th>
                    <th className="py-2 px-3 text-center">Nhãn</th>
                    <th className="py-2 px-3 w-36">Tỷ Trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryBracketBreakdown.map((item) => (
                    <tr
                      key={item.bracket}
                      onClick={() => handleDrilldownBracket(item.bracket)}
                      className="cursor-pointer group"
                    >
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-zinc-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                        {item.bracket}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-950 dark:text-zinc-50 font-mono tabular-nums">
                        {item.count}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 dark:text-zinc-400 font-mono tabular-nums">
                        {item.avgScore > 0 ? `${item.avgScore}đ` : "-"}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.isHot ? (
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70">
                            Hot Deal
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                            Đang tuyển
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-600 dark:bg-emerald-400 rounded-full"
                              style={{ width: `${Math.max(item.count > 0 ? 4 : 0, item.pct)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 dark:text-zinc-400 w-10 text-right tabular-nums">
                            {item.pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 3: Role & Category Breakdown */}
          <div className="studio-card overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                3. Nhóm Ngành Nghề &amp; Vai Trò (Click lọc Bảng)
              </span>
              <span className="text-[11px] text-slate-500">Phân loại tự động</span>
            </div>
            <div className="overflow-auto max-h-[260px]">
              <table className="luxury-table">
                <thead>
                  <tr>
                    <th className="py-2 px-3">Nhóm Ngành Nghề</th>
                    <th className="py-2 px-3 text-right">Số Job</th>
                    <th className="py-2 px-3 text-right">Mới</th>
                    <th className="py-2 px-3 text-right">Lương TB</th>
                    <th className="py-2 px-3 w-36">Tỷ Trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBreakdown.map((item) => (
                    <tr
                      key={item.category}
                      onClick={() => handleDrilldownCategory(item.category)}
                      className="cursor-pointer group"
                    >
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-zinc-100 group-hover:text-violet-600 dark:group-hover:text-violet-400">
                        {item.category}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-950 dark:text-zinc-50 font-mono tabular-nums">
                        {item.count}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-600 dark:text-zinc-400 font-mono tabular-nums">
                        {item.newCount}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                        {item.avgSalary > 0 ? `${item.avgSalary.toFixed(1)} Tr` : "Thỏa thuận"}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-violet-600 dark:bg-violet-400 rounded-full"
                              style={{ width: `${Math.max(item.count > 0 ? 4 : 0, item.pct)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 dark:text-zinc-400 w-10 text-right tabular-nums">
                            {item.pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 4: Skills or Location Breakdown */}
          <div className="studio-card overflow-hidden">
            <div className="px-3.5 py-1.5 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                4. Kỹ Năng &amp; Khu Vực
              </span>
              <div className="inline-flex rounded-md p-0.5 bg-slate-200/80 dark:bg-zinc-900 border border-slate-300/60 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setFourthTableMode("skills")}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                    fourthTableMode === "skills"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                      : "text-slate-600 dark:text-zinc-400"
                  }`}
                >
                  Kỹ Năng
                </button>
                <button
                  type="button"
                  onClick={() => setFourthTableMode("locations")}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                    fourthTableMode === "locations"
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                      : "text-slate-600 dark:text-zinc-400"
                  }`}
                >
                  Tỉnh / Thành
                </button>
              </div>
            </div>
            <div className="overflow-auto max-h-[260px]">
              <table className="luxury-table">
                <thead>
                  <tr>
                    <th className="py-2 px-3">
                      {fourthTableMode === "skills" ? "Kỹ Năng / Chứng Chỉ" : "Khu Vực"}
                    </th>
                    <th className="py-2 px-3 text-right">Số Job</th>
                    <th className="py-2 px-3 text-right">Lương TB</th>
                    <th className="py-2 px-3 text-right">Đỉnh</th>
                    <th className="py-2 px-3 w-36">Tỷ Trọng</th>
                  </tr>
                </thead>
                <tbody>
                  {skillOrLocationBreakdown.map((item) => (
                    <tr
                      key={item.label}
                      onClick={() => handleDrilldownSkillOrLoc(item.label)}
                      className="cursor-pointer group"
                    >
                      <td className="py-2 px-3 font-semibold text-slate-900 dark:text-zinc-100 group-hover:text-amber-600 dark:group-hover:text-amber-400">
                        {item.label}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-950 dark:text-zinc-50 font-mono tabular-nums">
                        {item.count}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 dark:text-zinc-300 font-mono tabular-nums">
                        {item.avgSalary > 0 ? `${item.avgSalary.toFixed(1)} Tr` : "Thỏa thuận"}
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-700 dark:text-emerald-400 font-bold font-mono tabular-nums">
                        {item.maxSalary > 0 ? `${item.maxSalary.toFixed(1)} Tr` : "-"}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500 dark:bg-amber-400 rounded-full"
                              style={{ width: `${Math.max(item.count > 0 ? 4 : 0, item.pct)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono text-slate-600 dark:text-zinc-400 w-10 text-right tabular-nums">
                            {item.pct.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Top S-Tier Deals Preview Strip */}
        <div className="studio-card overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-zinc-100">
                Top Cơ Hội Nổi Bật Nhất (S-Tier &amp; Lương Cao)
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                resetAllFilters();
                setActiveSheet("all");
                onSwitchViewMode("table");
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <span>Xem toàn bộ trên Bảng Kết Quả ({jobs.length})</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-200/80 dark:divide-zinc-800">
            {jobs.slice(0, 5).map((job, idx) => (
              <div
                key={job.id}
                onClick={() => onSelectJob(job)}
                className="px-4 py-2.5 hover:bg-indigo-50/40 dark:hover:bg-zinc-800/50 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono font-semibold text-slate-400 w-5 tabular-nums">
                    #{idx + 1}
                  </span>
                  {renderTierBadge(job)}
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-zinc-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                      {job.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-zinc-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="font-medium text-slate-700 dark:text-zinc-300">
                        {job.company_name}
                      </span>
                      <span>·</span>
                      <span>{job.location_city}</span>
                      <span>·</span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
                        {job.portal_name || job.source_domain}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold tabular-nums bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70">
                    {job.salary_raw || "Thỏa thuận"}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectJob(job);
                    }}
                    className="studio-btn-secondary h-7 px-2.5 text-[11px] font-semibold"
                  >
                    Đọc JD
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ==========================================================================
     MODE B: FULL-VIEWPORT 1-PAGE SPREADSHEET DATA GRID (100vh Workspace)
     ========================================================================== */
  return (
    <div className="h-full flex flex-col gap-2 min-h-0 overflow-hidden">
      {/* 1. Single-Row Compact Filter, Search & Export Toolbar */}
      <div className="studio-card px-3 py-2 shrink-0 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Search & Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm tiêu đề, công ty, kỹ năng, khu vực..."
              className="studio-input w-full h-8 pl-8 pr-7 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <CustomSelect
            size="sm"
            value={selectedBracket}
            onChange={(val) => setSelectedBracket(val)}
            options={bracketOptions}
            placeholder="Khung lương"
            className="w-44"
          />

          <CustomSelect
            size="sm"
            value={selectedCategory}
            onChange={(val) => setSelectedCategory(val)}
            options={categoryOptions}
            placeholder="Nhóm ngành"
            className="w-44"
          />

          <CustomSelect
            size="sm"
            value={selectedWorkMode}
            onChange={(val) => setSelectedWorkMode(val)}
            options={workModeOptions}
            placeholder="Hình thức"
            className="w-36"
          />

          <CustomSelect
            size="sm"
            value={sortBy}
            onChange={(val) => setSortBy(val as any)}
            options={sortOptions}
            icon={<ArrowUpDown className="w-3 h-3" />}
            align="right"
            className="w-44"
          />

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="studio-btn-secondary h-8 px-2.5 text-xs inline-flex items-center gap-1 text-rose-600 dark:text-rose-400"
            >
              <X className="w-3.5 h-3.5" />
              <span>Bỏ lọc</span>
            </button>
          )}
        </div>

        {/* Right: Split-View Toggle, Quick Switch to BI, Export Excel/CSV & Clear */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const next = !splitView;
              setSplitView(next);
              if (next && !splitJobDetail && paginatedJobs.length > 0) {
                loadSplitJobDetail(paginatedJobs[0]);
              }
            }}
            className={`h-8 px-2.5 rounded-lg text-xs inline-flex items-center gap-1.5 font-semibold border transition-all ${
              splitView
                ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                : "bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-800"
            }`}
            title="Bật/tắt Chế độ Xem Đôi: Danh sách bên trái — Đọc JD trực tiếp bên phải"
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{splitView ? "Đang Xem Đôi" : "Xem Đôi (Split JD)"}</span>
          </button>

          <button
            type="button"
            onClick={() => onSwitchViewMode("analytics")}
            className="studio-btn-secondary h-8 px-2.5 text-xs inline-flex items-center gap-1.5 font-semibold"
            title="Chuyển sang trang biểu đồ & bảng thống kê BI"
          >
            <BarChart3 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Thống Kê BI</span>
          </button>

          <a
            href="/api/export/xlsx"
            className="studio-btn-primary h-8 px-3 text-xs inline-flex items-center gap-1.5"
            title="Tải file Excel (.xlsx) đa Sheet"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Xuất Excel</span>
          </a>

          <a
            href="/api/export/csv"
            className="studio-btn-secondary h-8 px-2.5 text-xs inline-flex items-center gap-1"
            title="Tải file CSV"
          >
            <Download className="w-3 h-3" />
            <span>CSV</span>
          </a>

          {/* 1-Click Hard Database Clear Button */}
          <button
            type="button"
            disabled={jobs.length === 0 || clearing}
            onClick={() => handleTriggerClear("all")}
            className="studio-btn-secondary h-8 px-2.5 text-xs inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border-rose-200/80 dark:border-rose-900/50"
            title="Xóa sạch 100% việc làm trong Database ngay lập tức"
          >
            {clearing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span className="hidden xl:inline">Xóa sạch DB</span>
          </button>
        </div>
      </div>

      {/* 2. Compact Sheet Tabs Strip (All 20 Portals + Smart Segments) */}
      <div className="studio-card p-1.5 shrink-0 flex items-center gap-1">
        <button
          type="button"
          onClick={() => scrollTabsBy(-280)}
          title="Cuộn sang trái"
          className="h-7 w-7 shrink-0 rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 flex items-center justify-center transition"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div
          ref={tabsScrollRef}
          onMouseDown={handleTabsMouseDown}
          onMouseMove={handleTabsMouseMove}
          onMouseUp={handleTabsMouseUpOrLeave}
          onMouseLeave={handleTabsMouseUpOrLeave}
          onWheel={handleTabsWheel}
          className={`flex-1 overflow-x-auto no-scrollbar select-none ${
            isGrabbingTabs ? "cursor-grabbing" : "cursor-grab"
          }`}
        >
          <div className="flex items-center gap-1 min-w-max px-0.5">
            {[
              {
                id: "all",
                label: "Tất cả",
                icon: <Layers className="w-3.5 h-3.5" />,
                count: jobs.length,
              },
              {
                id: "high_pay",
                label: "Lương ≥25Tr",
                icon: <TrendingUp className="w-3.5 h-3.5" />,
                count: highPayJobs.length,
              },
              {
                id: "new_jobs",
                label: "Mới",
                icon: <Sparkles className="w-3.5 h-3.5" />,
                count: newJobs.length,
              },
              {
                id: "tech",
                label: "Công nghệ · IT",
                icon: <Briefcase className="w-3.5 h-3.5" />,
                count: techJobs.length,
              },
              {
                id: "hr_contact",
                label: "Có HR",
                icon: <Mail className="w-3.5 h-3.5" />,
                count: hrJobs.length,
              },
              ...(savedJobs.length > 0
                ? [
                    {
                      id: "saved",
                      label: "Đã Lưu",
                      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
                      count: savedJobs.length,
                    },
                  ]
                : []),
            ].map((tab) => {
              const isAct = activeSheet === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    setActiveSheet(tab.id);
                  }}
                  className={`h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs font-medium transition-all ${
                    isAct
                      ? "bg-indigo-600 text-white dark:bg-indigo-500 font-semibold shadow-2xs"
                      : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800/80 hover:text-slate-950 dark:hover:text-zinc-100"
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums ${
                      isAct
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}

            {portalGroups.length > 0 && (
              <div className="h-4 w-px bg-slate-200 dark:bg-zinc-800 mx-0.5" />
            )}

            {/* All 20 Supported Portals */}
            {portalGroups.map(([portalName, pList]) => {
              const sheetKey = `portal:${portalName}`;
              const isAct = activeSheet === sheetKey;
              const hasJobs = pList.length > 0;
              return (
                <button
                  key={sheetKey}
                  type="button"
                  onClick={() => {
                    if (dragMovedRef.current) return;
                    setActiveSheet(sheetKey);
                  }}
                  className={`h-7 inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs font-medium transition-all ${
                    isAct
                      ? "bg-indigo-600 text-white dark:bg-indigo-500 font-semibold shadow-2xs"
                      : hasJobs
                      ? "text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/80"
                      : "text-slate-400 dark:text-zinc-500 hover:bg-slate-100 dark:hover:bg-zinc-800/80"
                  }`}
                >
                  <Globe className="w-3 h-3 opacity-75" />
                  <span>{portalName}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono tabular-nums ${
                      isAct
                        ? "bg-white/20 text-white"
                        : hasJobs
                        ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 font-semibold"
                        : "bg-slate-100/80 dark:bg-zinc-800/50 text-slate-400 dark:text-zinc-500"
                    }`}
                  >
                    {pList.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => scrollTabsBy(280)}
          title="Cuộn sang phải"
          className="h-7 w-7 shrink-0 rounded-md border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900 hover:bg-slate-100 dark:hover:bg-zinc-800 text-slate-600 dark:text-zinc-400 flex items-center justify-center transition"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 3. Full-Page Data Grid + Optional Master-Detail Split JD Reader */}
      <div className="flex-1 min-h-0 flex gap-2.5 overflow-hidden">
        {/* LEFT PANE: Data Grid */}
        <div
          className={`studio-card h-full min-h-0 flex flex-col overflow-hidden transition-all ${
            splitView ? "w-full lg:w-[58%] xl:w-[60%]" : "w-full"
          }`}
        >
          {/* Scrollable Table Viewport (Infinite Scroll) */}
          <div
            ref={tableViewportRef}
            onScroll={handleTableScroll}
            className="flex-1 min-h-0 overflow-auto overscroll-contain"
          >
            <table className="luxury-table">
              <thead>
                <tr>
                  <th className="w-11 text-center py-2.5 px-2.5">#</th>
                  <th
                    onClick={() =>
                      setSortBy((prev) => (prev === "tier_desc" ? "newest" : "tier_desc"))
                    }
                    className="w-28 py-2.5 px-3 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    title="Nhấn để đổi chiều sắp xếp theo Điểm Tier / Mới nhất"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>Hạng &amp; Điểm</span>
                      <ArrowUpDown
                        className={`w-3 h-3 ${
                          sortBy === "tier_desc"
                            ? "text-indigo-600 dark:text-indigo-400"
                            : "opacity-40"
                        }`}
                      />
                    </span>
                  </th>
                  <th className="min-w-[280px] py-2.5 px-3.5">Vị Trí Tuyển Dụng &amp; Công Ty</th>
                  <th
                    onClick={() =>
                      setSortBy((prev) =>
                        prev === "salary_desc" ? "salary_asc" : "salary_desc"
                      )
                    }
                    className="w-40 py-2.5 px-3 cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                    title="Nhấn để sắp xếp Mức Lương (Cao → Thấp / Thấp → Cao)"
                  >
                    <span className="inline-flex items-center gap-1">
                      <span>Mức Lương</span>
                      <ArrowUpDown
                        className={`w-3 h-3 ${
                          sortBy === "salary_desc" || sortBy === "salary_asc"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "opacity-40"
                        }`}
                      />
                    </span>
                  </th>
                  {!splitView && <th className="w-56 py-2.5 px-3">Chuyên Ngành &amp; Kỹ Năng</th>}
                  <th className="w-40 py-2.5 px-3">Khu Vực &amp; Sàn</th>
                  <th className="w-48 text-right py-2.5 px-3.5">Trạng Thái &amp; Thao Tác</th>
                </tr>
              </thead>
              <tbody>
                {paginatedJobs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={splitView ? 6 : 7}
                      className="py-16 text-center text-xs text-slate-500 dark:text-zinc-400"
                    >
                      Không có việc làm nào khớp với bộ lọc hiện tại trong Sheet này.
                    </td>
                  </tr>
                ) : (
                  paginatedJobs.map((job, idx) => {
                    const rowNum = idx + 1;
                    const salNorm = Number(job.salary_vnd_normalized || 0);
                    const hasExplicitSalary =
                      salNorm > 0 ||
                      (job.salary_raw &&
                        !/thỏa thuận|thương lượng|cạnh tranh|negotiable/i.test(
                          job.salary_raw
                        ));
                    const isActiveJd = activeJdId === job.id;
                    const isViewedJd = !isActiveJd && viewedJobIds.has(job.id);

                    return (
                      <tr
                        key={job.id}
                        onClick={() => {
                          markJobViewed(job.id);
                          if (splitView) {
                            loadSplitJobDetail(job);
                          } else {
                            onSelectJob(job);
                          }
                        }}
                        className={`cursor-pointer group transition-colors ${
                          isActiveJd
                            ? "row-active-jd"
                            : isViewedJd
                            ? "row-viewed-jd"
                            : ""
                        }`}
                      >
                        {/* 1. STT */}
                        <td className="py-2.5 px-2.5 text-center font-mono text-xs font-semibold tabular-nums">
                          {isActiveJd ? (
                            <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded bg-indigo-600 text-white font-bold text-[11px] shadow-2xs">
                              {rowNum}
                            </span>
                          ) : (
                            <span
                              className={
                                isViewedJd
                                  ? "text-indigo-500 dark:text-indigo-400"
                                  : "text-slate-400 dark:text-zinc-500"
                              }
                            >
                              {rowNum}
                            </span>
                          )}
                        </td>

                        {/* 2. Tier & Score */}
                        <td className="py-2.5 px-3">
                          <div className="flex flex-col items-start gap-1">
                            {renderTierBadge(job)}
                            {job.is_new_job && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800/70">
                                <span className="w-1 h-1 rounded-full bg-sky-500" />
                                MỚI
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Company Avatar + Job Title, Company & Interactive 1-Click HR Contact */}
                        <td className="py-2.5 px-3.5">
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-lg font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                isActiveJd
                                  ? "bg-indigo-600 text-white border border-indigo-600 shadow-2xs"
                                  : "bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/70 dark:border-indigo-800/60 text-indigo-700 dark:text-indigo-300"
                              }`}
                            >
                              {getCompanyInitials(job.company_name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <div
                                  className={`text-[13px] font-bold leading-snug line-clamp-1 transition-colors ${
                                    isActiveJd
                                      ? "text-indigo-700 dark:text-indigo-300"
                                      : "text-slate-900 dark:text-zinc-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400"
                                  }`}
                                >
                                  {job.title}
                                </div>
                                {isActiveJd && (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white shadow-2xs">
                                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                    Đang xem
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-zinc-300 mt-1">
                                <span className="inline-flex items-center gap-1 font-medium">
                                  <Building2 className="w-3 h-3 shrink-0 text-slate-400" />
                                  <span className="truncate max-w-[230px]">{job.company_name}</span>
                                </span>
                                {job.seniority && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
                                    {job.seniority}
                                  </span>
                                )}
                                {job.hr_email && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopyContact(e, job.hr_email!)}
                                    title="Nhấn để sao chép Email HR"
                                    className="inline-flex items-center gap-1 bg-indigo-50/90 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.2 rounded text-[10px] font-mono border border-indigo-200/60 dark:border-indigo-800/60 transition"
                                  >
                                    {copiedContact === job.hr_email ? (
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                    ) : (
                                      <Mail className="w-2.5 h-2.5" />
                                    )}
                                    <span>{job.hr_email}</span>
                                  </button>
                                )}
                                {job.hr_phone && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleCopyContact(e, job.hr_phone!)}
                                    title="Nhấn để sao chép SĐT HR"
                                    className="inline-flex items-center gap-1 bg-emerald-50/90 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 rounded text-[10px] font-mono border border-emerald-200/60 dark:border-emerald-800/60 transition"
                                  >
                                    {copiedContact === job.hr_phone ? (
                                      <Check className="w-2.5 h-2.5 text-emerald-600" />
                                    ) : (
                                      <Phone className="w-2.5 h-2.5" />
                                    )}
                                    <span>{job.hr_phone}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* 4. Salary & Bracket */}
                        <td className="py-2.5 px-3 font-mono tabular-nums">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                              hasExplicitSalary
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70"
                                : "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                            }`}
                          >
                            {job.salary_raw || "Thỏa thuận"}
                          </span>
                          {salNorm > 0 && (
                            <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
                              ~<strong className="text-slate-800 dark:text-zinc-200">{salNorm.toFixed(1)} Tr</strong>
                            </div>
                          )}
                        </td>

                        {/* 5. Category & Skills (Hidden when Split-View is active to keep columns crisp) */}
                        {!splitView && (
                          <td className="py-2.5 px-3">
                            <div className="text-xs font-semibold text-slate-800 dark:text-zinc-200 mb-1 truncate">
                              {job.job_category || "Chuyên ngành khác"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {job.jlpt_level && (
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-600 text-white dark:bg-indigo-500">
                                  {job.jlpt_level}
                                </span>
                              )}
                              {(job.skills || []).slice(0, 3).map((sk) => (
                                <span
                                  key={sk}
                                  className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200/90 dark:border-zinc-700"
                                >
                                  {sk}
                                </span>
                              ))}
                            </div>
                          </td>
                        )}

                        {/* 6. Location, Work Mode & Portal */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1 text-xs text-slate-900 dark:text-zinc-100 font-semibold">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{job.location_city}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1 mt-1">
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border border-slate-200/80 dark:border-zinc-700">
                              {job.work_mode}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70">
                              {job.portal_name || job.source_domain}
                            </span>
                          </div>
                        </td>

                        {/* 7. CRM Status & Actions */}
                        <td
                          className="py-2.5 px-3.5 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <CustomSelect
                              size="xs"
                              value={job.status || "new"}
                              onChange={(newStatus) => onUpdateStatus(job.id, newStatus)}
                              options={CRM_STATUS_OPTIONS}
                              className="w-28"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                markJobViewed(job.id);
                                if (splitView) {
                                  loadSplitJobDetail(job);
                                }
                                onSelectJob(job);
                              }}
                              title="Mở cửa sổ Đọc JD Chi Tiết"
                              className={`h-7 px-2.5 text-[11px] font-semibold rounded-lg border inline-flex items-center gap-1 transition-all ${
                                isActiveJd
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                                  : isViewedJd
                                  ? "bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/70 hover:border-indigo-400"
                                  : "studio-btn-secondary hover:border-indigo-400 dark:hover:border-indigo-600"
                              }`}
                            >
                              <FileText
                                className={`w-3 h-3 ${
                                  isActiveJd
                                    ? "text-white"
                                    : "text-indigo-600 dark:text-indigo-400"
                                }`}
                              />
                              <span>{isActiveJd ? "Đang xem" : isViewedJd ? "Đã xem" : "JD"}</span>
                            </button>
                            <a
                              href={job.url}
                              target="_blank"
                              rel="noreferrer"
                              title="Mở trang bài đăng gốc"
                              className="studio-btn-secondary h-7 w-7 inline-flex items-center justify-center text-slate-600 dark:text-zinc-300 hover:text-indigo-600"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <button
                              type="button"
                              onClick={() => onDeleteJob(job.id)}
                              title="Xóa việc làm này"
                              className="studio-btn-secondary h-7 w-7 inline-flex items-center justify-center text-slate-400 hover:text-rose-600 hover:border-rose-300"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
                {hasMoreJobs && (
                  <tr ref={loadMoreSentinelRef}>
                    <td
                      colSpan={splitView ? 6 : 7}
                      className="py-3.5 text-center text-xs text-slate-500 dark:text-zinc-400 bg-slate-50/40 dark:bg-zinc-900/30"
                    >
                      <div className="inline-flex items-center gap-2 font-mono text-[11px]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                        <span>
                          Đang cuộn tự động nạp thêm việc làm... ({paginatedJobs.length} /{" "}
                          {filteredSheetJobs.length})
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Sticky Bottom Status & Infinite Scroll Footer Bar */}
          <div className="px-3.5 py-2 bg-slate-50 dark:bg-zinc-950 border-t border-slate-200 dark:border-zinc-800 shrink-0 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-600 dark:text-zinc-400 tabular-nums">
              <span className="px-2 py-0.5 rounded bg-indigo-600 dark:bg-indigo-500 text-white font-sans font-bold text-[11px]">
                {currentSheetMeta.label}
              </span>
              <span>
                Tổng: <strong className="text-slate-900 dark:text-zinc-100">{currentSheetMeta.total}</strong>
              </span>
              <span>·</span>
              <span>
                Mới: <strong className="text-sky-600 dark:text-sky-400">{currentSheetMeta.newCount}</strong>
              </span>
              <span>·</span>
              <span>
                Có lương: <strong className="text-emerald-600 dark:text-emerald-400">{currentSheetMeta.withSalaryCount}</strong>
              </span>
              {currentSheetMeta.maxSalary > 0 && (
                <>
                  <span>·</span>
                  <span>
                    Đỉnh: <strong className="text-emerald-600 dark:text-emerald-400">{currentSheetMeta.maxSalary.toFixed(1)} Tr</strong>
                  </span>
                </>
              )}

              {/* Active Drilldown Filter Badges */}
              {selectedBracket && (
                <span className="studio-badge text-[10px] py-0">
                  {selectedBracket}
                  <button type="button" onClick={() => setSelectedBracket("")}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedCategory && (
                <span className="studio-badge text-[10px] py-0">
                  {selectedCategory}
                  <button type="button" onClick={() => setSelectedCategory("")}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {selectedLocationOrSkill && (
                <span className="studio-badge text-[10px] py-0">
                  {selectedLocationOrSkill}
                  <button type="button" onClick={() => setSelectedLocationOrSkill("")}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>

            {/* Right: Infinite Scroll Status & Back-to-Top Control */}
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-zinc-400 tabular-nums">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    hasMoreJobs ? "bg-indigo-500 animate-pulse" : "bg-emerald-500"
                  }`}
                />
                <span>
                  Hiển thị{" "}
                  <strong className="text-slate-900 dark:text-zinc-100">
                    {paginatedJobs.length}
                  </strong>{" "}
                  / {filteredSheetJobs.length}
                </span>
              </span>

              {showScrollTop && (
                <button
                  type="button"
                  onClick={scrollToTableTop}
                  className="studio-btn-secondary h-6 px-2 text-[11px] font-sans font-semibold text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800/70 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  title="Cuộn mượt về dòng đầu tiên của bảng"
                >
                  Lên đầu bảng ↑
                </button>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANE: Master-Detail Inline JD Reader (When splitView === true) */}
        {splitView && (
          <div className="hidden lg:flex lg:w-[42%] xl:w-[40%] studio-card h-full min-h-0 flex-col overflow-hidden border-indigo-200/80 dark:border-indigo-900/50">
            {!splitJobDetail ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-500 dark:text-zinc-400">
                <FileText className="w-8 h-8 text-indigo-400 mb-2 opacity-75" />
                <div className="font-bold text-slate-800 dark:text-zinc-200 mb-1">
                  Chọn một việc làm bên trái để đọc JD ngay lập tức
                </div>
                <p>Nội dung JD Offline, mức lương và liên hệ HR sẽ hiển thị trực tiếp tại đây.</p>
              </div>
            ) : (
              <>
                {/* Header of Inline JD Reader */}
                <div className="p-3.5 border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/60 shrink-0 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        {getCompanyInitials(splitJobDetail.company_name)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-zinc-50 leading-snug line-clamp-2">
                          {splitJobDetail.title}
                        </h3>
                        <div className="text-xs font-medium text-slate-600 dark:text-zinc-300 mt-0.5 truncate">
                          {splitJobDetail.company_name}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSplitView(false)}
                      title="Đóng chế độ Xem Đôi"
                      className="h-7 w-7 rounded-lg hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-500 flex items-center justify-center shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Quick Pills: Salary, Location, Portal, Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70">
                        {splitJobDetail.salary_raw || "Thỏa thuận"}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
                        {splitJobDetail.location_city} · {splitJobDetail.work_mode}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                        {splitJobDetail.portal_name || splitJobDetail.source_domain}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={enrichingSplitJob}
                        onClick={() => handleEnrichSplitJob(splitJobDetail.id)}
                        className="studio-btn-secondary h-7 px-2 text-[11px] font-semibold inline-flex items-center gap-1"
                        title="Quét sâu lại trang gốc để lấy toàn bộ JD và Email/SĐT HR"
                      >
                        <RefreshCw
                          className={`w-3 h-3 text-indigo-600 ${
                            enrichingSplitJob ? "animate-spin" : ""
                          }`}
                        />
                        <span>{enrichingSplitJob ? "Đang tải JD..." : "Quét sâu JD"}</span>
                      </button>
                      <a
                        href={splitJobDetail.url}
                        target="_blank"
                        rel="noreferrer"
                        className="studio-btn-primary h-7 px-2.5 text-[11px] inline-flex items-center gap-1"
                      >
                        <span>Mở gốc</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* HR Contact Bar if present */}
                  {(splitJobDetail.hr_email || splitJobDetail.hr_phone || splitJobDetail.hr_name) && (
                    <div className="p-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/70 dark:border-indigo-800/60 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-bold text-indigo-900 dark:text-indigo-200">
                        Liên hệ HR:
                      </span>
                      {splitJobDetail.hr_name && (
                        <span className="text-slate-700 dark:text-zinc-300 font-medium">
                          {splitJobDetail.hr_name}
                        </span>
                      )}
                      {splitJobDetail.hr_email && (
                        <button
                          type="button"
                          onClick={(e) => handleCopyContact(e, splitJobDetail.hr_email!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-zinc-900 text-indigo-700 dark:text-indigo-300 font-mono text-[11px] border border-indigo-200 dark:border-indigo-800"
                        >
                          {copiedContact === splitJobDetail.hr_email ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{splitJobDetail.hr_email}</span>
                        </button>
                      )}
                      {splitJobDetail.hr_phone && (
                        <button
                          type="button"
                          onClick={(e) => handleCopyContact(e, splitJobDetail.hr_phone!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] border border-emerald-200 dark:border-emerald-800"
                        >
                          {copiedContact === splitJobDetail.hr_phone ? (
                            <Check className="w-3 h-3 text-emerald-600" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{splitJobDetail.hr_phone}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Scrollable JD Body */}
                <div
                  ref={jdBodyScrollRef}
                  className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3 text-xs leading-relaxed text-slate-700 dark:text-zinc-300"
                >
                  {loadingSplitJob || enrichingSplitJob ? (
                    <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500">
                      <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                      <span>Đang tải nội dung Mô tả công việc (JD)...</span>
                    </div>
                  ) : (
                    <>
                      {/* Skills & Tags */}
                      {(splitJobDetail.skills || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 pb-2 border-b border-slate-100 dark:border-zinc-800">
                          {(splitJobDetail.skills || []).map((sk) => (
                            <span
                              key={sk}
                              className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300"
                            >
                              {sk}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Full JD Text */}
                      <div className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-800 dark:text-zinc-200">
                        {splitJobDetail.full_jd_markdown ||
                          splitJobDetail.description ||
                          "Chưa có nội dung JD chi tiết. Nhấn 'Quét sâu JD' ở góc trên để tải trực tiếp từ trang gốc."}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
