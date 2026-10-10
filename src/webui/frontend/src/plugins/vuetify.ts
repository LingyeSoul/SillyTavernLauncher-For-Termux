/**
 * Vuetify 4 实例 — Forge 工作台主题（SoulDesign design-tokens.md 实证数值）。
 * v4 断点默认收窄，显式恢复 md=960 的工作台惯例。
 */
import { createVuetify } from "vuetify";
import { aliases, mdi } from "vuetify/iconsets/mdi-svg";

export default createVuetify({
  display: { thresholds: { md: 960 } },
  theme: {
    defaultTheme: "dark",
    themes: {
      dark: {
        dark: true,
        colors: {
          background: "#141618",
          surface: "#1C1F22",
          "surface-bright": "#272B2F",
          "surface-variant": "#34393E",
          outline: "#42484E",
          "outline-variant": "#2A2E33",
          primary: "#EBA375",
          "on-primary": "#251C16",
          secondary: "#88BDB5",
          "on-secondary": "#152522",
          info: "#91B9EA",
          warning: "#E3BC75",
          error: "#F18C96",
          success: "#89C5A2",
          "on-surface": "#EEF0F2",
          "on-surface-variant": "#A8AFB6",
        },
        variables: {
          "high-emphasis-opacity": 0.92,
          "medium-emphasis-opacity": 0.64,
          "disabled-opacity": 0.32,
          "border-opacity": 0.18,
        },
      },
    },
  },
  icons: { defaultSet: "mdi", aliases, sets: { mdi } },
  defaults: {
    global: { ripple: false },
    VTextField: { variant: "outlined", density: "compact" },
    VSelect: { variant: "outlined", density: "compact" },
    VTextarea: { variant: "outlined", density: "compact" },
    VSwitch: { color: "primary", density: "compact" },
    VBtn: { variant: "flat", rounded: "sm" },
    VCard: { elevation: 0, rounded: "sm" },
    VChip: { size: "small", variant: "tonal" },
    VAlert: { variant: "tonal", density: "compact" },
    VCheckbox: { density: "compact", color: "primary" },
    VTooltip: { openDelay: 350 },
  },
});
