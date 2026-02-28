import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import type { Filter } from '@ghostfolio/common/interfaces';
import { DataSource } from '@prisma/client';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

const DEFAULT_DATA_SOURCE = DataSource.YAHOO;
const emptySchema = z.object({});

/** Stub data when useDummyData is true so agents can call tools without real backend. */
const DUMMY = {
  get_holdings: (currency: string) =>
    `Holdings (base ${currency}):\nAAPL 55.00% USD EQUITY \nMSFT 30.00% USD EQUITY \nGOOGL 15.00% USD EQUITY`,
  get_portfolio_performance: () =>
    JSON.stringify({
      netPerformance: 1250,
      netPerformancePercentage: 8.5,
      totalInvestment: 15000,
      currentNetWorth: 16250
    }),
  get_quote: (symbol: string) =>
    JSON.stringify({
      symbol,
      marketPrice: symbol === 'AAPL' ? 175 : symbol === 'MSFT' ? 380 : 140,
      currency: 'USD',
      marketState: 'REGULAR'
    }),
  get_historical_prices: (symbol: string) =>
    JSON.stringify([
      { date: '2024-01-15', marketPrice: 165 },
      { date: '2024-02-15', marketPrice: 170 },
      { date: '2024-03-15', marketPrice: 175 }
    ]),
  list_accounts: () =>
    JSON.stringify([
      { id: 'acc-1', name: 'Brokerage', platform: 'Interactive Brokers', activitiesCount: 12 },
      { id: 'acc-2', name: 'IRA', platform: 'Fidelity', activitiesCount: 5 }
    ]),
  get_orders: () =>
    JSON.stringify([
      { date: '2024-03-01', type: 'BUY', symbol: 'AAPL', quantity: 10, unitPrice: 172 },
      { date: '2024-02-15', type: 'BUY', symbol: 'MSFT', quantity: 5, unitPrice: 375 }
    ]),
  get_account_balances: () =>
    JSON.stringify({
      'acc-1': [{ date: '2024-03-01', valueInBaseCurrency: 10000 }],
      'acc-2': [{ date: '2024-03-01', valueInBaseCurrency: 6250 }]
    })
};

/** Avoids TS2589 (excessively deep instantiation) with DynamicStructuredTool + empty schema. */
function tool(name: string, description: string, func: () => Promise<string>): DynamicStructuredTool {
  // @ts-expect-error TS2589 - DynamicStructuredTool + z.object({}) causes excessively deep type instantiation
  return new DynamicStructuredTool({ name, description, schema: emptySchema, func });
}

/** Wraps DynamicStructuredTool to avoid TS2589 (excessively deep instantiation) with Zod schemas. */
function structuredTool<Schema extends z.ZodObject<z.ZodRawShape>>(config: {
  name: string;
  description: string;
  schema: Schema;
  func: (input: z.infer<Schema>) => Promise<string>;
}): DynamicStructuredTool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new DynamicStructuredTool(config as any) as DynamicStructuredTool;
}

export interface DataAgentToolsContext {
  filters?: Filter[];
  impersonationId?: string;
  useDummyData?: boolean;
  userCurrency: string;
  userId: string;
}

export interface DataAgentToolsServices {
  accountBalanceService: AccountBalanceService;
  accountService: AccountService;
  dataProviderService: DataProviderService;
  marketDataService: MarketDataService;
  orderService: OrderService;
  portfolioService: PortfolioService;
}

