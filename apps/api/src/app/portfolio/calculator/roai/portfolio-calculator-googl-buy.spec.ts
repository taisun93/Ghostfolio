import {
  activityDummyData,
  symbolProfileDummyData,
  userDummyData
} from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator-test-utils';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { CurrentRateServiceMock } from '@ghostfolio/api/app/portfolio/current-rate.service.mock';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { RedisCacheServiceMock } from '@ghostfolio/api/app/redis-cache/redis-cache.service.mock';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ExchangeRateDataServiceMock } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service.mock';
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import { PortfolioSnapshotServiceMock } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service.mock';
import { parseDate } from '@ghostfolio/common/helper';
import { Activity } from '@ghostfolio/common/interfaces';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { Big } from 'big.js';

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => {
  return {
    CurrentRateService: jest.fn().mockImplementation(() => {
      return CurrentRateServiceMock;
    })
  };
});

jest.mock(
  '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service',
  () => {
    return {
      PortfolioSnapshotService: jest.fn().mockImplementation(() => {
        return PortfolioSnapshotServiceMock;
      })
    };
  }
);

jest.mock('@ghostfolio/api/app/redis-cache/redis-cache.service', () => {
  return {
    RedisCacheService: jest.fn().mockImplementation(() => {
      return RedisCacheServiceMock;
    })
  };
});

jest.mock(
  '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service',
  () => {
    return {
      ExchangeRateDataService: jest.fn().mockImplementation(() => {
        return ExchangeRateDataServiceMock;
      })
    };
  }
);

describe('PortfolioCalculator', () => {
  let configurationService: ConfigurationService;
  let currentRateService: CurrentRateService;
  let exchangeRateDataService: ExchangeRateDataService;
  let portfolioCalculatorFactory: PortfolioCalculatorFactory;
  let portfolioSnapshotService: PortfolioSnapshotService;
  let redisCacheService: RedisCacheService;

  beforeEach(() => {
    configurationService = new ConfigurationService();

    currentRateService = new CurrentRateService(null, null, null, null);

    exchangeRateDataService = new ExchangeRateDataService(
      null,
      null,
      null,
      null
    );

    portfolioSnapshotService = new PortfolioSnapshotService(null);

    redisCacheService = new RedisCacheService(null, null);

    portfolioCalculatorFactory = new PortfolioCalculatorFactory(
      configurationService,
      currentRateService,
      exchangeRateDataService,
      portfolioSnapshotService,
      redisCacheService
    );
  });

  describe('get current positions', () => {
    it.only('with GOOGL buy', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2023-07-10').getTime());

      const activities: Activity[] = [
        {
          ...activityDummyData,
          date: new Date('2023-01-03'),
          feeInAssetProfileCurrency: 1,
          feeInBaseCurrency: 0.9238,
          quantity: 1,
          SymbolProfile: {
            ...symbolProfileDummyData,
            currency: 'USD',
            dataSource: 'YAHOO',
            name: 'Alphabet Inc.',
            symbol: 'GOOGL'
          },
          type: 'BUY',
          unitPriceInAssetProfileCurrency: 89.12
        }
      ];

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: 'CHF',
        userId: userDummyData.id
      });

      const portfolioSnapshot = await portfolioCalculator.computeSnapshot();

      const investments = portfolioCalculator.getInvestments();

      const investmentsByMonth = portfolioCalculator.getInvestmentsByGroup({
        data: portfolioSnapshot.historicalData,
        groupBy: 'month'
      });

      const investmentsByYear = portfolioCalculator.getInvestmentsByGroup({
        data: portfolioSnapshot.historicalData,
        groupBy: 'year'
      });

      expect(portfolioSnapshot).toMatchObject({
        currentValueInBaseCurrency: expect.any(Big),
        errors: [],
        hasErrors: false,
        positions: [
          {
            activitiesCount: 1,
            averagePrice: expect.any(Big),
            currency: 'USD',
            dataSource: 'YAHOO',
            dateOfFirstActivity: '2023-01-03',
            dividend: expect.any(Big),
            dividendInBaseCurrency: expect.any(Big),
            fee: expect.any(Big),
            feeInBaseCurrency: expect.any(Big),
            grossPerformance: expect.any(Big),
            grossPerformancePercentage: expect.any(Big),
            grossPerformancePercentageWithCurrencyEffect: expect.any(Big),
            grossPerformanceWithCurrencyEffect: expect.any(Big),
            investment: expect.any(Big),
            investmentWithCurrencyEffect: expect.any(Big),
            netPerformance: expect.any(Big),
            netPerformancePercentage: expect.any(Big),
            netPerformancePercentageWithCurrencyEffectMap: {
              max: expect.any(Big)
            },
            netPerformanceWithCurrencyEffectMap: {
              max: expect.any(Big)
            },
            marketPrice: 116.45,
            marketPriceInBaseCurrency: 103.10483,
            quantity: expect.any(Big),
            symbol: 'GOOGL',
            tags: [],
            timeWeightedInvestment: expect.any(Big),
            timeWeightedInvestmentWithCurrencyEffect: expect.any(Big),
            valueInBaseCurrency: expect.any(Big)
          }
        ],
        totalFeesWithCurrencyEffect: expect.any(Big),
        totalInterestWithCurrencyEffect: expect.any(Big),
        totalInvestment: expect.any(Big),
        totalInvestmentWithCurrencyEffect: expect.any(Big),
        totalLiabilitiesWithCurrencyEffect: expect.any(Big)
      });

      expect(portfolioSnapshot.historicalData.at(-1)).toMatchObject(
        expect.objectContaining({
          netPerformance: new Big('26.33').mul(0.8854).toNumber(),
          netPerformanceInPercentage: 0.29544434470377019749,
          netPerformanceInPercentageWithCurrencyEffect: 0.24112962014285697628,
          netPerformanceWithCurrencyEffect: 19.851974,
          totalInvestment: new Big('89.12').mul(0.8854).toNumber(),
          totalInvestmentValueWithCurrencyEffect: 82.329056
        })
      );

      expect(investments).toEqual([
        { date: '2023-01-03', investment: new Big('89.12') }
      ]);

      expect(investmentsByMonth).toEqual([
        { date: '2023-01-01', investment: 82.329056 },
        {
          date: '2023-02-01',
          investment: 0
        },
        {
          date: '2023-03-01',
          investment: 0
        },
        {
          date: '2023-04-01',
          investment: 0
        },
        {
          date: '2023-05-01',
          investment: 0
        },
        {
          date: '2023-06-01',
          investment: 0
        },
        {
          date: '2023-07-01',
          investment: 0
        }
      ]);

      expect(investmentsByYear).toEqual([
        { date: '2023-01-01', investment: 82.329056 }
      ]);
    });
  });
});
