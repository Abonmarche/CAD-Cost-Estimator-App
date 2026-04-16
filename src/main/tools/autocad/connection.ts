/**
 * AutoCAD COM connection management.
 *
 * Mirrors the connection chain in the Python `utils.py`:
 *   1. Try to attach to a running AutoCAD via the versioned ProgID
 *   2. Fall back to dispatching a new instance
 *
 * Unlike the Python version, we CACHE the proxy across calls. Creating the
 * COM proxy is cheap but reattaching after every tool call would wipe out
 * any state we want to keep (e.g. the currently active document).
 */

import { DEFAULT_AUTOCAD_PROGID } from '@shared/constants';

// winax is a native module and must be loaded lazily so that the Electron
// build doesn't crash if the addon hasn't been rebuilt yet — the error is
// surfaced via server_status instead.
type WinaxObjectCtor = new (
  progid: string,
  opts?: { activate?: boolean },
) => unknown;
interface WinaxModule {
  Object: WinaxObjectCtor;
}

let winaxModule: WinaxModule | null = null;
let winaxLoadError: Error | null = null;

function loadWinax(): WinaxModule {
  if (winaxModule) return winaxModule;
  if (winaxLoadError) throw winaxLoadError;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    winaxModule = require('winax') as WinaxModule;
    return winaxModule;
  } catch (e) {
    winaxLoadError =
      e instanceof Error
        ? e
        : new Error(`winax failed to load: ${String(e)}`);
    throw winaxLoadError;
  }
}

/**
 * The cached AutoCAD connection. We hold on to the Application proxy and
 * re-fetch ActiveDocument on each access so we track document switches.
 */
interface AcadConnection {
  app: Record<string, unknown>;
}

let cached: AcadConnection | null = null;

function getProgId(): string {
  return process.env.AUTOCAD_PROGID || DEFAULT_AUTOCAD_PROGID;
}

/**
 * Connect to a running AutoCAD instance (or launch one if necessary).
 * Throws if the ProgID is not registered (AutoCAD not installed) or if the
 * COM call fails for any other reason.
 */
export function getAutocadInstance(): {
  app: Record<string, unknown>;
  doc: Record<string, unknown>;
  modelspace: Record<string, unknown>;
} {
  const winax = loadWinax();
  const progid = getProgId();

  if (cached) {
    // Verify the proxy is still alive — touching a property will throw if
    // the underlying AutoCAD process is gone.
    try {
      void (cached.app as { Name?: unknown }).Name;
    } catch {
      cached = null;
    }
  }

  if (!cached) {
    let app: Record<string, unknown>;
    try {
      // `activate: true` attaches to an existing running instance when one
      // is available and dispatches a new one otherwise.
      app = new winax.Object(progid, { activate: true }) as Record<
        string,
        unknown
      >;
    } catch (e) {
      throw new Error(
        `Cannot connect to AutoCAD (${progid}): ${(e as Error).message}. ` +
          `Is AutoCAD 2024 installed and running?`,
      );
    }

    // Make sure the window is visible — otherwise users won't notice we
    // attached to a background instance.
    try {
      (app as { Visible?: boolean }).Visible = true;
    } catch {
      /* non-fatal */
    }

    cached = { app };
  }

  const doc = (cached.app as { ActiveDocument?: Record<string, unknown> })
    .ActiveDocument;
  if (!doc) {
    throw new Error(
      'AutoCAD is running but no drawing is open. Open a drawing and try again.',
    );
  }
  const modelspace = (doc as { ModelSpace?: Record<string, unknown> })
    .ModelSpace;
  if (!modelspace) {
    throw new Error('Could not access the drawing ModelSpace.');
  }

  return { app: cached.app, doc, modelspace };
}

/**
 * Drop the cached connection. Call this if we detect the AutoCAD process
 * has gone away or the user wants to reconnect.
 */
export function resetConnection(): void {
  cached = null;
}

/**
 * `true` if we've got a live, responsive AutoCAD connection. Does not throw.
 */
export function isAutocadConnected(): boolean {
  try {
    getAutocadInstance();
    return true;
  } catch {
    return false;
  }
}

/**
 * Iterate a COM collection/ModelSpace by index. winax exposes `Count`
 * and `Item(i)` the same way VBA does.
 *
 * This is a generator so callers can bail out early (e.g. once a specific
 * layer's entities have been collected).
 *
 * ⚠ winax's COM method proxies are NOT regular JS functions — they report
 * `typeof === 'function'` but lack `.call` / `.apply`. You MUST invoke them
 * on the original object (`collection.Item(i)`); detaching them breaks.
 */
export function* iterateCollection<T = unknown>(
  collection: Record<string, unknown>,
): Generator<T> {
  const count = (collection as { Count?: number }).Count ?? 0;
  const c = collection as { Item: (i: number) => unknown };
  for (let i = 0; i < count; i++) {
    try {
      yield c.Item(i) as T;
    } catch {
      // Skip individual items that fail to marshal — usually anonymous
      // helper entities (hatch boundary seeds, xref definitions, etc.)
      continue;
    }
  }
}

export { getProgId };
