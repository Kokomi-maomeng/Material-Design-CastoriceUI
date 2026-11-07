/** Bounded cubic interpolation shared by the traffic and network charts. */
export function smoothChartPath(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => {
    if (!index) return `M ${x},${y}`;
    const [previousX, previousY] = points[index - 1];
    const middle = (previousX + x) / 2;
    return `C ${middle},${previousY} ${middle},${y} ${x},${y}`;
  }).join(" ");
}
