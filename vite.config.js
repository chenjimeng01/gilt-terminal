import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allow .jsx syntax inside files served from /src in dev.
  esbuild: { loader: "jsx", include: /src\/.*\.jsx?$/, exclude: [] },
});