export function createDataAgentTools(
  services: DataAgentToolsServices,
  ctx: DataAgentToolsContext
): DynamicStructuredTool[] {
  const { filters, impersonationId, useDummyData, userCurrency, userId } = ctx;
  const imp = impersonationId ?? '';

  return [
    tool(
      'get_holdings',
      'Get current portfolio holdings and allocation. Returns symbols, quantities, allocation percentages, and value in user currency.',
      async () => {
        if (useDummyData) return DUMMY.get_holdings(userCurrency);
        try {
          const { holdings } = await services.portfolioService.getDetails({
            filters,
            impersonationId: imp,
            userId,
            withSummary: true
          });
          const rows = Object.values(holdings)
            .sort((a, b) => (b.allocationInPercentage ?? 0) - (a.allocationInPercentage ?? 0))
            .map(
              (h) =>
                `${h.symbol} ${((h.allocationInPercentage ?? 0) * 100).toFixed(2)}% ${h.currency} ${h.assetClass ?? ''} ${h.assetSubClass ?? ''}`
            );
          if (rows.length === 0) return 'No holdings.';
          return `Holdings (base ${userCurrency}):\n${rows.join('\n')}`;
        } catch (err) {
          return `Error fetching holdings: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    ),
    structuredTool({
      name: 'get_portfolio_performance',
      description:
        'Get portfolio performance over a period: net performance, total investment, and percentage change.',
      schema: z.object({
        dateRange: z
          .enum(['1d', '5d', '1m', '1y', '5y', 'max'])
          .optional()
          .nullable()
          .describe('Time range for performance')
      }),
      func: async ({ dateRange = 'max' }) => {
        if (useDummyData) return DUMMY.get_portfolio_performance();
        try {
          const perf = await services.portfolioService.getPerformance({
            dateRange,
            filters,
            impersonationId: imp,
            userId
          });
          const p = perf.performance;
          return JSON.stringify({
            netPerformance: p.netPerformance,
            netPerformancePercentage: p.netPerformancePercentage,
            totalInvestment: p.totalInvestment,
            currentNetWorth: p.currentNetWorth
          });
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    structuredTool({
      name: 'get_quote',
      description: 'Get current price/quote for a symbol (e.g. AAPL, MSFT). Optionally specify dataSource like YAHOO.',
      schema: z.object({
        symbol: z.string().describe('Ticker symbol'),
        dataSource: z.string().optional().nullable().describe('DataSource e.g. YAHOO')
      }),
      func: async ({ symbol, dataSource }) => {
        if (useDummyData) return DUMMY.get_quote(symbol);
        try {
          const ds =
            dataSource && Object.values(DataSource).includes(dataSource as DataSource)
              ? (dataSource as DataSource)
              : DEFAULT_DATA_SOURCE;
          const quotes = await services.dataProviderService.getQuotes({
            items: [{ dataSource: ds, symbol }]
          });
          const q = quotes[symbol];
          if (!q?.marketPrice) return `No quote for ${symbol}.`;
          return JSON.stringify({
            symbol,
            marketPrice: q.marketPrice,
            currency: q.currency,
            marketState: q.marketState
          });
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    structuredTool({
      name: 'get_historical_prices',
      description:
        'Get historical market prices for a symbol over a date range. Returns array of { date, marketPrice }.',
      schema: z.object({
        symbol: z.string().describe('Ticker symbol'),
        dataSource: z.string().optional().nullable(),
        startDate: z.string().optional().nullable().describe('YYYY-MM-DD'),
        endDate: z.string().optional().nullable().describe('YYYY-MM-DD')
      }),
      func: async ({ symbol, dataSource, startDate, endDate }) => {
        if (useDummyData) return DUMMY.get_historical_prices(symbol);
        try {
          const ds =
            dataSource && Object.values(DataSource).includes(dataSource as DataSource)
              ? (dataSource as DataSource)
              : DEFAULT_DATA_SOURCE;
          const start = startDate ? new Date(startDate) : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
          const end = endDate ? new Date(endDate) : new Date();
          const data = await services.marketDataService.getRange({
            assetProfileIdentifiers: [{ dataSource: ds, symbol }],
            dateQuery: { gte: start, lt: end }
          });
          const out = data.map((d) => ({ date: d.date.toISOString().slice(0, 10), marketPrice: d.marketPrice }));
          return JSON.stringify(out.slice(-50));
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    tool(
      'list_accounts',
      "List the user's accounts with name, platform, and activity count.",
      async () => {
        if (useDummyData) return DUMMY.list_accounts();
        try {
          const accounts = await services.accountService.getAccounts(userId);
          return JSON.stringify(
            accounts.map((a) => ({
              id: a.id,
              name: a.name,
              platform: (a as { platform?: { name: string } }).platform?.name,
              activitiesCount: (a as { activitiesCount?: number }).activitiesCount
            }))
          );
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    ),
    structuredTool({
      name: 'get_orders',
      description: 'Get orders/activities for the user. Optionally filter by date range or types.',
      schema: z.object({
        startDate: z.string().optional().nullable().describe('YYYY-MM-DD'),
        endDate: z.string().optional().nullable().describe('YYYY-MM-DD'),
        take: z.number().optional().nullable().describe('Max number of orders to return')
      }),
      func: async ({ startDate, endDate, take = 50 }) => {
        if (useDummyData) return DUMMY.get_orders();
        try {
          const { activities } = await services.orderService.getOrders({
            userId,
            userCurrency,
            filters,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            take
          });
          const summary = activities.slice(0, take).map((a) => ({
            date: a.date,
            type: a.type,
            symbol: (a as { symbol?: string }).symbol,
            quantity: (a as { quantity?: number }).quantity,
            unitPrice: (a as { unitPrice?: number }).unitPrice
          }));
          return JSON.stringify(summary);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    tool(
      'get_account_balances',
      'Get account balances over time (historical balance data per account).',
      async () => {
        if (useDummyData) return DUMMY.get_account_balances();
        try {
          const { balances } = await services.accountBalanceService.getAccountBalances({
            userId,
            userCurrency,
            filters
          });
          const byAccount = balances.reduce(
            (acc, b) => {
              const id = b.accountId;
              if (!acc[id]) acc[id] = [];
              acc[id].push({ date: b.date, valueInBaseCurrency: b.valueInBaseCurrency });
              return acc;
            },
            {} as Record<string, { date: Date; valueInBaseCurrency: number }[]>
          );
          return JSON.stringify(byAccount);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    )
  ];
}
