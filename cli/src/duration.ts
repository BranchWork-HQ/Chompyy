/** Parse "1h", "30m", "1h30m", "45s" or a bare number of minutes into milliseconds. */
export function parseDuration(text: string): number {
  const s = text.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(s)) return checked(Number(s) * 60_000, text);
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let ms = 0;
  let consumed = '';
  for (const m of s.matchAll(re)) {
    const n = Number(m[1]);
    ms += m[2] === 'h' ? n * 3_600_000 : m[2] === 'm' ? n * 60_000 : n * 1000;
    consumed += m[0];
  }
  if (consumed.replace(/\s/g, '') !== s.replace(/\s/g, '')) throw new Error(`Can't read duration "${text}". Try 1h, 30m or 1h30m.`);
  return checked(ms, text);
}

function checked(ms: number, text: string): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Duration must be more than zero: "${text}"`);
  return Math.round(ms);
}

/** 6000000 → "1h40m", 2400000 → "40m", 30000 → "<1m". */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return '<1m';
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, '0')}m` : `${h}h`;
  return `${m}m`;
}
