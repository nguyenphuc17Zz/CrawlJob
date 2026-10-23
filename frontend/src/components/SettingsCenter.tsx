import React, { useState } from "react";
import {
  Bell,
  Bot,
  Check,
  Eye,
  EyeOff,
  Globe,
  Plus,
  Save,
  Shield,
  Trash2,
} from "lucide-react";
import { CustomSelect } from "./ui/CustomSelect";

interface Props {
  settings: Record<string, string>;
  proxies: any[];
  onSaveSettings: (updated: Record<string, string>) => Promise<void>;
  onAddProxy: (proxyUrl: string, protocol: string, label: string) => Promise<void>;
  onDeleteProxy: (id: number) => Promise<void>;
}

export const SettingsCenter: React.FC<Props> = ({
  settings,
  proxies,
  onSaveSettings,
  onAddProxy,
  onDeleteProxy,
}) => {
  const [form, setForm] = useState<Record<string, string>>(settings);
  const [savedBanner, setSavedBanner] = useState(false);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyProtocol, setProxyProtocol] = useState("http");
  const [proxyLabel, setProxyLabel] = useState("");

  React.useEffect(() => {
    setForm(settings);
  }, [settings]);

  const updateField = (k: string, v: string) => {
    setForm((prev) => ({ ...prev, [k]: v }));
  };

  const toggleSecretVisibility = (key: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings(form);
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 3000);
  };

  const handleCreateProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!proxyUrl.trim()) return;
    await onAddProxy(proxyUrl.trim(), proxyProtocol, proxyLabel.trim());
    setProxyUrl("");
    setProxyLabel("");
  };

  const inputClass = "studio-input w-full h-9 px-3 text-xs";

  const renderSecretInput = (
    fieldKey: string,
    label: string,
    placeholder: string
  ) => {
    const isVisible = Boolean(visibleSecrets[fieldKey]);
    return (
      <div>
        <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
          {label}
        </label>
        <div className="relative">
          <input
            type={isVisible ? "text" : "password"}
            value={form[fieldKey] || ""}
            onChange={(e) => updateField(fieldKey, e.target.value)}
            placeholder={placeholder}
            className="studio-input w-full h-9 pl-3 pr-8 text-xs font-mono"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => toggleSecretVisibility(fieldKey)}
            title={isVisible ? "Ẩn khóa bảo mật" : "Hiện khóa bảo mật"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition"
          >
            {isVisible ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Sticky Top Summary & Save Bar */}
        <div className="studio-card px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 sticky top-12 z-10 backdrop-blur-md bg-white/95 dark:bg-zinc-900/95">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="font-bold text-zinc-950 dark:text-zinc-100">
              Trung Tâm Cấu Hình Hệ Thống
            </span>
            <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70 font-mono text-[11px] font-semibold">
              AI: {(form.ai_provider || "gemini").toUpperCase()}
            </span>
            <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
              Proxies: {proxies.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {savedBanner && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                <Check className="w-3.5 h-3.5" />
                <span>Đã lưu thành công</span>
              </span>
            )}
            <button
              type="submit"
              className="studio-btn-primary h-8.5 px-4 text-xs flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Lưu toàn bộ cấu hình</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 1. AI Engine Multi-Provider */}
          <div className="studio-card p-4 space-y-3.5 overflow-visible">
            <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  1. Cấu hình AI LLM (Self-Healing &amp; Phân tích)
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Hỗ trợ đa nhà cung cấp AI hoặc chạy miễn phí qua Local Ollama
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                  AI Provider
                </label>
                <CustomSelect
                  value={form.ai_provider || "gemini"}
                  onChange={(val) => updateField("ai_provider", val)}
                  icon={<Bot className="w-3.5 h-3.5" />}
                  options={[
                    { value: "gemini", label: "Google Gemini API" },
                    { value: "openai", label: "OpenAI API" },
                    { value: "groq", label: "Groq Cloud" },
                    { value: "openrouter", label: "OpenRouter API" },
                    { value: "ollama", label: "Local Ollama" },
                  ]}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                  Model ID
                </label>
                <input
                  type="text"
                  value={form.ai_model || ""}
                  onChange={(e) => updateField("ai_model", e.target.value)}
                  placeholder="gemini-2.5-flash, gpt-4o-mini..."
                  className={`${inputClass} font-mono`}
                />
              </div>

              {renderSecretInput("gemini_api_key", "Google Gemini API Key", "AIzaSy...")}
              {renderSecretInput("openai_api_key", "OpenAI API Key", "sk-...")}
              {renderSecretInput("groq_api_key", "Groq API Key", "gsk_...")}
              {renderSecretInput("openrouter_api_key", "OpenRouter API Key", "sk-or-v1-...")}

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                  Local Ollama URL
                </label>
                <input
                  type="text"
                  value={form.ollama_base_url || "http://127.0.0.1:11434"}
                  onChange={(e) => updateField("ollama_base_url", e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </div>
          </div>

          {/* 2. Zero-Touch Unattended Captcha & Bypass Config */}
          <div className="studio-card p-4 space-y-3.5">
            <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
                <Shield className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                  2. Giải Captcha &amp; Phiên Trình Duyệt (Node 02)
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Cấu hình vượt tường lửa Cloudflare, Chrome CDP &amp; Cookie phiên đăng nhập
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {renderSecretInput("capsolver_api_key", "CapSolver API Key", "CAP-...")}
              {renderSecretInput("twocaptcha_api_key", "2Captcha API Key", "2Captcha Key...")}

              <div>
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                  FlareSolverr URL
                </label>
                <input
                  type="text"
                  value={form.flaresolverr_url || "http://127.0.0.1:8191/v1"}
                  onChange={(e) => updateField("flaresolverr_url", e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                  Chrome CDP URL
                </label>
                <input
                  type="text"
                  value={form.chrome_cdp_url || "http://127.0.0.1:9222"}
                  onChange={(e) => updateField("chrome_cdp_url", e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div className="sm:col-span-2">
                {renderSecretInput(
                  "custom_cookie_header",
                  "Cookie Header Tùy Chỉnh (LinkedIn / Cloudflare)",
                  "li_at=...; cf_clearance=...;"
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Notification Channels */}
        <div className="studio-card p-4 space-y-3.5">
          <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
              <Bell className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
                3. Kênh Thông Báo Tự Động &amp; Webhook (Node 06)
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Tự động bắn tin về Telegram, Discord hoặc đồng bộ Google Sheets khi phát hiện việc làm mới
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {renderSecretInput("telegram_bot_token", "Telegram Bot Token", "123456:ABC-DEF...")}

            <div>
              <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 mb-1">
                Telegram Chat ID
              </label>
              <input
                type="text"
                value={form.telegram_chat_id || ""}
                onChange={(e) => updateField("telegram_chat_id", e.target.value)}
                placeholder="-100123456789"
                className={`${inputClass} font-mono`}
              />
            </div>

            {renderSecretInput(
              "discord_webhook_url",
              "Discord Webhook URL",
              "https://discord.com/api/webhooks/..."
            )}
            {renderSecretInput(
              "sheets_webhook_url",
              "Google Sheets Webhook URL",
              "https://script.google.com/macros/s/..."
            )}
          </div>
        </div>
      </form>

      {/* 4. Proxy Rotation Pool */}
      <div className="studio-card p-4 space-y-3.5 overflow-visible">
        <div className="flex items-center gap-2.5 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
          <div className="w-7 h-7 rounded-lg bg-zinc-900 dark:bg-zinc-100 flex items-center justify-center text-white dark:text-zinc-950">
            <Globe className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-zinc-950 dark:text-zinc-100">
              4. Danh Sách Proxy Luân Phiên ({proxies.length})
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Tự động xoay vòng IP khi quét số lượng lớn trang tuyển dụng
            </p>
          </div>
        </div>

        <form
          onSubmit={handleCreateProxy}
          className="grid grid-cols-1 md:grid-cols-12 gap-2.5 text-xs"
        >
          <div className="md:col-span-3">
            <CustomSelect
              value={proxyProtocol}
              onChange={(val) => setProxyProtocol(val)}
              icon={<Globe className="w-3.5 h-3.5" />}
              options={[
                { value: "http", label: "HTTP / HTTPS Proxy" },
                { value: "socks5", label: "SOCKS5 Proxy" },
              ]}
            />
          </div>
          <div className="md:col-span-4">
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://user:pass@ip:port"
              className={`${inputClass} font-mono`}
            />
          </div>
          <div className="md:col-span-3">
            <input
              type="text"
              value={proxyLabel}
              onChange={(e) => setProxyLabel(e.target.value)}
              placeholder="Ghi chú (VD: VN Residential)"
              className={inputClass}
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="studio-btn-primary w-full h-9 px-4 flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm Proxy</span>
            </button>
          </div>
        </form>

        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
          {proxies.length === 0 ? (
            <div className="py-4 text-center text-zinc-400">
              Chưa có Proxy nào (Hệ thống đang kết nối trực tiếp).
            </div>
          ) : (
            proxies.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-2.5 px-2 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 rounded-lg transition"
              >
                <div className="font-mono text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold uppercase">
                    {p.protocol}
                  </span>
                  <span>{p.proxy_url}</span>
                  {p.label ? (
                    <span className="text-zinc-500 font-sans">({p.label})</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteProxy(p.id)}
                  className="h-7 w-7 rounded-lg text-zinc-400 hover:text-rose-600 flex items-center justify-center transition"
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
