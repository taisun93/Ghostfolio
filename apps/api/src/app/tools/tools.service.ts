import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { UNKNOWN_KEY } from '@ghostfolio/common/config';
import { AssetProfileIdentifier } from '@ghostfolio/common/interfaces';
import { DataSource } from '@prisma/client';

import { Injectable } from '@nestjs/common';
import { groupBy } from 'lodash';

import { ComplianceCheckResult } from './interfaces/compliance-check.interface';
import { MarketDataResult } from './interfaces/market-data.interface';
import { PortfolioAnalysisResult } from './interfaces/portfolio-analysis.interface';
import {
  TransactionCategorizeResult,
  TransactionForCategorize,
  TransactionPattern
} from './interfaces/transaction-categorize.interface';
import { TaxEstimateResult } from './interfaces/tax-estimate.interface';

const DEFAULT_DATA_SOURCE = DataSource.YAHOO;

/** Simple marginal tax brackets (US-style example; override per jurisdiction later). */
const DEFAULT_TAX_BRACKETS = [
  { max: 11_000, rate: 0.1 },
  { max: 44_725, rate: 0.12 },
  { max: 95_375, rate: 0.22 },
  { max: 182_100, rate: 0.24 },
  { max: 231_250, rate: 0.32 },
  { max: 578_125, rate: 0.35 },
  { max: Infinity, rate: 0.37 }
];

@Injectable()
export class ToolsService {
  public constructor(
    private readonly apiService: ApiService,
    private readonly dataProviderService: DataProviderService,
    private readonly portfolioService: PortfolioService
  ) {}

  /**
   * portfolio_analysis(account_id) → holdings, allocation, performance
   */
  public async portfolioAnalysis({
    accountId,
    dateRange = 'max',
    impersonationId,
    userId
  }: {
    accountId: string;
    dateRange?: '1d' | '5d' | '1m' | '1y' | '5y' | 'max';
    impersonationId?: string;
    userId: string;
  }): Promise<PortfolioAnalysisResult> {
    const filters = this.apiService.buildFiltersFromQueryParams({
      filterByAccounts: accountId
    });

    const [details, performanceResponse] = await Promise.all([
      this.portfolioService.getDetails({
        dateRange,
        filters,
        impersonationId: impersonationId ?? '',
        userId,
        withSummary: true
      }),
      this.portfolioService.getPerformance({
        dateRange,
        filters,
        impersonationId: impersonationId ?? '',
        userId
      })
    ]);

    const holdings = Object.values(details.holdings);
    const allocation: { [symbol: string]: number } = {};
    for (const h of holdings) {
      allocation[h.symbol] = h.allocationInPercentage ?? 0;
    }
    if (details.summary?.currentValueInBaseCurrency === 0 && holdings.length === 0) {
      allocation[UNKNOWN_KEY] = 0;
    }

    return {
      allocation,
      holdings,
      performance: performanceResponse.performance
    };
  }

  /**
   * transaction_categorize(transactions[]) → categories, patterns
   */
  public transactionCategorize(
    transactions: TransactionForCategorize[]
  ): TransactionCategorizeResult {
    const categories: TransactionCategorizeResult['categories'] = [];
    const patterns: TransactionPattern[] = [];

    const byType = groupBy(transactions, (t) => t.type ?? 'UNKNOWN');
    for (const [type, list] of Object.entries(byType)) {
      categories.push({
        category: type,
        count: list.length,
        transactionIds: list.map((t) => t.id ?? '').filter(Boolean)
      });
    }

    const byTag = new Map<string, string[]>();
    for (const t of transactions) {
      const tags = t.tags ?? [];
      if (tags.length === 0) {
        const key = '_untagged';
        if (!byTag.has(key)) byTag.set(key, []);
        if (t.id) byTag.get(key)!.push(t.id);
      } else {
        for (const tag of tags) {
          if (!byTag.has(tag)) byTag.set(tag, []);
          if (t.id) byTag.get(tag)!.push(t.id);
        }
      }
    }
    for (const [tag, ids] of byTag) {
      categories.push({
        category: tag === '_untagged' ? 'untagged' : `tag:${tag}`,
        count: ids.length,
        transactionIds: ids
      });
    }

    const amounts = transactions
      .map((t) => t.amount ?? 0)
      .filter((a) => a !== 0);
    if (amounts.length > 0) {
      const sum = amounts.reduce((s, a) => s + Math.abs(a), 0);
      const avg = sum / amounts.length;
      patterns.push({
        type: 'amount_band',
        description: 'Average absolute transaction amount',
        value: { average: avg, count: amounts.length, total: sum }
      });
    }

    const typeDistribution = Object.fromEntries(
      Object.entries(byType).map(([k, v]) => [k, v.length])
    );
    patterns.push({
      type: 'type_distribution',
      description: 'Transactions by type',
      value: typeDistribution
    });

    return { categories, patterns };
  }

