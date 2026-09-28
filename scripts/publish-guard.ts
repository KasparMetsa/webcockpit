// The version rule of `npm run publish` (ADR 0025): every publish carries a
// new package.json version, so a running tab can tell that the live site
// changed. Kept apart from scripts/publish.ts (which runs on import) so it
// can be unit tested.

/**
 * Why `version` may not be published over the live release `liveVersion`
 * (null = no live release), or null when it may.
 */
export function versionGuard(liveVersion: string | null, version: string): string | null {
  if (liveVersion === null || liveVersion !== version) return null;
  return (
    `version ${version} is already live. Bump it and commit first, e.g.\n` +
    `  npm version patch --no-git-tag-version && git commit -am "chore: release <new version>"`
  );
}
