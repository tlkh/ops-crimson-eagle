import { describe, expect, it } from 'vitest';
import { flightOverlayShortcut, nextFlightOverlay, type FlightOverlay } from './flightOverlay';

describe('flight overlay transitions', () => {
  it('keeps map, pause and flight mutually exclusive across mixed button and key actions', () => {
    const actions = ['map', 'escape', 'togglePause', 'map', 'map', 'togglePause', 'resume'] as const;
    const states = actions.reduce<FlightOverlay[]>((history, action) => {
      history.push(nextFlightOverlay(history.at(-1)!, action));
      return history;
    }, ['flight']);
    expect(states).toEqual(['flight', 'map', 'flight', 'pause', 'map', 'flight', 'pause', 'flight']);
  });

  it('holds an interrupted flight or map in pause until explicitly resumed', () => {
    expect(nextFlightOverlay('flight', 'interrupt')).toBe('pause');
    expect(nextFlightOverlay('map', 'interrupt')).toBe('pause');
    expect(nextFlightOverlay('pause', 'interrupt')).toBe('pause');
    expect(nextFlightOverlay('pause', 'launch')).toBe('flight');
  });

  it('routes map and Escape shortcuts without taking letters from a focused select or input', () => {
    expect(flightOverlayShortcut('m', false)).toBe('map');
    expect(flightOverlayShortcut('m', true)).toBeNull();
    expect(flightOverlayShortcut('escape', true)).toBe('escape');
    expect(flightOverlayShortcut('m', false, true)).toBeNull();
    expect(flightOverlayShortcut('escape', false, true)).toBeNull();
    expect(flightOverlayShortcut('e', false)).toBeNull();
  });
});
