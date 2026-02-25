import { PortfolioPosition } from '@ghostfolio/common/interfaces';
import { PortfolioPerformance } from '@ghostfolio/common/interfaces';

export interface PortfolioAnalysisResult {
  allocation: { [symbol: string]: number };
  holdings: PortfolioPosition[];
  performance: PortfolioPerformance;
}
