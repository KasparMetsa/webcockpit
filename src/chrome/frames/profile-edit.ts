// Opens the profile editor (src/editor, a separate lazy chunk) for a stored
// profile. Shared by the start page's Profile → EDIT and the ESC menu's
// Profile row (Inv §4.5, §5.1). The chunk is imported here, on demand, so
// the chrome chunk never carries CodeMirror.

import type { ApplyResult } from '../../editor';
import type { ProfileStore } from '../../profiles';
import type { Nav } from '../kit/stack';

export type { ApplyResult } from '../../editor';

export interface EditOptions {
  /** A live session runs the profile (ESC menu while connected). */
  isLive: () => boolean;
  /** The live apply, when the app offers one; absent = save only. */
  apply?: ((text: string) => ApplyResult | Promise<ApplyResult>) | undefined;
  /** Runs before the stored text is read (flushes pending variable write-back). */
  beforeLoad?: (() => Promise<void>) | undefined;
  /** Called after the editor saved the profile. */
  onSaved?: ((name: string) => void) | undefined;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let loading = false;

/** Loads `name` and pushes the editor over the current frame (no-op while loading). */
export async function editProfile(nav: Nav, profiles: ProfileStore, name: string, opts: EditOptions): Promise<void> {
  if (loading) return;
  loading = true;
  const depth = nav.depth();
  try {
    await opts.beforeLoad?.();
    const [rec, mod] = await Promise.all([profiles.get(name), import('../../editor')]);
    if (!rec) return nav.flash(`No profile "${name}".`, 'fail');
    // The user moved on while the chunk loaded.
    if (nav.depth() !== depth) return;
    mod.openProfileEditor(nav, {
      name,
      text: rec.text,
      isLive: opts.isLive,
      save: async (text) => {
        await profiles.save(name, text);
        opts.onSaved?.(name);
      },
      ...(opts.apply ? { apply: opts.apply } : {}),
    });
  } catch (e) {
    nav.flash(`Could not open the editor: ${errText(e)}`, 'fail');
  } finally {
    loading = false;
  }
}
