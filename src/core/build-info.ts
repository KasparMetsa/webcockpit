// What build is running (ADR 0025). Both values are injected by Vite /
// Vitest `define`:
//
//   __WC_VERSION__  package.json `version` (semver, bumped for every publish)
//   __WC_COMMIT__   the git short commit at build time; `dev` in the dev
//                   server, in tests and when git is unavailable
//
// Absent when src/ runs outside Vite.

declare const __WC_VERSION__: string | undefined;
declare const __WC_COMMIT__: string | undefined;

/** The client version (Core.Hello, About, the update check). */
export const CLIENT_VERSION: string = typeof __WC_VERSION__ === 'string' ? __WC_VERSION__ : '0.0.0-dev';

/** The git short commit of the build, or `dev`. */
export const CLIENT_COMMIT: string = typeof __WC_COMMIT__ === 'string' && __WC_COMMIT__ ? __WC_COMMIT__ : 'dev';
