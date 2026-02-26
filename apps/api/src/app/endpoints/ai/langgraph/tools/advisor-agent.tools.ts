import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import type { Filter } from '@ghostfolio/common/interfaces';

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export interface AdvisorAgentToolsContext {
  filters?: Filter[];
  impersonationId?: string;
  userCurrency: string;
  userId: string;
}

export interface AdvisorAgentToolsServices {
  portfolioService: PortfolioService;
}

/**
 * High-level allocation summary by asset class for advice context.
 */
export function createAdvisorAgentTools(
  services: AdvisorAgentToolsServices,
  ctx: AdvisorAgentToolsContext
): DynamicStructuredTool[] {
  const { filters, impersonationId, userCurrency, userId } = ctx;
  const imp = impersonationId ?? '';

  return [
    new DynamicStructuredTool({
      name: 'get_allocation_summary',
      description:
        'Get high-level allocation summary: allocation by asset class (equity, fixed income, liquidity, etc.) and optionally by region. Use for diversification and risk context.',
      schema: z.object({}),
      func: async () => {
        try {
          const { holdings, summary } = await services.portfolioService.getDetails({
            filters,
            impersonationId: imp,
            userId,
            withSummary: true
          });
          const byAssetClass: Record<string, number> = {};
          for (const h of Object.values(holdings)) {
            const ac = h.assetClass ?? 'UNKNOWN';
            byAssetClass[ac] = (byAssetClass[ac] ?? 0) + (h.allocationInPercentage ?? 0);
          }
          const totalValue = summary?.currentValueInBaseCurrency ?? 0;
          return JSON.stringify({
            byAssetClass,
            totalValueInBaseCurrency: totalValue,
            currency: userCurrency
          });
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    new DynamicStructuredTool({
      name: 'analyze_allocation',
      description:
        'Return a short structured analysis of the portfolio: e.g. "heavy in tech", "no bonds", "concentrated in one region". Use this to give allocation advice.',
      schema: z.object({}),
      func: async () => {
        try {
          const { holdings } = await services.portfolioService.getDetails({
            filters,
            impersonationId: imp,
            userId
          });
          const entries = Object.values(holdings).sort(
            (a, b) => (b.allocationInPercentage ?? 0) - (a.allocationInPercentage ?? 0)
          );
          const topHoldings = entries.slice(0, 10).map((h) => ({
            symbol: h.symbol,
            allocationPercent: (h.allocationInPercentage ?? 0) * 100,
            assetClass: h.assetClass,
            assetSubClass: h.assetSubClass
          }));
          const assetClasses = new Set(entries.map((h) => h.assetClass).filter(Boolean));
          const hasBonds = Array.from(assetClasses).some((ac) => ac === 'FIXED_INCOME');
          const hasLiquidity = Array.from(assetClasses).some((ac) => ac === 'LIQUIDITY');
          return JSON.stringify({
            topHoldings,
            assetClasses: Array.from(assetClasses),
            hasBonds,
            hasLiquidity,
            concentrationWarning:
              topHoldings[0]?.allocationPercent > 30
                ? 'Portfolio is concentrated in a single holding.'
                : undefined
          });
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    }),
    new DynamicStructuredTool({
      name: 'suggest_rebalance',
      description:
        'Get high-level rebalance suggestions: e.g. "consider adding bonds", "diversify regionally". Rule-of-thumb only; not personalized advice.',
      schema: z.object({}),
      func: async () => {
        try {
          const { holdings } = await services.portfolioService.getDetails({
            filters,
            impersonationId: imp,
            userId
          });
          const entries = Object.values(holdings);
          const byAssetClass: Record<string, number> = {};
          for (const h of entries) {
            const ac = h.assetClass ?? 'UNKNOWN';
            byAssetClass[ac] = (byAssetClass[ac] ?? 0) + (h.allocationInPercentage ?? 0);
          }
          const suggestions: string[] = [];
          if (!byAssetClass['FIXED_INCOME'] || byAssetClass['FIXED_INCOME'] < 0.1) {
            suggestions.push('Consider adding fixed income for diversification.');
          }
          if (!byAssetClass['LIQUIDITY'] || byAssetClass['LIQUIDITY'] < 0.05) {
            suggestions.push('Consider keeping some liquidity for emergencies.');
          }
          if (Object.keys(byAssetClass).length === 1 && entries.length > 0) {
            suggestions.push('Portfolio is single-asset-class; consider diversifying.');
          }
          return suggestions.length > 0 ? suggestions.join(' ') : 'Allocation appears balanced at a high level.';
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
        }
      }
    })
  ];
}
