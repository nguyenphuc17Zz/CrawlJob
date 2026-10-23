import React, { useEffect, useMemo, useState } from "react";
import {
  Award,
  Bookmark,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  UserCheck,
  X,
} from "lucide-react";
import { JobItem } from "../api/client";
import { CustomSelect } from "./ui/CustomSelect";

interface Props {
  job: JobItem | null;
  allJobs?: JobItem[];
  onClose: () => void;
  onSelectJob?: (jobId: number) => void;
  onUpdateStatus?: (jobId: number, status: string) => Promise<void>;
  onEnrichSingle: (jobId: number) => Promise<void>;
  enriching: boolean;
}

interface ParsedBlock {
  type: "h1" | "h2" | "h3" | "li" | "p";
  text: string;
}

interface JdSection {
  title: string;
  category: "desc" | "req" | "benefit" | "info";
  items: ParsedBlock[];
}

const SECTION_HEADING_DETECT =
  /^(mô tả công việc|chi tiết công việc|nội dung công việc|trách nhiệm|job description|what you will do|responsibilities|key responsibilities|yêu cầu ứng viên|yêu cầu công việc|yêu cầu chuyên môn|tiêu chí|job requirements|requirements|qualifications|what we look for|skills and experience|quyền lợi|quyền lợi được hưởng|chế độ đãi ngộ|phúc lợi|benefits|compensation|perks|why you'll love working here|địa điểm làm việc|thời gian làm việc|thông tin khác|cách thức ứng tuyển)[:\s\-–]*$/i;

const BOILERPLATE_NOISE =
  /^(đăng nhập|đăng ký|ứng tuyển ngay|nộp hồ sơ|lưu tin|chia sẻ|báo cáo tin|việc làm tương tự|việc làm liên quan|tạo cv|cẩm nang|trang chủ|về chúng tôi|liên hệ|điều khoản|chính sách bảo mật|bản quyền|copyright|xem thêm|thu gọn)$/i;

const CRM_STATUS_OPTIONS = [
  { value: "new", label: "Chưa xem" },
  { value: "saved", label: "Đã lưu" },
  { value: "applied", label: "Đã nộp CV" },
  { value: "rejected", label: "Từ chối" },
];

function sanitizeLineText(raw: string): string {
  return (raw || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySectionCategory(title: string): JdSection["category"] {
  const lower = title.toLowerCase();
  if (
    lower.includes("yêu cầu") ||
    lower.includes("requirement") ||
    lower.includes("qualification") ||
    lower.includes("skill") ||
    lower.includes("tiêu chí") ||
    lower.includes("what we look for")
  ) {
    return "req";
  }
  if (
    lower.includes("quyền lợi") ||
    lower.includes("phúc lợi") ||
    lower.includes("đãi ngộ") ||
    lower.includes("benefit") ||
    lower.includes("perk") ||
    lower.includes("compensation") ||
    lower.includes("love working")
  ) {
    return "benefit";
  }
  if (
    lower.includes("mô tả") ||
    lower.includes("chi tiết") ||
    lower.includes("nội dung") ||
    lower.includes("trách nhiệm") ||
    lower.includes("description") ||
    lower.includes("responsibilit") ||
    lower.includes("what you will do")
  ) {
    return "desc";
  }
  return "info";
}

function parseCleanMarkdownAndBlocks(
  markdownText: string,
  htmlText: string
): { cleanMarkdown: string; sections: JdSection[] } {
  const blocks: ParsedBlock[] = [];

  if (htmlText && typeof DOMParser !== "undefined" && !markdownText) {
    try {
      const doc = new DOMParser().parseFromString(htmlText, "text/html");
      doc
        .querySelectorAll("script, style, nav, footer, header, aside, form, button")
        .forEach((el) => el.remove());
      const elements = doc.body.querySelectorAll("h1, h2, h3, h4, li, p");
      elements.forEach((el) => {
        const txt = sanitizeLineText(el.textContent || "");
        if (!txt || BOILERPLATE_NOISE.test(txt)) return;
        const tag = el.tagName.toLowerCase();
        if (tag === "h1" || tag === "h2" || SECTION_HEADING_DETECT.test(txt)) {
          blocks.push({ type: "h2", text: txt.replace(/[:\-–]+$/, "").trim() });
        } else if (tag === "h3" || tag === "h4") {
          blocks.push({ type: "h3", text: txt });
        } else if (tag === "li") {
          blocks.push({ type: "li", text: txt });
        } else {
          blocks.push({ type: "p", text: txt });
        }
      });
    } catch {
      // fallback to markdown lines
    }
  }

  if (blocks.length === 0) {
    for (const rawLine of (markdownText || "").split(/\r?\n/)) {
      const rawTrimmed = rawLine.trim();
      if (!rawTrimmed) continue;

      if (rawTrimmed.startsWith("### ")) {
        const t = sanitizeLineText(rawTrimmed.slice(4));
        if (t) blocks.push({ type: "h3", text: t });
      } else if (rawTrimmed.startsWith("## ") || rawTrimmed.startsWith("# ")) {
        const t = sanitizeLineText(rawTrimmed.replace(/^#+\s*/, ""));
        if (t) blocks.push({ type: "h2", text: t.replace(/[:\-–]+$/, "").trim() });
      } else if (
        rawTrimmed.startsWith("- ") ||
        rawTrimmed.startsWith("* ") ||
        /^[•●▪▫▸▹◦‣⁃–—+]\s+/.test(rawTrimmed)
      ) {
        const t = sanitizeLineText(
          rawTrimmed.replace(/^([-*•●▪▫▸▹◦‣⁃–—+])\s+/, "")
        );
        if (t && !BOILERPLATE_NOISE.test(t)) {
          blocks.push({ type: "li", text: t });
        }
      } else {
        const t = sanitizeLineText(rawTrimmed);
        if (!t || BOILERPLATE_NOISE.test(t) || /^https?:\/\/\S+$/i.test(t)) continue;
        if (SECTION_HEADING_DETECT.test(t)) {
          blocks.push({ type: "h2", text: t.replace(/[:\-–]+$/, "").trim() });
        } else {
          blocks.push({ type: "p", text: t });
        }
      }
    }
  }

  // Group into structured sections
  const sections: JdSection[] = [];
  let current: JdSection = {
    title: "Nội dung chi tiết",
    category: "desc",
    items: [],
  };

  for (const b of blocks) {
    if (b.type === "h1" || b.type === "h2") {
      if (current.items.length > 0) {
        sections.push(current);
      }
      current = {
        title: b.text,
        category: classifySectionCategory(b.text),
        items: [],
      };
    } else {
      const prev = current.items[current.items.length - 1];
      if (prev && prev.text === b.text) continue;
      current.items.push(b);
    }
  }
  if (current.items.length > 0) {
    sections.push(current);
  }

  // Rebuild clean, well-spaced Markdown string
  const mdLines: string[] = [];
  for (const sec of sections) {
    mdLines.push(`## ${sec.title}`);
    for (const item of sec.items) {
      if (item.type === "h3") {
        mdLines.push(`### ${item.text}`);
      } else if (item.type === "li") {
        mdLines.push(`- ${item.text}`);
      } else {
        mdLines.push(item.text);
      }
    }
    mdLines.push("");
  }

  return {
    cleanMarkdown: mdLines.join("\n").trim(),
    sections,
  };
}

export const OfflineJdDrawer: React.FC<Props> = ({
  job,
  allJobs = [],
  onClose,
  onSelectJob,
  onUpdateStatus,
  onEnrichSingle,
  enriching,
}) => {
  const [viewMode, setViewMode] = useState<"formatted" | "markdown">("formatted");
  const [copiedMd, setCopiedMd] = useState(false);
  const [localStatus, setLocalStatus] = useState<string>("new");

  useEffect(() => {
    if (job) {
      setLocalStatus(job.status || "new");
    }
  }, [job]);

  const currentIdx = useMemo(() => {
    if (!job || allJobs.length === 0) return -1;
    return allJobs.findIndex((j) => j.id === job.id);
  }, [job, allJobs]);

  const prevJobId = currentIdx > 0 ? allJobs[currentIdx - 1]?.id : null;
  const nextJobId =
    currentIdx >= 0 && currentIdx < allJobs.length - 1
      ? allJobs[currentIdx + 1]?.id
      : null;

  useEffect(() => {
    if (!job) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" && prevJobId && onSelectJob) {
        onSelectJob(prevJobId);
      } else if (e.key === "ArrowRight" && nextJobId && onSelectJob) {
        onSelectJob(nextJobId);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [job, prevJobId, nextJobId, onClose, onSelectJob]);

  const { cleanMarkdown, sections } = useMemo(() => {
    if (!job) return { cleanMarkdown: "", sections: [] };
    return parseCleanMarkdownAndBlocks(
      job.full_jd_markdown || "",
      job.full_jd_html || ""
    );
  }, [job]);

  const markdownLines = useMemo(() => {
    if (!cleanMarkdown) return [];
    return cleanMarkdown.split("\n");
  }, [cleanMarkdown]);

  if (!job) return null;

  const handleCopyMarkdown = () => {
    if (!cleanMarkdown) return;
    navigator.clipboard?.writeText(cleanMarkdown).catch(() => {});
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 1800);
  };

  const handleStatusChange = async (newStatus: string) => {
    setLocalStatus(newStatus);
    if (onUpdateStatus) {
      await onUpdateStatus(job.id, newStatus);
    }
  };

  const renderSectionBadge = (category: JdSection["category"]) => {
    switch (category) {
      case "desc":
        return (
          <span className="w-6 h-6 rounded-md bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/70 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
            <Briefcase className="w-3.5 h-3.5" />
          </span>
        );
      case "req":
        return (
          <span className="w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </span>
        );
      case "benefit":
        return (
          <span className="w-6 h-6 rounded-md bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Award className="w-3.5 h-3.5" />
          </span>
        );
      default:
        return (
          <span className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center shrink-0">
            <Info className="w-3.5 h-3.5" />
          </span>
        );
    }
  };

  const isSaved = localStatus === "saved" || localStatus === "applied";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-zinc-950/45 dark:bg-black/65 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Navigation & Quick Close Bar */}
        <div className="px-5 py-2.5 bg-zinc-50/90 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            {allJobs.length > 1 && onSelectJob && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={!prevJobId}
                  onClick={() => prevJobId && onSelectJob(prevJobId)}
                  title="Việc làm trước (Phím mũi tên ←)"
                  className="studio-btn-secondary h-7 px-2 text-[11px] inline-flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Trước</span>
                </button>
                <span className="px-2 font-mono text-[11px] text-zinc-500 tabular-nums">
                  {currentIdx >= 0 ? `${currentIdx + 1}/${allJobs.length}` : `#${job.id}`}
                </span>
                <button
                  type="button"
                  disabled={!nextJobId}
                  onClick={() => nextJobId && onSelectJob(nextJobId)}
                  title="Việc làm tiếp theo (Phím mũi tên →)"
                  className="studio-btn-secondary h-7 px-2 text-[11px] inline-flex items-center gap-1"
                >
                  <span>Tiếp</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleStatusChange(isSaved ? "new" : "saved")}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold border inline-flex items-center gap-1.5 transition ${
                isSaved
                  ? "bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                  : "studio-btn-secondary"
              }`}
            >
              <Bookmark className={`w-3 h-3 ${isSaved ? "fill-current" : ""}`} />
              <span>{isSaved ? "Đã lưu tin" : "Lưu tin"}</span>
            </button>

            <CustomSelect
              size="xs"
              value={localStatus}
              onChange={handleStatusChange}
              options={CRM_STATUS_OPTIONS}
              align="right"
              className="w-28"
            />

            <button
              type="button"
              onClick={onClose}
              title="Đóng Drawer (Esc)"
              className="h-7 w-7 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 flex items-center justify-center transition shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Document Header */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="px-2.5 py-0.5 rounded-md font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70">
              {job.salary_raw || "Thỏa thuận"}
            </span>
            {!job.is_negotiable && job.salary_vnd_normalized > 0 && (
              <span className="px-2 py-0.5 rounded font-mono text-zinc-500 dark:text-zinc-400">
                ≈ {job.salary_vnd_normalized}M VNĐ
              </span>
            )}
            {job.quality_tier && (
              <span className="px-2 py-0.5 rounded font-mono font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70 text-[11px]">
                {job.quality_tier} · {job.quality_score || 75}đ
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
              {job.work_mode}
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
              {job.seniority}
            </span>
            <span className="px-2 py-0.5 rounded font-mono text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-200/80 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70">
              {job.portal_name || job.source_domain}
            </span>
          </div>

          <h2 className="text-base font-bold text-zinc-950 dark:text-zinc-50 leading-snug">
            {job.title}
          </h2>

          <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
              <Building2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              {job.company_name}
              {job.company_size ? ` (${job.company_size})` : ""}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              {job.location_city}
            </span>
          </div>
        </div>

        {/* HR Contact & Actions Bar */}
        <div className="px-4 py-2.5 bg-zinc-50/80 dark:bg-zinc-950/60 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500 dark:text-zinc-400 font-semibold">
                Liên hệ HR:
              </span>
              {job.hr_name && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200">
                  <UserCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  {job.hr_name}
                </span>
              )}
              {job.hr_email && (
                <a
                  href={`mailto:${job.hr_email}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  <Mail className="w-3 h-3" />
                  {job.hr_email}
                </a>
              )}
              {job.hr_phone && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-800 dark:text-zinc-200">
                  <Phone className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  {job.hr_phone}
                </span>
              )}
              {!job.hr_name && !job.hr_email && !job.hr_phone && (
                <span className="text-zinc-400 dark:text-zinc-500">
                  Chưa công khai trên thẻ tin
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={enriching}
                onClick={() => onEnrichSingle(job.id)}
                className="studio-btn-secondary h-7.5 px-2.5 text-xs flex items-center gap-1.5"
              >
                {enriching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Làm mới Full JD</span>
              </button>

              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="studio-btn-primary h-7.5 px-3 text-xs flex items-center gap-1.5"
              >
                <span>Mở bài gốc</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {job.skills && job.skills.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              {job.skills.map((sk) => (
                <span
                  key={sk}
                  className="px-2 py-0.5 rounded text-[11px] font-mono bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
                >
                  {sk}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Reader Toolbar */}
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              Nội dung Mô tả Công việc (Offline JD)
            </span>
            {sections.length > 0 && (
              <span className="text-[11px] font-mono text-zinc-400">
                · {sections.length} phần
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {cleanMarkdown && (
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="studio-btn-secondary h-7 px-2.5 text-[11px] flex items-center gap-1"
              >
                {copiedMd ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>
            )}

            <div className="inline-flex p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setViewMode("formatted")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === "formatted"
                    ? "bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 shadow-2xs"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                }`}
              >
                Trình đọc
              </button>
              <button
                type="button"
                onClick={() => setViewMode("markdown")}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                  viewMode === "markdown"
                    ? "bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 shadow-2xs"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400"
                }`}
              >
                Markdown
              </button>
            </div>
          </div>
        </div>

        {/* Document Content */}
        <div className="p-4 overflow-y-auto flex-1 bg-zinc-50/70 dark:bg-zinc-950 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
          {sections.length === 0 ? (
            <div className="studio-card p-8 text-center space-y-3">
              <p className="text-zinc-800 dark:text-zinc-200 font-semibold">
                Trạng thái JD: <span className="font-mono">{job.deep_crawl_status}</span>
              </p>
              {job.summary && (
                <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-lg mx-auto bg-zinc-50 dark:bg-zinc-900 p-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 text-left leading-relaxed">
                  {sanitizeLineText(job.summary)}
                </p>
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Bấm <strong>Làm mới Full JD</strong> để tải toàn bộ mô tả công việc chi tiết.
              </p>
            </div>
          ) : viewMode === "formatted" ? (
            <div className="space-y-3">
              {sections.map((sec, sIdx) => (
                <div
                  key={sIdx}
                  className="studio-card p-4 space-y-2.5 bg-white dark:bg-zinc-900"
                >
                  <div className="flex items-center gap-2.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                    {renderSectionBadge(sec.category)}
                    <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-950 dark:text-zinc-100">
                      {sec.title}
                    </h3>
                  </div>

                  <div className="space-y-2 text-[13px] leading-relaxed">
                    {sec.items.map((item, idx) => {
                      if (item.type === "h3") {
                        return (
                          <h4
                            key={idx}
                            className="text-xs font-bold text-zinc-950 dark:text-zinc-100 pt-1.5"
                          >
                            {item.text}
                          </h4>
                        );
                      }
                      if (item.type === "li") {
                        return (
                          <div
                            key={idx}
                            className="flex items-start gap-2.5 pl-1 text-zinc-700 dark:text-zinc-300"
                          >
                            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 shrink-0" />
                            <span>{item.text}</span>
                          </div>
                        );
                      }
                      return (
                        <p key={idx} className="text-zinc-700 dark:text-zinc-300">
                          {item.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="studio-card overflow-hidden bg-white dark:bg-zinc-900">
              <div className="p-3.5 font-mono text-xs space-y-1 overflow-x-auto">
                {markdownLines.map((line, idx) => {
                  const isHeading = line.startsWith("#");
                  const isBullet = line.startsWith("- ");
                  return (
                    <div key={idx} className="flex items-start gap-3 leading-relaxed">
                      <span className="select-none text-[10px] text-zinc-400 dark:text-zinc-600 w-7 text-right shrink-0 pt-0.5 tabular-nums">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`whitespace-pre-wrap break-words flex-1 ${
                          isHeading
                            ? "font-bold text-zinc-950 dark:text-white pt-1"
                            : isBullet
                            ? "text-zinc-800 dark:text-zinc-200"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        {line || " "}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
