import "@testing-library/jest-dom/vitest"
import { cleanup, configure } from "@testing-library/react"
import { afterEach, vi } from "vitest"

afterEach(() => {
  cleanup()
})

// The first test in a file renders its screen cold (lazy route chunks load
// on first use), which can take just over Testing Library's 1 s default on
// shared CI runners. A longer ceiling removes that flake; passing tests
// still finish as soon as the element appears.
configure({ asyncUtilTimeout: 5000 })

// jsdom lacks the layout APIs Radix and the sidebar hooks touch.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverStub,
  })
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// The router scrolls to the top on navigation; jsdom does not implement it.
window.scrollTo = () => {}
