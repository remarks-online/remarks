import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Remarks",
    description: "In-context feedback for websites.",
    permissions: ["storage", "activeTab", "tabs", "scripting", "cookies"],
    host_permissions: [
      "<all_urls>",
      "http://localhost/*",
      "https://*.clerk.accounts.dev/*",
    ],
    action: {
      default_title: "Remarks",
    },
  },
});
