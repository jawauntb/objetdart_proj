import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: "#071521",
        gold: "#D6A84A",
        merlot: "#7A1F2B",
        parchment: "#EFE5D0",
        bone: "#F7F1E6",
        teal: "#1F6F73",
        rose: "#D8A08E",
        orange: "#F27A2E",
        brass: "#B9883C",
        slate: "#101820",
        ash: "#7B7F80",
      },
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
