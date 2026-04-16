import type { ServerStatus } from '@shared/types';
import { getAutocadInstance, getProgId } from './connection';
import { safeGet } from './helpers';

const UNITS_MAP: Record<number, string> = {
  0: 'Unitless',
  1: 'Inches',
  2: 'Feet',
  3: 'Miles',
  4: 'Millimeters',
  5: 'Centimeters',
  6: 'Meters',
  7: 'Kilometers',
  8: 'Microinches',
  9: 'Mils',
  10: 'Yards',
  11: 'Angstroms',
  12: 'Nanometers',
  13: 'Microns',
  14: 'Decimeters',
  15: 'Dekameters',
  16: 'Hectometers',
  17: 'Gigameters',
  18: 'AU',
  19: 'LightYears',
  20: 'Parsecs',
};

/**
 * Read AutoCAD connection status and a short description of the active
 * drawing. Never throws — failures are reported on the result object so
 * the UI can render a "disconnected" state.
 */
export function getServerStatus(): ServerStatus {
  try {
    const { doc } = getAutocadInstance();
    const name = safeGet<string>(doc, 'Name', '<unnamed>');
    let units: string | undefined;
    try {
      // `InsUnits` is 0..20; map to a human-readable name.
      const insUnits = safeGet<number>(doc, 'InsUnits');
      if (typeof insUnits === 'number') {
        units = UNITS_MAP[insUnits] ?? `Unknown(${insUnits})`;
      }
    } catch {
      /* non-fatal */
    }
    return {
      connected: true,
      document: name,
      drawing_units: units,
      progid: getProgId(),
    };
  } catch (e) {
    return {
      connected: false,
      progid: getProgId(),
      error: (e as Error).message,
    };
  }
}
