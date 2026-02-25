export interface MarketDataResult {
  [symbol: string]: {
    [metric: string]: unknown;
  };
}
