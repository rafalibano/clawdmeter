export interface Sample {
  x: number;
  y: number;
}

export interface Line {
  slope: number;
  intercept: number;
}

export function linearRegression(samples: readonly Sample[]): Line | null {
  if (samples.length < 2) return null;
  const count = samples.length;
  const meanX = samples.reduce((sum, sample) => sum + sample.x, 0) / count;
  const meanY = samples.reduce((sum, sample) => sum + sample.y, 0) / count;
  let covariance = 0;
  let variance = 0;
  for (const sample of samples) {
    covariance += (sample.x - meanX) * (sample.y - meanY);
    variance += (sample.x - meanX) ** 2;
  }
  if (variance === 0) return null;
  const slope = covariance / variance;
  return { slope, intercept: meanY - slope * meanX };
}
