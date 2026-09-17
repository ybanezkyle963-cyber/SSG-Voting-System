/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#f2f4f1",
        "paper-2": "#e7ebe6",
        ink: "#17211b",
        "ink-60": "#5b665f",
        rule: "#c9d1c8",
        pine: "#2f5d50",
        gold: "#e8b33a",
        seal: "#b3371f",
      },
      fontFamily: {
        serif: [
          "Charter",
          '"Bitstream Charter"',
          '"Iowan Old Style"',
          '"Palatino Linotype"',
          "Georgia",
          '"Times New Roman"',
          "serif",
        ],
      },
    },
  },
  plugins: [],
}

