import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Vitest picks up the same plugin pipeline as the app build so JSX/TSX tests
// compile identically to production code.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
