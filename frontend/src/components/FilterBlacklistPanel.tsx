import React, { useMemo, useState } from "react";
import {
  Ban,
  Filter,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { CustomSelect } from "./ui/CustomSelect";

interface FilterRuleItem {
  id: number;
  rule_type: "company_blacklist" | "keyword_exclude" | "keyword_whitelist";
  pattern: string;
  note: string;
  is_active: boolean;
}

interface Props {
  rules: FilterRuleItem[];
  onAddRule: (ruleType: string, pattern: string, note: string) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
}

export const FilterBlacklistPanel: React.FC<Props> = ({
  rules,
  onAddRule,
  onDeleteRule,
}) => {
  const [ruleType, setRuleType] = useState<string>("company_blacklist");
  const [pattern, setPattern] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [activeTab, setActiveTab] = useState<
    "all" | "company_blacklist" | "keyword_exclude" | "keyword_whitelist"
  >("all");
  const [searchQ, setSearchQ] = useState<string>("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;
    await onAddRule(ruleType, pattern.trim(), note.trim());
    setPattern("");
    setNote("");
  };

  const counts = useMemo(() => {
    return {
      all: rules.length,
      company_blacklist: rules.filter((r) => r.rule_type === "company_blacklist").length,
      keyword_exclude: rules.filter((r) => r.rule_type === "keyword_exclude").length,
      keyword_whitelist: rules.filter((r) => r.rule_type === "keyword_whitelist").length,
    };
  }, [rules]);

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (activeTab !== "all" && r.rule_type !== activeTab) return false;
      if (searchQ.trim()) {
        const q = searchQ.toLowerCase().trim();
        return (
          r.pattern.toLowerCase().includes(q) ||
          (r.note || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rules, activeTab, searchQ]);

  const renderBadge = (type: string) => {
    if (type === "company_blacklist") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/70">
          <Ban className="w-3 h-3" />
          <span>Chặn Công Ty</span>
        </span>
      );
    }
    if (type === "keyword_exclude") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/70">
          <ShieldAlert className="w-3 h-3" />
          <span>Chặn Từ Khóa</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70">
        <Star className="w-3 h-3 fill-current" />
        <span>Từ Khóa Ưu Tiên</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="studio-card overflow-visible">
        <div className="p-4 bg-zinc-50/70 dark:bg-zinc-900/60 border-b border-zinc-200 dark:border-zinc-800 space-y-3 rounded-t-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
                <Filter className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  Bộ Lọc Tự Động &amp; Danh Sách Chặn / Ưu Tiên (Node 06)
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Tự động loại bỏ công ty/từ khóa rác và gắn nhãn nổi bật (Highlight) các việc làm khớp từ khóa ưu tiên
                </p>
              </div>
            </div>
          </div>

          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 md:grid-cols-12 gap-2.5 text-xs"
          >
            <div className="md:col-span-3">
              <CustomSelect
                value={ruleType}
                onChange={(val) => setRuleType(val)}
                icon={<Filter className="w-3.5 h-3.5" />}
                options={[
                  { value: "company_blacklist", label: "Chặn Công ty (Blacklist)" },
                  { value: "keyword_exclude", label: "Chặn Từ khóa (Exclude)" },
                  { value: "keyword_whitelist", label: "Từ khóa Ưu tiên (Highlight)" },
                ]}
              />
            </div>

            <div className="md:col-span-4">
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="Nhập tên công ty hoặc từ khóa..."
                className="studio-input w-full h-9 px-3"
              />
            </div>

            <div className="md:col-span-3">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú lý do (tuỳ chọn)..."
                className="studio-input w-full h-9 px-3"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                className="studio-btn-primary w-full h-9 px-4 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm quy tắc</span>
              </button>
            </div>
          </form>
        </div>

        {/* Filter Bar & Tabs */}
        <div className="px-4 py-2.5 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: "all", label: "Tất cả", count: counts.all },
              {
                id: "company_blacklist",
                label: "Chặn Công ty",
                count: counts.company_blacklist,
              },
              {
                id: "keyword_exclude",
                label: "Chặn Từ khóa",
                count: counts.keyword_exclude,
              },
              {
                id: "keyword_whitelist",
                label: "Từ khóa Ưu tiên",
                count: counts.keyword_whitelist,
              },
            ].map((t) => {
              const isAct = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as any)}
                  className={`h-7 px-2.5 rounded-md font-medium inline-flex items-center gap-1.5 transition ${
                    isAct
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-semibold"
                      : "text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span>{t.label}</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.2 rounded ${
                      isAct
                        ? "bg-white/20 text-white dark:bg-zinc-950/15 dark:text-zinc-950"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Tìm nhanh quy tắc..."
              className="studio-input w-full h-7.5 pl-8 pr-7 text-xs"
            />
            {searchQ && (
              <button
                type="button"
                onClick={() => setSearchQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
          {filteredRules.length === 0 ? (
            <div className="p-8 text-center text-zinc-400">
              Không có quy tắc lọc nào trong danh mục này.
            </div>
          ) : (
            filteredRules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 transition"
              >
                <div className="flex flex-wrap items-center gap-3">
                  {renderBadge(r.rule_type)}
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 font-mono">
                    {r.pattern}
                  </span>
                  {r.note && (
                    <span className="text-zinc-500 dark:text-zinc-400">
                      — {r.note}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteRule(r.id)}
                  title="Xóa quy tắc"
                  className="h-7 w-7 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
