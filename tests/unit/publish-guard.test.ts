import { describe, expect, it } from 'vitest';
import { versionGuard } from '../../scripts/publish-guard.ts';

describe('publish version guard (ADR 0025)', () => {
  it('allows a first publish and a new version', () => {
    expect(versionGuard(null, '0.1.0')).toBeNull();
    expect(versionGuard('0.1.0', '0.1.1')).toBeNull();
  });

  it('refuses the version that is already live, saying how to bump', () => {
    const msg = versionGuard('0.1.0', '0.1.0');
    expect(msg).toContain('0.1.0 is already live');
    expect(msg).toContain('npm version patch --no-git-tag-version');
  });
});
