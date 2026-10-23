import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  Copy,
  Database,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Network,
  ShieldCheck,
  Sliders,
} from "lucide-react";
import { NodeConfig, PipelineNodeTelemetry } from "../api/client";
import { CustomSelect } from "./ui/CustomSelect";

interface Props {
  nodes: PipelineNodeTelemetry[];
  nodeConfig: NodeConfig;
  onChangeConfig: (cfg: NodeConfig) => void;
  activeRunInfo: any | null;
  recentRuns?: any[];
  onSelectRun?: (runId: number) => void;
}

const DEFAULT_NODE_META: Record<
  string,
  {
    stepNum: string;
    shortTitle: string;
    subtitle: string;
    categoryTag: string;
    icon: React.ComponentType<any>;
  }
> = {
  node_1_input: {
    stepNum: "01",
    shortTitle: "Trigger & Discovery",
    subtitle: "URL / 20-Site Matrix",
    categoryTag: "SOURCE",
    icon: Globe,
  },
  node_2_bypass: {
    stepNum: "02",
    shortTitle: "Unattended Bypass",
    subtitle: "API • TLS • Stealth",
    categoryTag: "SHIELD",
    icon: ShieldCheck,
  },
  node_3_sniffer: {
    stepNum: "03",
    shortTitle: "State & XHR Sniffer",
    subtitle: "JSON-LD • __NEXT_DATA__",
    categoryTag: "PARSER",
    icon: Network,
  },
  node_4_extractor: {
    stepNum: "04",
    shortTitle: "Recipe & AI Extractor",
    subtitle: "DOM Cache • Self-Healing",
    categoryTag: "EXTRACT",
    icon: Bot,
  },
  node_5_deep_queue: {
    stepNum: "05",
    shortTitle: "2-Phase Deep Queue",
    subtitle: "Full JD • HR Contacts",
    categoryTag: "ENRICH",
    icon: Layers,
  },
  node_6_sink: {
    stepNum: "06",
    shortTitle: "Filter, Dedup & Sink",
    subtitle: "Blacklist • SQLite • Notify",
    categoryTag: "STORAGE",
    icon: Database,
  },
};

const FALLBACK_NODES: PipelineNodeTelemetry[] = Object.keys(DEFAULT_NODE_META).map(
  (id) => ({
    node_id: id,
    node_name: DEFAULT_NODE_META[id].shortTitle,
    status: "idle",
    duration_ms: 0,
    input_json: "{}",
    output_json: "{}",
    logs_text: "Sẵn sàng.",
    screenshot_filename: null,
    markdown_preview: null,
    updated_at: null,
  })
);

function parseNodeSummaryMetric(
  node: PipelineNodeTelemetry,
  activeRunInfo: any | null
): string {
  try {
    const out = JSON.parse(node.output_json || "{}");
    if (node.node_id === "node_1_input") {
      if (out.resolved_urls && Array.isArray(out.resolved_urls))
        return `${out.resolved_urls.length} URLs`;
      if (out.target_count !== undefined) return `${out.target_count} URLs`;
    }
    if (node.node_id === "node_2_bypass") {
      if (out.fetched_urls !== undefined) return `${out.fetched_urls} pages`;
      if (out.pages_fetched !== undefined) return `${out.pages_fetched} pages`;
    }
    if (node.node_id === "node_3_sniffer") {
      if (out.sniffed_jobs !== undefined) return `${out.sniffed_jobs} JSON items`;
      if (out.markdown_chars !== undefined)
        return `${Math.round(out.markdown_chars / 1000)}k chars`;
    }
    if (node.node_id === "node_4_extractor") {
      if (out.total_extracted !== undefined) return `${out.total_extracted} cards`;
      if (activeRunInfo?.total_found !== undefined && node.status !== "idle")
        return `${activeRunInfo.total_found} found`;
    }
    if (node.node_id === "node_5_deep_queue") {
      if (activeRunInfo && activeRunInfo.deep_crawl_total > 0) {
        return `${activeRunInfo.deep_crawl_completed}/${activeRunInfo.deep_crawl_total} JD`;
      }
      if (out.queued !== undefined) return `${out.queued} queued`;
    }
    if (node.node_id === "node_6_sink") {
      if (activeRunInfo && node.status !== "idle") {
        return `+${activeRunInfo.new_jobs_saved} saved`;
      }
    }
  } catch {
    // ignore
  }
  return node.status === "idle" ? "Ready" : `${node.duration_ms} ms`;
}

