import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Remarks",
    description: "In-context feedback for websites.",
    permissions: ["storage", "activeTab", "tabs", "scripting"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "Remarks",
    },
  },
});
