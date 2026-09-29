export function floodRamp(L) {
  return ['interpolate', ['linear'], ['elevation'], L - 1, 'rgba(38,112,196,0.78)', L, 'rgba(38,112,196,0)', L + 1, 'rgba(0,0,0,0)'];
}

// «Ледниковый период»: дно между L и 0 становится сушей.
export function iceRamp(L) {
  if (L >= 0) return 'rgba(0,0,0,0)';
  return ['interpolate', ['linear'], ['elevation'],
    L - 1, 'rgba(0,0,0,0)', L, 'rgba(222,196,140,0.92)', Math.max(L / 2, -1), 'rgba(222,196,140,0.92)', 0, 'rgba(0,0,0,0)'];
}

