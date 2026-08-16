import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { initTheme } from "./theme";
import "./style.css";

// Prevent /settings from showing on startup (Vite HMR may preserve the URL)
if (window.location.pathname === "/settings") {
  window.history.replaceState({}, "", "/pr");
}

initTheme();

const app = createApp(App);

app.use(createPinia());
app.use(router);

app.mount("#app");
