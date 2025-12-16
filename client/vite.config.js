import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Force polling to ensure file changes are detected on all systems
    watch: {
      usePolling: true,
      interval: 100, // Check every 100ms
    },
    // Ensure HMR is active
    hmr: {
      overlay: true,
    },
    host: true, // Listen on all IPs
    port: 5173, // Default port
    strictPort: false, // Continue to next port if busy (though we killed others)
  }
})
