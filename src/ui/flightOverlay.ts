export type FlightOverlay = 'flight' | 'map' | 'pause';
export type FlightOverlayAction = 'map' | 'togglePause' | 'resume' | 'escape' | 'interrupt' | 'launch';

/** Text and native selection controls keep their letter keys. */
export function flightOverlayShortcut(key: string, focusedInput: boolean, repeat = false): 'map' | 'escape' | null {
  if (repeat) return null;
  if (key === 'escape') return 'escape';
  if (key === 'm' && !focusedInput) return 'map';
  return null;
}

/** The app owns overlay transitions so button and keyboard paths share one result. */
export function nextFlightOverlay(current: FlightOverlay, action: FlightOverlayAction): FlightOverlay {
  switch (action) {
    case 'map': return current === 'map' ? 'flight' : 'map';
    case 'togglePause': return current === 'pause' ? 'flight' : 'pause';
    case 'resume':
    case 'launch': return 'flight';
    case 'escape': return current === 'flight' ? 'pause' : 'flight';
    case 'interrupt': return 'pause';
  }
}
