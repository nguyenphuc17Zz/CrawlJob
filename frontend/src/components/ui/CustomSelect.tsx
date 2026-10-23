import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (newValue: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: "xs" | "sm" | "md";
  icon?: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  disabled?: boolean;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Chọn...",
  size = "md",
  icon,
  className = "",
  align = "left",
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;
    if (containerRef.current && typeof window !== "undefined") {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 220 && rect.top > 240);
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const sizeClasses =
    size === "xs"
      ? "h-7 px-2 text-[11px] rounded-md gap-1"
      : size === "sm"
      ? "h-8 px-2.5 text-xs rounded-lg gap-1.5"
      : "h-9 px-3 text-xs rounded-lg gap-2";

  return (
    <div
      ref={containerRef}
      className={`relative inline-block text-left select-none ${className}`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className={`w-full inline-flex items-center justify-between font-medium bg-white dark:bg-zinc-950 border transition-all duration-150 ${sizeClasses} ${
          open
            ? "border-zinc-900 dark:border-zinc-200 ring-2 ring-zinc-900/10 dark:ring-zinc-100/10 text-zinc-950 dark:text-zinc-50"
            : "border-zinc-200/95 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-800 dark:text-zinc-200"
        } disabled:opacity-40 disabled:pointer-events-none`}
      >
        <span className="flex items-center gap-1.5 min-w-0 truncate">
          {icon && (
            <span className="text-zinc-400 dark:text-zinc-500 shrink-0">
              {icon}
            </span>
          )}
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180 text-zinc-900 dark:text-zinc-100" : ""
          }`}
        />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-50 min-w-full w-max max-w-[280px] max-h-64 overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-1 space-y-0.5 ${
            dropUp ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-md text-xs text-left transition-colors ${
                  isSelected
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-semibold"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                <div className="min-w-0 truncate">
                  <div className="truncate">{opt.label}</div>
                  {opt.sublabel && (
                    <div
                      className={`text-[10px] truncate ${
                        isSelected
                          ? "text-zinc-300 dark:text-zinc-600"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {opt.sublabel}
                    </div>
                  )}
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