  /**
   * tax_estimate(income, deductions) → estimated liability
   */
  public taxEstimate({
    income,
    deductions,
    taxBrackets = DEFAULT_TAX_BRACKETS
  }: {
    income: number;
    deductions: number;
    taxBrackets?: { max: number; rate: number }[];
  }): TaxEstimateResult {
    const taxableIncome = Math.max(0, income - deductions);
    let liability = 0;
    let prevMax = 0;
    for (const { max, rate } of taxBrackets) {
      const band = Math.min(taxableIncome, max) - prevMax;
      if (band <= 0) break;
      liability += band * rate;
      prevMax = max;
      if (taxableIncome <= max) break;
    }
    const effectiveRate =
      taxableIncome <= 0 ? 0 : liability / taxableIncome;
    return {
      estimatedLiability: liability,
      effectiveRate,
      taxableIncome
    };
  }

  /**
   * compliance_check(transaction, regulations[]) → violations, warnings
   */
  public complianceCheck(
    transaction: {
      amount?: number;
      date?: string;
      type?: string;
      tags?: string[];
    },
    regulations: string[]
  ): ComplianceCheckResult {
    const violations: ComplianceCheckResult['violations'] = [];
    const warnings: ComplianceCheckResult['warnings'] = [];

    for (const reg of regulations) {
      const r = reg.toLowerCase();
      if (r === 'large_transaction' || r === 'amount_threshold') {
        const amount = transaction.amount ?? 0;
        if (amount > 100_000) {
          warnings.push({
            regulation: reg,
            severity: 'warning',
            message: `Large transaction amount (${amount}) may require reporting.`
          });
        }
      }
      if (r === 'required_tags' || r === 'tagging') {
        const tags = transaction.tags ?? [];
        if (tags.length === 0 && transaction.type && transaction.type !== 'FEE') {
          warnings.push({
            regulation: reg,
            severity: 'warning',
            message: 'Transaction has no tags; consider adding for compliance.'
          });
        }
      }
      if (r === 'type_consistency') {
        const validTypes = [
          'BUY',
          'SELL',
          'DIVIDEND',
          'INTEREST',
          'FEE',
          'LIABILITY'
        ];
        if (
          transaction.type &&
          !validTypes.includes(transaction.type.toUpperCase())
        ) {
          violations.push({
            regulation: reg,
            severity: 'violation',
            message: `Invalid transaction type: ${transaction.type}.`
          });
        }
      }
    }

    return { violations, warnings };
  }

  /**
   * market_data(symbols[], metrics[]) → current data
   */
  public async marketData({
    symbols = [],
    items: itemsInput,
    metrics = ['marketPrice', 'currency', 'marketState'],
    userId
  }: {
    symbols?: string[];
    items?: AssetProfileIdentifier[];
    metrics?: string[];
    userId?: string;
  }): Promise<MarketDataResult> {
    let items: AssetProfileIdentifier[];
    if (itemsInput && itemsInput.length > 0) {
      items = itemsInput.map(({ dataSource, symbol }) => ({
        dataSource: DataSource[dataSource as keyof typeof DataSource] ?? DEFAULT_DATA_SOURCE,
        symbol
      }));
    } else if (symbols.length > 0) {
      items = symbols.map((s) => {
        const parts = s.includes(':') ? s.split(':') : [null, s];
        const dataSource =
          parts[0] != null && DataSource[parts[0] as keyof typeof DataSource] != null
            ? DataSource[parts[0] as keyof typeof DataSource]
            : DEFAULT_DATA_SOURCE;
        const symbol = parts[1] ?? s;
        return { dataSource, symbol };
      });
    } else {
      return {};
    }

    const quotes = await this.dataProviderService.getQuotes({
      items,
      useCache: true,
      user: userId as never
    });

    const result: MarketDataResult = {};
    const allowedMetrics = new Set(metrics);
    for (const [symbol, data] of Object.entries(quotes)) {
      result[symbol] = {};
      if (allowedMetrics.has('marketPrice')) result[symbol].marketPrice = data.marketPrice;
      if (allowedMetrics.has('currency')) result[symbol].currency = data.currency;
      if (allowedMetrics.has('marketState')) result[symbol].marketState = data.marketState;
      if (allowedMetrics.has('dataSource')) result[symbol].dataSource = data.dataSource;
    }
    return result;
  }
}
