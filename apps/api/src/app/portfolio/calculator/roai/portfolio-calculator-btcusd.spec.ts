import {
  activityDummyData,
  loadExportFile,
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
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import { PortfolioSnapshotServiceMock } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service.mock';
import { parseDate } from '@ghostfolio/common/helper';
import { Activity, ExportResponse } from '@ghostfolio/common/interfaces';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { Big } from 'big.js';
import { join } from 'node:path';

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

describe('PortfolioCalculator', () => {
  let exportResponse: ExportResponse;

  let configurationService: ConfigurationService;
  let currentRateService: CurrentRateService;
  let exchangeRateDataService: ExchangeRateDataService;
  let portfolioCalculatorFactory: PortfolioCalculatorFactory;
  let portfolioSnapshotService: PortfolioSnapshotService;
  let redisCacheService: RedisCacheService;

  beforeAll(() => {
    exportResponse = loadExportFile(
      join(__dirname, '../../../../../../../test/import/ok/btcusd.json')
    );
  });

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
    it.only('with BTCUSD buy (in USD)', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2022-01-14').getTime());

      const activities: Activity[] = exportResponse.activities.map(
        (activity) => ({
          ...activityDummyData,
          ...activity,
          date: parseDate(activity.date),
          feeInAssetProfileCurrency: 4.46,
          feeInBaseCurrency: 4.46,
          SymbolProfile: {
            ...symbolProfileDummyData,
            currency: 'USD',
            dataSource: activity.dataSource,
            name: 'Bitcoin',
            symbol: activity.symbol
          },
          unitPriceInAssetProfileCurrency: 44558.42
        })
      );

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: exportResponse.user.settings.currency,
        userId: userDummyData.id
      });

      const portfolioSnapshot = await portfolioCalculator.computeSnapshot();

      const historicalDataDates = portfolioSnapshot.historicalData.map(
        ({ date }) => {
          return date;
        }
      );

      const investments = portfolioCalculator.getInvestments();

      const investmentsByMonth = portfolioCalculator.getInvestmentsByGroup({
        data: portfolioSnapshot.historicalData,
        groupBy: 'month'
      });

      const investmentsByYear = portfolioCalculator.getInvestmentsByGroup({
        data: portfolioSnapshot.historicalData,
        groupBy: 'year'
      });

      expect(portfolioSnapshot.historicalData[0]).toEqual({
        date: '2021-12-10',
        investmentValueWithCurrencyEffect: 0,
        netPerformance: 0,
        netPerformanceInPercentage: 0,
        netPerformanceInPercentageWithCurrencyEffect: 0,
        netPerformanceWithCurrencyEffect: 0,
        netWorth: 0,
        totalAccountBalance: 0,
        totalInvestment: 0,
        totalInvestmentValueWithCurrencyEffect: 0,
        value: 0,
        valueWithCurrencyEffect: 0
      });

      // Day before first activity (UTC)
      expect(portfolioSnapshot.historicalData[1]).toEqual({
        date: '2021-12-11',
        investmentValueWithCurrencyEffect: 0,
        netPerformance: 0,
        netPerformanceInPercentage: 0,
        netPerformanceInPercentageWithCurrencyEffect: 0,
        netPerformanceWithCurrencyEffect: 0,
        netWorth: 0,
        totalAccountBalance: 0,
        totalInvestment: 0,
        totalInvestmentValueWithCurrencyEffect: 0,
        value: 0,
        valueWithCurrencyEffect: 0
      });

      // 2021-12-12 (UTC): snapshot for activity day may be start-of-day before activity is applied
      expect(portfolioSnapshot.historicalData[2]).toMatchObject({
        date: '2021-12-12'
      });
      // First day with investment: find by non-zero totalInvestment
      const firstDayWithInvestment = portfolioSnapshot.historicalData.find(
        (d) => d.totalInvestment > 0
      );
      expect(firstDayWithInvestment).toBeDefined();
      expect(firstDayWithInvestment).toMatchObject({
        investmentValueWithCurrencyEffect: 44558.42,
        totalInvestment: 44558.42,
        totalInvestmentValueWithCurrencyEffect: 44558.42
      });

      expect(
        portfolioSnapshot.historicalData[
          portfolioSnapshot.historicalData.length - 1
        ]
      ).toEqual({
        date: '2022-01-14',
        investmentValueWithCurrencyEffect: 0,
        netPerformance: -1463.18,
        netPerformanceInPercentage: -0.032837340282712,
        netPerformanceInPercentageWithCurrencyEffect: -0.032837340282712,
        netPerformanceWithCurrencyEffect: -1463.18,
        netWorth: 43099.7,
        totalAccountBalance: 0,
        totalInvestment: 44558.42,
        totalInvestmentValueWithCurrencyEffect: 44558.42,
        value: 43099.7,
        valueWithCurrencyEffect: 43099.7
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
            dateOfFirstActivity: '2021-12-12',
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
            marketPrice: 43099.7,
            marketPriceInBaseCurrency: 43099.7,
            quantity: expect.any(Big),
            symbol: 'BTCUSD',
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

      expect(historicalDataDates).not.toContain('2021-01-01');
      expect(historicalDataDates).toContain('2021-12-31');
      expect(historicalDataDates).toContain('2022-01-01');
      expect(historicalDataDates).not.toContain('2022-12-31');

      expect(investments).toEqual([
        { date: '2021-12-12', investment: new Big('44558.42') }
      ]);

      expect(investmentsByMonth).toEqual([
        { date: '2021-12-01', investment: 44558.42 },
        { date: '2022-01-01', investment: 0 }
      ]);

      expect(investmentsByYear).toEqual([
        { date: '2021-01-01', investment: 44558.42 },
        { date: '2022-01-01', investment: 0 }
      ]);
    });
  });
});
