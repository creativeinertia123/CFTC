export function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="flex items-end justify-center text-muted-foreground/40 text-[10px]">—</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "hsl(173 80% 40%)" : "hsl(0 72% 55%)";
  const last = values[values.length - 1];
  const lx = width;
  const ly = height - 2 - ((last - min) / range) * (height - 4);
  return (
    <svg width={width} height={height} role="img" aria-label="16-week net positioning sparkline" className="shrink-0">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="1.8" fill={stroke} />
    </svg>
  );
}
