/**
 * Feature computation for one (market, trader category) series, ordered by
 * report date ascending.
 *
 * All analytics are derived from the loaded series — nothing is hardcoded
 * per market. Rolling statistics use expanding windows with minimum
 * observation guards, so early (noisy) values come back null rather than
 * pretending to significance; past rows are immutable once written, which
 * keeps incremental ingestion cheap.
 */

export interface SeriesPoint {
  long: number;
  short: number;
  openInterest: number;
}

export interface ComputedFeatures {
  percentile: number | null;
  percentileLong: number | null;
  percentileShort: number | null;
  zscore: number | null;
  wmaDev: number | null;
  wowChange: number | null;
  oiShare: number;
  momentum2: number | null;
  momentum4: number | null;
  momentum8: number | null;
  momentum16: number | null;
  longShortRatio: number | null;
  boundedNet: number;
  crowding: boolean;
}

const MIN_OBS = 20; // expanding-window guard
const LWMA_WINDOW = 26; // linearly weighted moving average horizon

function percentileRank(window: number[], current: number): number {
  let below = 0;
  let equal = 0;
  for (const v of window) {
    if (v < current) below++;
    else if (v === current) equal++;
  }
  return ((below + 0.5 * equal) / window.length) * 100;
}

export function computeFeatures(series: SeriesPoint[]): ComputedFeatures[] {
  const out: ComputedFeatures[] = [];
  const nets: number[] = [];
  const longs: number[] = [];
  const shorts: number[] = [];
  let sum = 0;
  let sumSq = 0;

  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    const net = p.long - p.short;

    const prev = i > 0 ? series[i - 1] : null;
    const wowChange = prev ? net - (prev.long - prev.short) : null;

    nets.push(net);
    longs.push(p.long);
    shorts.push(p.short);
    sum += net;
    sumSq += net * net;

    const n = i + 1;
    let percentile: number | null = null;
    let percentileLong: number | null = null;
    let percentileShort: number | null = null;
    let zscore: number | null = null;
    if (n >= MIN_OBS) {
      percentile = percentileRank(nets, net);
      percentileLong = percentileRank(longs, p.long);
      percentileShort = percentileRank(shorts, p.short);
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      const std = Math.sqrt(variance);
      zscore = std > 0 ? (net - mean) / std : 0;
    }

    // Linearly weighted moving average over the available tail of the window.
    const wCount = Math.min(n, LWMA_WINDOW);
    let wSum = 0;
    let wDenom = 0;
    for (let k = 0; k < wCount; k++) {
      const weight = wCount - k;
      wSum += nets[i - k] * weight;
      wDenom += weight;
    }
    const wma = wDenom > 0 ? wSum / wDenom : null;
    const wmaDev = wma !== null && wma !== 0 ? ((net - wma) / Math.abs(wma)) * 100 : null;

    const momentum = (lag: number): number | null =>
      i >= lag ? net - nets[i - lag] : null;

    const longShortRatio = p.short !== 0 ? p.long / p.short : null;
    const boundedNet = Math.tanh(p.openInterest > 0 ? (3 * net) / p.openInterest : 0);
    const crowding = percentile !== null && (percentile >= 90 || percentile <= 10);

    out.push({
      percentile,
      percentileLong,
      percentileShort,
      zscore,
      wmaDev,
      wowChange,
      oiShare: p.openInterest > 0 ? (net / p.openInterest) * 100 : 0,
      momentum2: momentum(2),
      momentum4: momentum(4),
      momentum8: momentum(8),
      momentum16: momentum(16),
      longShortRatio,
      boundedNet,
      crowding,
    });
  }
  return out;
}
