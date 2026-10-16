import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// React Testing Library cleanup between tests (globals are disabled).
afterEach(() => {
  cleanup()
})

// jsdom doesn't implement scrollTo (used when paging); stub it out.
Object.defineProperty(window, 'scrollTo', {
  value: vi.fn(),
  writable: true,
})
