export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      spacing: {
        "0.2": "0.05rem",
        "6.5": "1.625rem",
        "7.5": "1.875rem",
        "8.5": "2.125rem",
      },
      boxShadow: {
        "2xs": "0 1px 2px 0 rgba(9, 9, 11, 0.05)",
      },
      backdropBlur: {
        xs: "2px",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "Consolas",
          "ui-monospace",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