export const N8nPipelineCanvas: React.FC<Props> = ({
  nodes,
  nodeConfig,
  onChangeConfig,
  activeRunInfo,
  recentRuns = [],
  onSelectRun,
}) => {
  const displayNodes = nodes.length > 0 ? nodes : FALLBACK_NODES;
  const [selectedNodeId, setSelectedNodeId] = useState<string>("node_2_bypass");
  const [inspectorTab, setInspectorTab] = useState<
    "logs" | "io" | "screenshot" | "markdown" | "config"
  >("logs");
  // Default collapsed when idle; auto-opens while running or when user clicks a node
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(false);
  const [copiedState, setCopiedState] = useState<boolean>(false);

  useEffect(() => {
    if (activeRunInfo?.status === "running") {
      setInspectorOpen(true);
    }
  }, [activeRunInfo?.status]);

  const selectedNode =
    displayNodes.find((n) => n.node_id === selectedNodeId) || displayNodes[0];

  const selectedMeta =
    DEFAULT_NODE_META[selectedNode.node_id] || DEFAULT_NODE_META.node_1_input;

  const logLines = useMemo(() => {
    const raw =
      selectedNode.logs_text ||
      "Chưa có nhật ký thực thi cho Node này.";
    return raw.split(/\r?\n/);
  }, [selectedNode.logs_text]);

  const handleCopyInspectorText = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedState(true);
    setTimeout(() => setCopiedState(false), 1800);
  };

  const renderStatusPill = (status: PipelineNodeTelemetry["status"]) => {
    switch (status) {
      case "running":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-600 text-white shadow-2xs">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            RUN
          </span>
        );
      case "success":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            OK
          </span>
        );
      case "warning":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/70">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            WARN
          </span>
        );
      case "error":
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/70">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            ERR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-zinc-800/90 text-slate-500 dark:text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-zinc-600" />
            IDLE
          </span>
        );
    }
  };

  const deepQueuePct =
    activeRunInfo && activeRunInfo.deep_crawl_total > 0
      ? Math.min(
          100,
          Math.round(
            (activeRunInfo.deep_crawl_completed /
              activeRunInfo.deep_crawl_total) *
              100
          )
        )
      : 0;

  return (
    <div className="studio-card overflow-visible">
      {/* Compact Canvas Header Bar */}
      <div className="px-4 py-2.5 bg-slate-50/90 dark:bg-zinc-900/75 border-b border-slate-200/90 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 rounded-t-xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            <span className="text-xs font-bold text-slate-900 dark:text-zinc-50">
              Luồng Thực Thi 6-Node Pipeline
            </span>
          </div>

          {recentRuns.length > 0 && onSelectRun && (
            <div className="pl-2 border-l border-slate-200 dark:border-zinc-800 w-60">
              <CustomSelect
                size="sm"
                value={String(activeRunInfo?.id || recentRuns[0]?.id || "")}
                onChange={(val) => onSelectRun(parseInt(val, 10))}
                icon={<History className="w-3.5 h-3.5 text-indigo-500" />}
                options={recentRuns.map((r) => ({
                  value: String(r.id),
                  label: `Run #${r.id} · ${r.status.toUpperCase()} (+${r.new_jobs_saved} jobs)`,
                }))}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {activeRunInfo && (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-700 dark:text-zinc-300">
                Tìm thấy: <strong className="text-slate-950 dark:text-zinc-50">{activeRunInfo.total_found}</strong>
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-600 text-white font-bold shadow-2xs">
                Lưu mới: +{activeRunInfo.new_jobs_saved}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400">
                Trùng lặp: <strong>{activeRunInfo.duplicates_skipped || 0}</strong>
              </span>
              {activeRunInfo.deep_crawl_total > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold">
                  Phase 2 JD:{" "}
                  <strong>
                    {activeRunInfo.deep_crawl_completed}/{activeRunInfo.deep_crawl_total}
                  </strong>
                </span>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setInspectorOpen((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition ${
              inspectorOpen
                ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                : "studio-btn-secondary"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{inspectorOpen ? "Ẩn Console" : "Xem Console & Log"}</span>
            {inspectorOpen ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Compact 6-Node Horizontal Stepper */}
      <div className="bg-dot-grid px-4 py-3.5 overflow-x-auto rounded-b-xl">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 min-w-[880px]">
          {displayNodes.map((node, index) => {
            const meta =
              DEFAULT_NODE_META[node.node_id] || DEFAULT_NODE_META.node_1_input;
            const IconComponent = meta.icon;
            const isSelected = node.node_id === selectedNodeId && inspectorOpen;
            const summaryMetric = parseNodeSummaryMetric(node, activeRunInfo);
            const isFlowActive =
              node.status === "running" || node.status === "success";

            return (
              <div key={node.node_id} className="relative flex items-stretch">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedNodeId === node.node_id && inspectorOpen) {
                      setInspectorOpen(false);
                    } else {
                      setSelectedNodeId(node.node_id);
                      setInspectorOpen(true);
                    }
                  }}
                  className={`group relative w-full text-left rounded-xl bg-white dark:bg-zinc-900 border transition-all overflow-hidden flex flex-col justify-between p-3 ${
                    isSelected
                      ? "border-indigo-600 dark:border-indigo-400 ring-2 ring-indigo-500/20 shadow-sm"
                      : node.status === "running"
                      ? "border-indigo-500 ring-2 ring-indigo-500/15"
                      : "border-slate-200 dark:border-zinc-800 hover:border-indigo-300 dark:hover:border-zinc-600"
                  }`}
                >
                  <div
                    className={`absolute top-0 left-0 right-0 h-1 transition-colors ${
                      node.status === "running"
                        ? "live-progress-shimmer"
                        : node.status === "success"
                        ? "bg-emerald-500"
                        : isSelected
                        ? "bg-indigo-600"
                        : "bg-slate-200 dark:bg-zinc-800"
                    }`}
                  />

                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 dark:text-zinc-500">
                        STEP {meta.stepNum}
                      </span>
                      {renderStatusPill(node.status)}
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                          isSelected || node.status === "running"
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : node.status === "success"
                            ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/70"
                            : "bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-zinc-700"
                        }`}
                      >
                        <IconComponent className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-slate-900 dark:text-zinc-50 truncate leading-tight">
                          {meta.shortTitle}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-zinc-400 truncate">
                          {meta.subtitle}
                        </div>
                      </div>
                    </div>

                    {node.node_id === "node_5_deep_queue" &&
                      activeRunInfo &&
                      activeRunInfo.deep_crawl_total > 0 && (
                        <div className="mt-2">
                          <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-indigo-600 dark:bg-indigo-400 transition-all duration-500"
                              style={{ width: `${deepQueuePct}%` }}
                            />
                          </div>
                        </div>
                      )}
                  </div>

                  <div className="mt-2.5 pt-1.5 border-t border-slate-100 dark:border-zinc-800/80 flex items-center justify-between text-[10px] font-mono">
                    <span
                      className={`px-1.5 py-0.5 rounded font-semibold truncate max-w-[105px] ${
                        node.status === "success"
                          ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                          : "bg-slate-100 dark:bg-zinc-800/90 text-slate-700 dark:text-zinc-200"
                      }`}
                    >
                      {summaryMetric}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-slate-400 dark:text-zinc-500 tabular-nums">
                      <Clock className="w-2.5 h-2.5" />
                      {node.duration_ms}ms
                    </span>
                  </div>
                </button>

                {index < displayNodes.length - 1 && (
                  <svg
                    className="hidden lg:block absolute -right-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3 z-0 pointer-events-none"
                    viewBox="0 0 14 12"
                    fill="none"
                  >
                    <path
                      d="M0 6H12"
                      className={
                        isFlowActive
                          ? "stroke-indigo-600 dark:stroke-indigo-400 n8n-wire-animated"
                          : "stroke-slate-300 dark:stroke-zinc-700"
                      }
                      strokeWidth="1.5"
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Collapsible IDE Node Inspector Drawer */}
      {inspectorOpen && (
        <div className="bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 rounded-b-xl overflow-hidden">
          <div className="px-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 bg-zinc-50/80 dark:bg-zinc-900/80">
            <div className="flex items-center gap-2 py-1.5">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950">
                NODE {selectedMeta.stepNum}
              </span>
              <span className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                {selectedNode.node_name}
              </span>
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                · {selectedNode.duration_ms} ms
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              {[
                { id: "logs", label: "Console Logs", icon: Activity },
                { id: "io", label: "Input / Output JSON", icon: Code2 },
                { id: "screenshot", label: "Snapshot", icon: ImageIcon },
                { id: "markdown", label: "Markdown", icon: FileText },
                { id: "config", label: "Node Config", icon: Sliders },
              ].map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setInspectorTab(t.id as any)}
                    className={`px-2.5 py-2 text-xs font-medium border-b-2 flex items-center gap-1.5 transition ${
                      inspectorTab === t.id
                        ? "border-zinc-900 dark:border-zinc-100 text-zinc-950 dark:text-white font-semibold"
                        : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3.5 max-h-52 overflow-y-auto text-xs font-mono bg-white dark:bg-zinc-900">
            {inspectorTab === "logs" && (
              <div className="relative studio-subpanel p-2.5">
                <button
                  type="button"
                  onClick={() =>
                    handleCopyInspectorText(selectedNode.logs_text || "")
                  }
                  className="studio-btn-secondary absolute top-2 right-2 px-2 py-0.5 text-[11px] font-sans flex items-center gap-1"
                >
                  {copiedState ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <div className="space-y-0.5 pr-16">
                  {logLines.map((line, i) => {
                    const isErr =
                      line.includes("ERR") ||
                      line.includes("Lỗi") ||
                      line.includes("failed");
                    const isOk =
                      line.includes("OK") ||
                      line.includes("✓") ||
                      line.includes("Saved") ||
                      line.includes("completed");

                    return (
                      <div key={i} className="flex items-start gap-2.5 leading-relaxed">
                        <span className="select-none text-[10px] text-zinc-400 dark:text-zinc-600 w-5 text-right shrink-0 pt-0.5">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span
                          className={`whitespace-pre-wrap break-all ${
                            isErr
                              ? "text-zinc-950 dark:text-white font-bold underline decoration-rose-500/60"
                              : isOk
                              ? "text-zinc-950 dark:text-zinc-100 font-semibold"
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

            {inspectorTab === "io" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="studio-subpanel p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Node Input Payload
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyInspectorText(selectedNode.input_json || "{}")
                      }
                      className="text-[10px] text-zinc-700 dark:text-zinc-300 hover:underline font-sans"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="text-zinc-700 dark:text-zinc-300 overflow-x-auto leading-relaxed">
                    {selectedNode.input_json || "{}"}
                  </pre>
                </div>

                <div className="studio-subpanel p-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Node Output Telemetry
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopyInspectorText(selectedNode.output_json || "{}")
                      }
                      className="text-[10px] text-zinc-700 dark:text-zinc-300 hover:underline font-sans"
                    >
                      Copy JSON
                    </button>
                  </div>
                  <pre className="text-zinc-800 dark:text-zinc-200 overflow-x-auto leading-relaxed">
                    {selectedNode.output_json || "{}"}
                  </pre>
                </div>
              </div>
            )}

            {inspectorTab === "screenshot" && (
              <div>
                {selectedNode.screenshot_filename ? (
                  <div className="space-y-2">
                    <div className="text-zinc-500 font-sans">
                      Ảnh chụp trình duyệt ({selectedNode.screenshot_filename}):
                    </div>
                    <img
                      src={`/api/screenshots/${encodeURIComponent(
                        selectedNode.screenshot_filename
                      )}`}
                      alt="Browser Crawl Screenshot"
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 max-h-44 object-contain shadow-sm"
                    />
                  </div>
                ) : (
                  <div className="studio-subpanel text-zinc-400 py-6 text-center font-sans">
                    Chưa có ảnh chụp màn hình tại Node này.
                  </div>
                )}
              </div>
            )}

            {inspectorTab === "markdown" && (
              <div className="studio-subpanel p-2.5">
                <pre className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {selectedNode.markdown_preview ||
                    "Chọn Node 03 (State & XHR Sniffer) sau khi chạy để xem nội dung Markdown đã làm sạch."}
                </pre>
              </div>
            )}

            {inspectorTab === "config" && (
              <div className="studio-subpanel p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 font-sans">
                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_sniffer}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_sniffer: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 03: Bật JSON-LD &amp; XHR Sniffer</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_recipe_cache}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_recipe_cache: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 04: Dùng Cached Selector Recipe</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_ai_fallback}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_ai_fallback: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 04: Bật AI Self-Healing LLM</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_deep_crawl}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_deep_crawl: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 05: Bật Pha 2 Deep Crawl JD</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_filter_blacklist}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_filter_blacklist: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 06: Áp dụng Company Blacklist</span>
                </label>

                <label className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeConfig.enable_notifications}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        enable_notifications: e.target.checked,
                      })
                    }
                    className="rounded border-zinc-300 dark:border-zinc-700 accent-zinc-900 dark:accent-zinc-100"
                  />
                  <span>Node 06: Gửi thông báo Telegram/Discord</span>
                </label>

                <div>
                  <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    Số lần cuộn trang (Infinite Scroll):
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={15}
                    value={nodeConfig.scroll_times}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        scroll_times: Math.max(
                          0,
                          parseInt(e.target.value || "0", 10)
                        ),
                      })
                    }
                    className="studio-input w-full px-2 py-1"
                  />
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400 mb-1">
                    Số Job tối đa cào sâu Pha 2:
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={nodeConfig.deep_crawl_max_items}
                    onChange={(e) =>
                      onChangeConfig({
                        ...nodeConfig,
                        deep_crawl_max_items: Math.max(
                          1,
                          parseInt(e.target.value || "25", 10)
                        ),
                      })
                    }
                    className="studio-input w-full px-2 py-1"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
