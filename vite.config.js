import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/@firebase/auth/")) return "firebase-auth";
          if (id.includes("/node_modules/@firebase/firestore/")) return "firebase-firestore";
          if (id.includes("/node_modules/@firebase/")) return "firebase-core";
        }
      }
    }
  }
});
