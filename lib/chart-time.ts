interface TimedSample { capturedAt?: string; intervalSeconds?: number; gapBefore?: boolean }

export function chartTime(data: TimedSample[]) {
  const parsed = data.map((item) => Date.parse(item.capturedAt ?? ""));
  const timed = parsed.every(Number.isFinite);
  const times = timed ? parsed : data.map((_, index) => index);
  const first = times[0] ?? 0;
  const span = (times[times.length - 1] ?? first) - first;
  const ratios = times.map((time) => span > 0 ? (time - first) / span : 0.5);
  const deltas = times.slice(1).map((time, index) => time - times[index]).filter((delta) => delta > 0);
  const inferred = deltas.length ? Math.min(...deltas) : Infinity;
  const groups: number[][] = [];
  data.forEach((item, index) => {
    const expected = timed && item.intervalSeconds ? item.intervalSeconds * 1000 : inferred;
    if (!index || item.gapBefore || timed && (times[index] <= times[index - 1] || times[index] - times[index - 1] > expected * 1.5)) groups.push([]);
    groups[groups.length - 1].push(index);
  });
  const nearest = (ratio: number) => ratios.reduce((best, value, index) => Math.abs(value - ratio) < Math.abs(ratios[best] - ratio) ? index : best, 0);
  return { ratios, groups, nearest };
}
