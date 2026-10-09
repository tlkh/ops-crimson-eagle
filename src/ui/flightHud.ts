import type { Campaign, Mission, SimState } from '../types';
import type { ExtendedSimState } from '../sim/types';

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;
const cardinal = (degrees: number) => ({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' })[degrees];

function tapeMarkup(kind: 'speed' | 'altitude') {
  const right = kind === 'altitude';
  return `<div class="sf-instrument sf-instrument--${kind}" role="group" aria-label="${right ? 'Altitude and vertical speed' : 'Ground speed'}">
    <span class="sf-instrument-title">${right ? 'ALT' : 'G/S'} <small>${right ? 'M' : 'KM/H'}</small></span>
    <div class="sf-tape">
      <svg viewBox="0 0 86 184" class="sf-tape-scale" aria-hidden="true">
        <path class="sf-tape-rail" d="M${right ? 17 : 69} 0V184"/>
        ${Array.from({ length: 13 }, (_, i) => `<g data-${kind}-tick="${i}"><path/><text y="4"/></g>`).join('')}
      </svg>
      <div class="sf-tape-window"><b data-${kind}>000</b><span class="sf-sr-only">${right ? 'metres altitude' : 'kilometres per hour ground speed'}</span></div>
    </div>
    <div class="sf-instrument-foot">${right ? '<span>V/S</span><b data-vertical-speed>0.0</b><small>M/S</small>' : '<span data-speed-state>STATIONARY</span>'}</div>
  </div>`;
}

/** Flight instruments remain anchored to the viewport, around the clear chase view. */
export function createFlightHud(host: HTMLElement) {
  host.className = 'sf-flight-hud';
  host.innerHTML = `
    <div class="sf-compass" role="group" aria-label="Heading and objective bearing">
      <div class="sf-compass-readout"><span>HDG</span><b data-heading>000</b><span>°</span></div>
      <svg class="sf-compass-scale" viewBox="0 0 360 58" aria-hidden="true">
        <path class="sf-compass-baseline" d="M0 18H360"/>
        ${Array.from({ length: 17 }, (_, i) => `<g data-heading-tick="${i}"><path/><text y="49" text-anchor="middle"/></g>`).join('')}
        <path class="sf-heading-caret" d="M174 5L180 13L186 5"/>
        <g data-bearing-bug><path d="M0 11L5 18L0 25L-5 18Z"/></g>
      </svg>
      <div class="sf-compass-target"><span class="sf-target-diamond" aria-hidden="true"></span><span data-guidance>Objective</span></div>
    </div>
    ${tapeMarkup('speed')}${tapeMarkup('altitude')}
    <div class="sf-sortie-strip" aria-label="Elapsed mission time and useful drops">
      <span><small>FLIGHT TIME</small><b data-time>0:00</b></span>
      <span><small>USEFUL DROPS</small><b data-drops>0 / 0</b></span>
    </div>
    <div class="sf-payload-instrument" role="group" aria-label="Bucket status">
      <span class="sf-instrument-title">SLING LOAD</span>
      <div class="sf-payload-value"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v5M5 9l7-2 7 2-2 12H7Z"/><path d="M5 9h14"/></svg><b data-water>0 L</b></div>
      <span class="sf-payload-position" data-bucket-cue><span data-sling>Stowed</span></span>
    </div>
    <div class="sf-fuel-instrument" data-fuel-status="normal" role="group" aria-label="Fuel quantity and predicted landing fuel">
      <div class="sf-fuel-heading"><span class="sf-instrument-title">FUEL</span><b data-fuel>3,100 <small>KG</small></b></div>
      <div class="sf-fuel-gauge" role="meter" aria-label="Fuel remaining" aria-valuemin="0" aria-valuemax="3100" aria-valuenow="3100" data-fuel-meter>
        ${Array.from({ length: 12 }, () => '<i></i>').join('')}
      </div>
      <div class="sf-fuel-return"><span>AT LANDING</span><b data-reserve>—</b></div>
      <span class="sf-fuel-advisory" data-fuel-advisory hidden>RETURN FUEL LOW</span>
    </div>`;
  const by = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
  const speedTicks = [...host.querySelectorAll<SVGGElement>('[data-speed-tick]')];
  const altitudeTicks = [...host.querySelectorAll<SVGGElement>('[data-altitude-tick]')];
  const headingTicks = [...host.querySelectorAll<SVGGElement>('[data-heading-tick]')];
  const fuelSegments = [...host.querySelectorAll<HTMLElement>('[data-fuel-meter] i')];
  const headingNode = by('[data-heading]'), speedNode = by('[data-speed]'), altitudeNode = by('[data-altitude]');
  const verticalNode = by('[data-vertical-speed]'), speedState = by('[data-speed-state]');
  const fuelNode = by('[data-fuel]'), fuelMeter = by('[data-fuel-meter]');
  const fuelGroup = by<HTMLElement>('[data-fuel-status]'), advisory = by<HTMLElement>('[data-fuel-advisory]');
  const bearingBug = by<SVGGElement>('[data-bearing-bug]');
  const timeNode = by('[data-time]'), dropsNode = by('[data-drops]');

  function updateTape(ticks: SVGGElement[], value: number, step: number, right: boolean) {
    const base = Math.floor(value / step) * step;
    ticks.forEach((tick, i) => {
      const number = base + (i - 6) * step, y = 92 + (value - number) / step * 24;
      tick.style.display = number < 0 || y < 0 || y > 184 ? 'none' : '';
      tick.setAttribute('transform', `translate(0 ${y.toFixed(2)})`);
      const major = Math.round(number / step) % 2 === 0;
      tick.querySelector('path')!.setAttribute('d', right ? `M17 0h${major ? 13 : 6}` : `M69 0h-${major ? 13 : 6}`);
      const text = tick.querySelector('text')!;
      text.setAttribute('x', right ? '37' : '48');
      text.setAttribute('text-anchor', right ? 'start' : 'end');
      text.textContent = major ? String(Math.round(number)) : '';
    });
  }

  return {
    update(state: SimState, campaign: Campaign, mission: Mission, landingFuel: number) {
      // Positive Three.js yaw turns left; convert it to clockwise compass degrees.
      const heading = wrap(-state.heading * 180 / Math.PI);
      headingNode.textContent = String(Math.round(heading) % 360).padStart(3, '0');
      const base = Math.floor(heading / 10) * 10;
      headingTicks.forEach((tick, i) => {
        const value = base + (i - 8) * 10, x = 180 + (value - heading) * 3;
        tick.setAttribute('transform', `translate(${x.toFixed(2)} 0)`);
        tick.style.display = x < 0 || x > 360 ? 'none' : '';
        const normalized = wrap(value), major = normalized % 30 === 0;
        tick.querySelector('path')!.setAttribute('d', `M0 18v${major ? 12 : 6}`);
        const label = cardinal(normalized);
        tick.querySelector('text')!.textContent = x < 14 || x > 346 ? '' : label ?? (major ? String(normalized / 10).padStart(2, '0') : '');
        tick.classList.toggle('is-cardinal', !!label);
      });
      const guidance = (state as ExtendedSimState).guidance;
      if (guidance) {
        const bearing = wrap(Math.atan2(guidance.target.x - state.position.x, state.position.z - guidance.target.z) * 180 / Math.PI);
        const delta = wrap(bearing - heading + 180) - 180;
        bearingBug.setAttribute('transform', `translate(${180 + clamp(delta, -58, 58) * 3} 0)`);
        bearingBug.classList.toggle('is-off-scale', Math.abs(delta) > 58);
      }
      bearingBug.style.display = guidance && guidance.distanceM > 2 ? '' : 'none';
      const speed = Math.hypot(state.velocity.x, state.velocity.z) * 3.6;
      const altitude = Math.max(0, state.position.y);
      speedNode.textContent = String(Math.round(speed)).padStart(3, '0');
      altitudeNode.textContent = String(Math.round(altitude)).padStart(3, '0');
      updateTape(speedTicks, speed, 10, false); updateTape(altitudeTicks, altitude, 5, true);
      speedState.textContent = speed < 1 ? 'STATIONARY' : 'GROUND SPEED';
      const vertical = Math.abs(state.velocity.y) < .05 ? 0 : state.velocity.y;
      verticalNode.textContent = `${vertical > 0 ? '+' : ''}${vertical.toFixed(1)}`;
      timeNode.textContent = `${Math.floor(state.timeSec / 60)}:${String(Math.floor(state.timeSec % 60)).padStart(2, '0')}`;
      dropsNode.textContent = `${state.dropsCompleted} / ${mission.requiredDrops}`;
      fuelNode.innerHTML = `${Math.max(0, Math.round(state.fuelKg)).toLocaleString()} <small>KG</small>`;
      fuelMeter.setAttribute('aria-valuemax', String(campaign.mass.fuel));
      fuelMeter.setAttribute('aria-valuenow', String(Math.max(0, Math.round(state.fuelKg))));
      fuelMeter.setAttribute('aria-valuetext', `${Math.round(state.fuelKg)} kilograms remaining`);
      const fill = clamp(state.fuelKg / campaign.mass.fuel, 0, 1) * fuelSegments.length;
      fuelSegments.forEach((segment, i) => segment.classList.toggle('is-filled', i < Math.ceil(fill)));
      const critical = state.fuelKg < 250, caution = landingFuel < 500;
      fuelGroup.dataset.fuelStatus = critical ? 'critical' : caution ? 'caution' : 'normal';
      advisory.hidden = !critical && !caution;
      advisory.textContent = critical ? 'FUEL CRITICAL' : 'RETURN FUEL LOW';
    },
  };
}
