import { defineConfig } from "vitest/config"
import { gui } from "@opencode/plugin/gui/vite"

// Builds the GUI half (src/gui.tsx) into dist/gui-experimental.cjs, keeping the
// host's own modules (solid, the app runtime) external so the bundle shares them.
export default defineConfig({
  plugins: [gui()],
  test: {
    // .backups/ holds automatic snapshots that must not run as duplicate suites
    exclude: ["**/node_modules/**", "**/dist/**", ".backups/**"],
  },
})
