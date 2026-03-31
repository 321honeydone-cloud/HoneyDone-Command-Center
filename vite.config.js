import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/HoneyDone-Command-Center/",
  server: {
    proxy: {
      "/api/jobber": "http://localhost:8787"
    }
  }
});
