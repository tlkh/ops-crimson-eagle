/** A circular exclusion zone in world X/Z coordinates. */
export type CircularExclusionZone = { x: number; z: number; radius: number };

const DEFAULT_CELL_SIZE = 64;
const MAX_BUCKETS_PER_ZONE = 256;
const MAX_QUERY_BUCKETS = 256;

/**
 * Spatial broad phase for circular exclusion zones. Zones are indexed into the
 * cells touched by their bounds; each query then checks exact distances, so the
 * result matches `distance < radius + margin` without false positives.
 */
export class ExclusionLookup {
  private readonly zones: CircularExclusionZone[];
  private readonly buckets = new Map<number, Map<number, number[]>>();
  private readonly broadZones: number[] = [];
  private readonly visited: Uint32Array;
  private queryId = 0;

  constructor(zones: readonly CircularExclusionZone[], private readonly cellSize = DEFAULT_CELL_SIZE) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError('Exclusion lookup cell size must be a positive finite number');
    }

    // Snapshot the input so later mutations cannot make the index disagree with
    // the values used by the exact-distance check.
    this.zones = zones.map(zone => ({ x: zone.x, z: zone.z, radius: zone.radius }));
    this.visited = new Uint32Array(this.zones.length);

    for (let index = 0; index < this.zones.length; index++) {
      const zone = this.zones[index];
      if (!Number.isFinite(zone.x) || !Number.isFinite(zone.z) || Number.isNaN(zone.radius)) continue;
      if (!Number.isFinite(zone.radius)) {
        if (zone.radius > 0) this.broadZones.push(index);
        continue;
      }

      const radius = Math.max(0, zone.radius);
      const minX = Math.floor((zone.x - radius) / cellSize);
      const maxX = Math.floor((zone.x + radius) / cellSize);
      const minZ = Math.floor((zone.z - radius) / cellSize);
      const maxZ = Math.floor((zone.z + radius) / cellSize);
      const columns = maxX - minX + 1;
      const rows = maxZ - minZ + 1;
      if (!Number.isFinite(columns * rows) || columns * rows > MAX_BUCKETS_PER_ZONE) {
        this.broadZones.push(index);
        continue;
      }

      for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
        let row = this.buckets.get(x);
        if (!row) this.buckets.set(x, row = new Map());
        let bucket = row.get(z);
        if (!bucket) row.set(z, bucket = []);
        bucket.push(index);
      }
    }
  }

  /** Return whether any zone contains the point after expanding by `margin`. */
  contains(x: number, z: number, margin = 0): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (!Number.isFinite(margin)) {
      return this.zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin);
    }

    const reach = Math.max(0, margin);
    const minX = Math.floor((x - reach) / this.cellSize);
    const maxX = Math.floor((x + reach) / this.cellSize);
    const minZ = Math.floor((z - reach) / this.cellSize);
    const maxZ = Math.floor((z + reach) / this.cellSize);
    const columns = maxX - minX + 1;
    const rows = maxZ - minZ + 1;
    if (!Number.isFinite(columns * rows) || columns * rows > MAX_QUERY_BUCKETS) {
      return this.zones.some(zone => Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin);
    }

    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) {
      this.visited.fill(0);
      this.queryId = 1;
    }
    const queryId = this.queryId;
    const matches = (index: number) => {
      if (this.visited[index] === queryId) return false;
      this.visited[index] = queryId;
      const zone = this.zones[index];
      return Math.hypot(x - zone.x, z - zone.z) < zone.radius + margin;
    };

    for (const index of this.broadZones) if (matches(index)) return true;
    for (let cellX = minX; cellX <= maxX; cellX++) {
      const row = this.buckets.get(cellX);
      if (!row) continue;
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        const bucket = row.get(cellZ);
        if (bucket) for (const index of bucket) if (matches(index)) return true;
      }
    }
    return false;
  }
}
