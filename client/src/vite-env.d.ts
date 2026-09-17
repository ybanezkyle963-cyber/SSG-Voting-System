/// <reference types="vite/client" />

/**
 * Injected at build time by `vite.config.ts`. Holds the commit the build came
 * from when the host provides one, and is the empty string otherwise — which is
 * how the footer knows to stay quiet on a local build.
 */
declare const __BUILD_COMMIT__: string
