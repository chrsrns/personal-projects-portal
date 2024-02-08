/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./**/*.{html,js}"],
  theme: {
    extend: {
      animation: {
        "octocat-wave": "octocat-wave 560ms ease-in-out",
      },
      keyframes: {
        "octocat-wave": {
          "0%, 100%": {
            transform: "rotate(0)",
          },
          "20%, 60%": {
            transform: "rotate(-25deg)",
          },
          "40%, 80%": {
            transform: "rotate(10deg)",
          },
        },
      },
    },
  },
  plugins: [],
};
