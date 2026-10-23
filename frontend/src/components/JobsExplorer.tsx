import React, { useMemo, useState } from "react";
import {
  ArrowDownWideNarrow,
  BookOpen,
  Building2,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Mail,
  MapPin,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { JobItem } from "../api/client";

interface Props {
  jobs: JobItem[];
  domains: string[];
  searchQuery: string;
  onChangeSearch: (q: string) => void;
  selectedDomain: string;
  onChangeDomain: (d: string) => void;
  selectedWorkMode: string;
  onChangeWorkMode: (m: string) => void;
  sortBy: string;
  onChangeSortBy: (s: string) => void;
  onlyHighlighted: boolean;
  onToggleHighlighted: (v: boolean) => void;
  onlyWithHr: boolean;
  onToggleWithHr: (v: boolean) => void;
  onOpenOfflineJd: (jobId: number) => void;
  onChangeStatus: (jobId: number, status: string) => void;
  onDeleteJob: (jobId: number) => void;
}

const AVATAR_PALETTES = [
  "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border-indigo-200/80 dark:border-indigo-800/60",
  "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800/60",
  "bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border-blue-200/80 dark:border-blue-800/60",
  "bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 border-violet-200/80 dark:border-violet-800/60",
  "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-200/80 dark:border-amber-800/60",
  "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 border-rose-200/80 dark:border-rose-800/60",
  "bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 border-cyan-200/80 dark:border-cyan-800/60",
];

function getCompanyAvatarMeta(companyName: string) {
  const clean = (companyName || "Company").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0][0]}${words[1][0]}`.toUpperCase()
      : clean.slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = AVATAR_PALETTES[Math.abs(hash) % AVATAR_PALETTES.length];
  return { initials, palette };
}

function getWorkModeBadgeClass(mode: string) {
  const m = (mode || "").toLowerCase();
  if (m.includes("remote")) {
    return "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60";
  }
  if (m.includes("hybrid")) {
    return "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200/80 dark:border-indigo-800/60";
  }
  return "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-700/70";
}

const STATUS_TABS = [
  { id: "all", label: "Tất cả" },
  { id: "new", label: "Mới" },
  { id: "saved", label: "Đã lưu" },
  { id: "applied", label: "Đã nộp CV" },
  { id: "interviewing", label: "Phỏng vấn" },
];

export const JobsExplorer: React.FC<Props> = ({
  jobs,
  domains,
  searchQuery,
  onChangeSearch,
  selectedDomain,
  onChangeDomain,
  selectedWorkMode,
  onChangeWorkMode,
  sortBy,
  onChangeSortBy,
  onlyHighlighted,
  onToggleHighlighted,
  onlyWithHr,
  onToggleWithHr,
  onOpenOfflineJd,
  onChangeStatus,
  onDeleteJob,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewLayout, setViewLayout] = useState<"table" | "grid">("table");
  const [copiedEmailId, setCopiedEmailId] = useState<number | null>(null);

  const statusCounts = useMemo(() => {
    const map: Record<string, number> = {
      all: jobs.length,
      new: 0,
      saved: 0,
      applied: 0,
      interviewing: 0,
    };
    for (const j of jobs) {
      const st = j.status || "new";
      if (map[st] !== undefined) map[st] += 1;
    }
    return map;
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    return jobs.filter((j) => (j.status || "new") === statusFilter);
  }, [jobs, statusFilter]);

  const buildExportUrl = (fmt: "xlsx" | "csv" | "json") => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (selectedDomain) params.set("domain", selectedDomain);
    if (selectedWorkMode) params.set("work_mode", selectedWorkMode);
    return `/api/export/${fmt}?${params.toString()}`;
  };

  const handleCopyEmail = (jobId: number, email: string) => {
    navigator.clipboard?.writeText(email).catch(() => {});
    setCopiedEmailId(jobId);
    setTimeout(() => setCopiedEmailId(null), 1500);
  };

  return (
    <div className="studio-card overflow-hidden">
      {/* Top Header Bar: Status Pipeline Tabs + View Switcher + Export */}
      <div className="px-5 py-3.5 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200/90 dark:border-zinc-800/90 flex flex-wrap items-center justify-between gap-3">
        {/* CRM Status Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((t) => {
            const active = statusFilter === t.id;
            const count = statusCounts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatusFilter(t.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                  active
                    ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 shadow-sm"
                    : "bg-white dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 border border-zinc-200/80 dark:border-zinc-700/70 hover:text-zinc-900 dark:hover:text-zinc-200"
                }`}
              >
                <span>{t.label}</span>
                <span
                  className={`font-mono text-[10px] px-1.5 py-0.2 rounded ${
                    active
                      ? "bg-white/20 text-white dark:bg-zinc-800 dark:text-zinc-100"
                      : "bg-zinc-100 dark:bg-zinc-700/70 text-zinc-600 dark:text-zinc-300"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right Controls: View Toggle + Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Table vs Grid View Switcher */}
          <div className="inline-flex p-0.5 rounded-lg bg-zinc-200/70 dark:bg-zinc-800 border border-zinc-300/60 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => setViewLayout("table")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition ${
                viewLayout === "table"
                  ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
              }`}
              title="Xem dạng Bảng (Table)"
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bảng</span>
            </button>
            <button
              type="button"
              onClick={() => setViewLayout("grid")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition ${
                viewLayout === "grid"
                  ? "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
              }`}
              title="Xem dạng Thẻ (Cards)"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Thẻ</span>
            </button>
          </div>

          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />

          <a
            href={buildExportUrl("xlsx")}
            download="crawled_jobs.csv"
            className="studio-btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </a>
          <a
            href={buildExportUrl("csv")}
            download="crawled_jobs.csv"
            className="studio-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </a>
          <a
            href={buildExportUrl("json")}
            download="crawled_jobs.json"
            className="studio-btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1"
          >
            <Download className="w-3.5 h-3.5" />
            <span>JSON</span>
          </a>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="px-5 py-3 border-b border-zinc-200/90 dark:border-zinc-800/90 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 text-xs items-center bg-white dark:bg-zinc-900">
        <div className="lg:col-span-4 relative">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Tìm tiêu đề, công ty, kỹ năng, địa điểm..."
            className="studio-input w-full pl-8 pr-3 py-1.5"
          />
        </div>

        <div className="lg:col-span-2">
          <select
            value={selectedDomain}
            onChange={(e) => onChangeDomain(e.target.value)}
            className="studio-input w-full px-2.5 py-1.5"
          >
            <option value="">Tất cả nguồn ({domains.length})</option>
            {domains.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="lg:col-span-2">
          <select
            value={selectedWorkMode}
            onChange={(e) => onChangeWorkMode(e.target.value)}
            className="studio-input w-full px-2.5 py-1.5"
          >
            <option value="">Mọi hình thức</option>
            <option value="Remote">Remote</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Onsite">Onsite</option>
          </select>
        </div>

        <div className="lg:col-span-2 relative">
          <ArrowDownWideNarrow className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <select
            value={sortBy}
            onChange={(e) => onChangeSortBy(e.target.value)}
            className="studio-input w-full pl-8 pr-2.5 py-1.5"
          >
            <option value="newest">Mới nhất trước</option>
            <option value="salary_desc">Lương: Cao → Thấp</option>
            <option value="salary_asc">Lương: Thấp → Cao</option>
          </select>
        </div>

        <div className="lg:col-span-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onToggleHighlighted(!onlyHighlighted)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1 transition ${
              onlyHighlighted
                ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700"
                : "bg-zinc-50 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
            }`}
          >
            <Star
              className={`w-3 h-3 ${
                onlyHighlighted ? "fill-amber-500 text-amber-500" : ""
              }`}
            />
            <span>Ưu tiên</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleWithHr(!onlyWithHr)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1 transition ${
              onlyWithHr
                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
                : "bg-zinc-50 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
            }`}
          >
            <Mail className="w-3 h-3" />
            <span>Có HR</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {filteredJobs.length === 0 ? (
        <div className="py-14 px-4 text-center space-y-1.5">
          <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 mx-auto flex items-center justify-center text-zinc-400">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Không có việc làm phù hợp bộ lọc
          </div>
        </div>
      ) : viewLayout === "table" ? (
        /* High-Density Studio Table View */
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200/90 dark:border-zinc-800/90 bg-zinc-50/90 dark:bg-zinc-950/60 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                <th className="py-3 pl-5 pr-3">Vị trí & Kỹ năng</th>
                <th className="py-3 px-3">Công ty & Nguồn</th>
                <th className="py-3 px-3 text-right">Mức lương</th>
                <th className="py-3 px-3">Hình thức & Cấp bậc</th>
                <th className="py-3 px-3">JD & Liên hệ HR</th>
                <th className="py-3 pl-3 pr-5 text-right">Quản lý</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80 text-xs">
              {filteredJobs.map((job) => {
                const avatar = getCompanyAvatarMeta(job.company_name);
                const hasRealSalary =
                  !job.is_negotiable && job.salary_vnd_normalized > 0;

                return (
                  <tr
                    key={job.id}
                    className={`group transition-colors ${
                      job.is_highlighted
                        ? "bg-amber-50/35 dark:bg-amber-950/15 hover:bg-amber-50/70 dark:hover:bg-amber-950/25"
                        : "hover:bg-zinc-50/90 dark:hover:bg-zinc-800/45"
                    }`}
                  >
                    {/* Column 1: Avatar + Job Title + Skills */}
                    <td className="py-3.5 pl-5 pr-3 align-top max-w-md">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-lg border flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 shadow-sm ${avatar.palette}`}
                        >
                          {avatar.initials}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-1.5">
                            {job.is_highlighted && (
                              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0 mt-0.5" />
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenOfflineJd(job.id)}
                              className="text-left font-bold text-zinc-900 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition leading-snug"
                            >
                              {job.title}
                            </button>
                          </div>

                          {job.skills && job.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {job.skills.slice(0, 6).map((sk) => (
                                <span
                                  key={sk}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800/90 text-zinc-600 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/70"
                                >
                                  {sk}
                                </span>
                              ))}
                              {job.skills.length > 6 && (
                                <span className="text-[10px] font-mono text-zinc-400 self-center">
                                  +{job.skills.length - 6}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Company, Location & Domain Badge */}
                    <td className="py-3.5 px-3 align-top">
                      <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                        {job.company_name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-zinc-400" />
                          {job.location_city}
                        </span>
                        <span className="text-zinc-300 dark:text-zinc-700">·</span>
                        <span className="px-1.5 py-0.2 rounded font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200/70 dark:border-zinc-700/60">
                          {job.source_domain}
                        </span>
                      </div>
                    </td>

                    {/* Column 3: Salary Badge */}
                    <td className="py-3.5 px-3 align-top text-right whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md font-mono font-bold text-xs tabular-nums border ${
                          hasRealSalary
                            ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-800/60"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200/80 dark:border-zinc-700/70"
                        }`}
                      >
                        {job.salary_raw}
                      </span>
                      {hasRealSalary && (
                        <div className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 tabular-nums mt-1">
                          ≈ {job.salary_vnd_normalized}M VNĐ
                        </div>
                      )}
                    </td>

                    {/* Column 4: Work Mode & Seniority */}
                    <td className="py-3.5 px-3 align-top whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${getWorkModeBadgeClass(
                            job.work_mode
                          )}`}
                        >
                          {job.work_mode}
                        </span>
                        <span className="text-[11px] text-zinc-500 dark:text-zinc-400 pl-0.5">
                          {job.seniority}
                        </span>
                      </div>
                    </td>

                    {/* Column 5: HR Contact & Deep Crawl Status */}
                    <td className="py-3.5 px-3 align-top">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              job.deep_crawl_status === "completed"
                                ? "bg-emerald-500"
                                : job.deep_crawl_status === "running"
                                ? "bg-amber-500 animate-pulse"
                                : "bg-zinc-300 dark:bg-zinc-600"
                            }`}
                          />
                          <span className="text-[10px] font-mono font-semibold text-zinc-600 dark:text-zinc-400 uppercase">
                            JD: {job.deep_crawl_status}
                          </span>
                        </div>

                        {job.hr_email ? (
                          <button
                            type="button"
                            onClick={() => handleCopyEmail(job.id, job.hr_email)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 border border-blue-200/80 dark:border-blue-800/60 text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:bg-blue-100/70 max-w-[195px]"
                            title="Bấm để sao chép Email HR"
                          >
                            {copiedEmailId === job.id ? (
                              <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                            ) : (
                              <Copy className="w-3 h-3 shrink-0" />
                            )}
                            <span className="truncate">{job.hr_email}</span>
                          </button>
                        ) : (
                          <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            Chưa có Email HR
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Column 6: Actions */}
                    <td className="py-3.5 pl-3 pr-5 align-top text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onOpenOfflineJd(job.id)}
                          className="studio-btn-secondary px-2.5 py-1 text-xs flex items-center gap-1"
                        >
                          <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>Đọc JD</span>
                        </button>

                        <select
                          value={job.status}
                          onChange={(e) => onChangeStatus(job.id, e.target.value)}
                          className="studio-input px-2 py-1 text-xs"
                        >
                          <option value="new">Mới</option>
                          <option value="saved">Đã lưu</option>
                          <option value="applied">Đã nộp CV</option>
                          <option value="interviewing">Phỏng vấn</option>
                          <option value="hidden">Ẩn</option>
                        </select>

                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="studio-btn-secondary p-1.5 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                          title="Mở trang gốc"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>

                        <button
                          type="button"
                          onClick={() => onDeleteJob(job.id)}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                          title="Xóa"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* 2-Column Tactile Grid Cards View */
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 bg-zinc-50/40 dark:bg-zinc-950/30">
          {filteredJobs.map((job) => {
            const avatar = getCompanyAvatarMeta(job.company_name);
            const hasRealSalary =
              !job.is_negotiable && job.salary_vnd_normalized > 0;

            return (
              <div
                key={job.id}
                className={`studio-card p-4 flex flex-col justify-between transition-all hover:border-zinc-400 dark:hover:border-zinc-600 ${
                  job.is_highlighted
                    ? "ring-1 ring-amber-400/50 dark:ring-amber-500/40"
                    : ""
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center font-mono text-xs font-bold shrink-0 ${avatar.palette}`}
                      >
                        {avatar.initials}
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenOfflineJd(job.id)}
                          className="text-left font-bold text-sm text-zinc-950 dark:text-zinc-100 hover:text-blue-600 dark:hover:text-blue-400 transition line-clamp-2 leading-snug"
                        >
                          {job.title}
                        </button>
                        <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mt-0.5 truncate">
                          {job.company_name}
                        </div>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-md font-mono font-bold text-xs border ${
                        hasRealSalary
                          ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      {job.salary_raw}
                    </span>
                  </div>

                  {/* Metadata Badges */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[11px]">
                    <span
                      className={`px-2 py-0.5 rounded-md font-medium border ${getWorkModeBadgeClass(
                        job.work_mode
                      )}`}
                    >
                      {job.work_mode}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                      {job.location_city}
                    </span>
                    <span className="px-2 py-0.5 rounded-md font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                      {job.source_domain}
                    </span>
                  </div>

                  {/* Skills */}
                  {job.skills && job.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2.5">
                      {job.skills.slice(0, 5).map((sk) => (
                        <span
                          key={sk}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-50 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-300 border border-zinc-200/80 dark:border-zinc-700/70"
                        >
                          {sk}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Footer */}
                <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        job.deep_crawl_status === "completed"
                          ? "bg-emerald-500"
                          : "bg-zinc-300 dark:bg-zinc-600"
                      }`}
                    />
                    <span className="font-mono text-zinc-500">
                      JD: {job.deep_crawl_status}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onOpenOfflineJd(job.id)}
                      className="studio-btn-secondary px-2.5 py-1 text-xs flex items-center gap-1"
                    >
                      <BookOpen className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Đọc JD</span>
                    </button>
                    <select
                      value={job.status}
                      onChange={(e) => onChangeStatus(job.id, e.target.value)}
                      className="studio-input px-2 py-1 text-xs"
                    >
                      <option value="new">Mới</option>
                      <option value="saved">Đã lưu</option>
                      <option value="applied">Đã nộp CV</option>
                      <option value="interviewing">Phỏng vấn</option>
                      <option value="hidden">Ẩn</option>
                    </select>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="studio-btn-secondary p-1.5 text-zinc-500"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
