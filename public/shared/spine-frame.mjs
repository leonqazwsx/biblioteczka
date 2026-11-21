export const DEFAULT_SPINE_FRAME = Object.freeze({ x: 50, y: 50, zoom: 1 });
export function normalizeSpineFrame(value) {
  if (value == null) return null;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    Object.keys(value).some((k) => !['x', 'y', 'zoom'].includes(k)) ||
    !Number.isFinite(value.x) ||
    value.x < 0 ||
    value.x > 100 ||
    !Number.isFinite(value.y) ||
    value.y < 0 ||
    value.y > 100 ||
    !Number.isFinite(value.zoom) ||
    value.zoom < 1 ||
    value.zoom > 3
  )
    throw new Error('Nieprawidłowy kadr ilustracji.');
  return value.x === 50 && value.y === 50 && value.zoom === 1
    ? null
    : { x: value.x, y: value.y, zoom: value.zoom };
}
export function effectiveSpineFrame(value) {
  try {
    return normalizeSpineFrame(value) ?? DEFAULT_SPINE_FRAME;
  } catch {
    return DEFAULT_SPINE_FRAME;
  }
}
