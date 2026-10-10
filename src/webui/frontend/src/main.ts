import { createApp } from "vue";
import vuetify from "./plugins/vuetify";
import App from "./App.vue";

/* Geist latin 400/500/600/700 + JetBrains Mono 400/500/600（CJK 走系统回退，不打包中文字库） */
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";

import "vuetify/styles";
import "./styles/main.css";

createApp(App).use(vuetify).mount("#app");
