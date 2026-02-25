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
    it.only('with BALN.SW buy', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2021-12-18').getTime());

      const activities: Activity[] = [
        {
          ...activityDummyData,
          date: new Date('2021-11-30'),
          feeInAssetProfileCurrency: 1.55,
          feeInBaseCurrency: 1.55,
          quantity: 2,
          SymbolProfile: {
            ...symbolProfileDummyData,
            currency: 'CHF',
            dataSource: 'YAHOO',
            name: 'Bâloise Holding AG',
            symbol: 'BALN.SW'
          },
          type: 'BUY',
          unitPriceInAssetProfileCurrency: 136.6
        }
      ];

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: 'CHF',
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

      expect(portfolioSnapshot).toMatchObject({
        currentValueInBaseCurrency: expect.any(Big),
        errors: [],
        hasErrors: false,
        positions: [
          {
            activitiesCount: 1,
            averagePrice: expect.any(Big),
            currency: 'CHF',
            dataSource: 'YAHOO',
            dateOfFirstActivity: '2021-11-30',
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
              '1d': expect.any(Big),
              '1y': expect.any(Big),
              '5y': expect.any(Big),
              max: expect.any(Big),
              mtd: expect.any(Big),
              wtd: expect.any(Big),
              ytd: expect.any(Big)
            },
            marketPrice: 148.9,
            marketPriceInBaseCurrency: 148.9,
            quantity: expect.any(Big),
            symbol: 'BALN.SW',
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
      expect(historicalDataDates).not.toContain('2021-12-31');

      expect(portfolioSnapshot.historicalData.at(-1)).toMatchObject(
        expect.objectContaining({
          date: '2021-12-18',
          netPerformance: 23.05,
          netPerformanceInPercentage: 0.08437042459736457,
          netPerformanceInPercentageWithCurrencyEffect: 0.08437042459736457,
          netPerformanceWithCurrencyEffect: 23.05,
          totalInvestment: 273.2,
          totalInvestmentValueWithCurrencyEffect: 273.2
        })
      );

      expect(investments).toEqual([
        { date: '2021-11-30', investment: new Big('273.2') }
      ]);

      expect(investmentsByMonth).toEqual([
        { date: '2021-11-01', investment: 273.2 },
        { date: '2021-12-01', investment: 0 }
      ]);

      expect(investmentsByYear).toEqual([
        { date: '2021-01-01', investment: 273.2 }
      ]);
    });

    it.only('with BALN.SW buy (with unit price lower than closing price)', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2021-12-18').getTime());

      const activities: Activity[] = [
        {
          ...activityDummyData,
          date: new Date('2021-11-30'),
          feeInAssetProfileCurrency: 1.55,
          feeInBaseCurrency: 1.55,
          quantity: 2,
          SymbolProfile: {
            ...symbolProfileDummyData,
            currency: 'CHF',
            dataSource: 'YAHOO',
            name: 'Bâloise Holding AG',
            symbol: 'BALN.SW'
          },
          type: 'BUY',
          unitPriceInAssetProfileCurrency: 135.0
        }
      ];

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: 'CHF',
        userId: userDummyData.id
      });

      const portfolioSnapshot = await portfolioCalculator.computeSnapshot();
      const snapshotOnBuyDate = portfolioSnapshot.historicalData.find(
        ({ date }) => {
          return date === '2021-11-30';
        }
      );

      // Closing price on 2021-11-30: 136.6
      expect(snapshotOnBuyDate?.netPerformanceWithCurrencyEffect).toEqual(1.65); // 2 * (136.6 - 135.0) - 1.55 = 1.65
    });

    it('with BALN.SW buy (with unit price lower than closing price), calculated on buy date', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2021-11-30').getTime());

      const activities: Activity[] = [
        {
          ...activityDummyData,
          date: new Date('2021-11-30'),
          feeInAssetProfileCurrency: 1.55,
          feeInBaseCurrency: 1.55,
          quantity: 2,
          SymbolProfile: {
            ...symbolProfileDummyData,
            currency: 'CHF',
            dataSource: 'YAHOO',
            name: 'Bâloise Holding AG',
            symbol: 'BALN.SW'
          },
          type: 'BUY',
          unitPriceInAssetProfileCurrency: 135.0
        }
      ];

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: 'CHF',
        userId: userDummyData.id
      });

      const portfolioSnapshot = await portfolioCalculator.computeSnapshot();
      const snapshotOnBuyDate = portfolioSnapshot.historicalData.find(
        ({ date }) => {
          return date === '2021-11-30';
        }
      );

      // Closing price on 2021-11-30: 136.6
      expect(snapshotOnBuyDate?.netPerformanceWithCurrencyEffect).toEqual(1.65); // 2 * (136.6 - 135.0) - 1.55 = 1.65
    });
  });
});
