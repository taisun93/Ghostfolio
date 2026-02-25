import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { userDummyData } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator-test-utils';
import { PortfolioCalculatorFactory } from '@ghostfolio/api/app/portfolio/calculator/portfolio-calculator.factory';
import { CurrentRateService } from '@ghostfolio/api/app/portfolio/current-rate.service';
import { CurrentRateServiceMock } from '@ghostfolio/api/app/portfolio/current-rate.service.mock';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { RedisCacheServiceMock } from '@ghostfolio/api/app/redis-cache/redis-cache.service.mock';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { ExchangeRateDataServiceMock } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service.mock';
import { PortfolioSnapshotService } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service';
import { PortfolioSnapshotServiceMock } from '@ghostfolio/api/services/queues/portfolio-snapshot/portfolio-snapshot.service.mock';
import { parseDate } from '@ghostfolio/common/helper';
import { TimelinePosition } from '@ghostfolio/common/models';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { DataSource } from '@prisma/client';
import { Big } from 'big.js';
import { randomUUID } from 'node:crypto';

jest.mock('@ghostfolio/api/app/portfolio/current-rate.service', () => {
  return {
    CurrentRateService: jest.fn().mockImplementation(() => {
      return CurrentRateServiceMock;
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
  let accountBalanceService: AccountBalanceService;
  let accountService: AccountService;
  let configurationService: ConfigurationService;
  let currentRateService: CurrentRateService;
  let dataProviderService: DataProviderService;
  let exchangeRateDataService: ExchangeRateDataService;
  let orderService: OrderService;
  let portfolioCalculatorFactory: PortfolioCalculatorFactory;
  let portfolioSnapshotService: PortfolioSnapshotService;
  let redisCacheService: RedisCacheService;

  beforeEach(() => {
    configurationService = new ConfigurationService();

    exchangeRateDataService = new ExchangeRateDataService(
      null,
      null,
      null,
      null
    );

    accountBalanceService = new AccountBalanceService(
      null,
      exchangeRateDataService,
      null
    );

    accountService = new AccountService(
      accountBalanceService,
      null,
      exchangeRateDataService,
      null
    );

    redisCacheService = new RedisCacheService(null, configurationService);

    dataProviderService = new DataProviderService(
      configurationService,
      null,
      null,
      null,
      null,
      redisCacheService
    );

    currentRateService = new CurrentRateService(
      dataProviderService,
      null,
      null,
      null
    );

    orderService = new OrderService(
      accountBalanceService,
      accountService,
      null,
      dataProviderService,
      null,
      exchangeRateDataService,
      null,
      null
    );

    portfolioSnapshotService = new PortfolioSnapshotService(null);

    portfolioCalculatorFactory = new PortfolioCalculatorFactory(
      configurationService,
      currentRateService,
      exchangeRateDataService,
      portfolioSnapshotService,
      redisCacheService
    );
  });

  describe('Cash Performance', () => {
    it('should calculate performance for cash assets in CHF default currency', async () => {
      jest.useFakeTimers().setSystemTime(parseDate('2025-01-01').getTime());

      const accountId = randomUUID();

      jest
        .spyOn(accountBalanceService, 'getAccountBalances')
        .mockResolvedValue({
          balances: [
            {
              accountId,
              id: randomUUID(),
              date: parseDate('2023-12-31'),
              value: 1000,
              valueInBaseCurrency: 850
            },
            {
              accountId,
              id: randomUUID(),
              date: parseDate('2024-12-31'),
              value: 2000,
              valueInBaseCurrency: 1800
            }
          ]
        });

      jest.spyOn(accountService, 'getCashDetails').mockResolvedValue({
        accounts: [
          {
            balance: 2000,
            comment: null,
            createdAt: parseDate('2023-12-31'),
            currency: 'USD',
            id: accountId,
            isExcluded: false,
            name: 'USD',
            platformId: null,
            updatedAt: parseDate('2023-12-31'),
            userId: userDummyData.id
          }
        ],
        balanceInBaseCurrency: 1820
      });

      jest
        .spyOn(dataProviderService, 'getDataSourceForExchangeRates')
        .mockReturnValue(DataSource.YAHOO);

      jest.spyOn(orderService, 'getOrders').mockResolvedValue({
        activities: [],
        count: 0
      });

      const { activities } = await orderService.getOrdersForPortfolioCalculator(
        {
          userCurrency: 'CHF',
          userId: userDummyData.id,
          withCash: true
        }
      );

      jest.spyOn(currentRateService, 'getValues').mockResolvedValue({
        dataProviderInfos: [],
        errors: [],
        values: []
      });

      const accountBalanceItems =
        await accountBalanceService.getAccountBalanceItems({
          userCurrency: 'CHF',
          userId: userDummyData.id
        });

      const portfolioCalculator = portfolioCalculatorFactory.createCalculator({
        accountBalanceItems,
        activities,
        calculationType: PerformanceCalculationType.ROAI,
        currency: 'CHF',
        userId: userDummyData.id
      });

      const portfolioSnapshot = await portfolioCalculator.computeSnapshot();

      const position = portfolioSnapshot.positions.find(({ symbol }) => {
        return symbol === 'USD';
      });

      /**
       * Investment: 2000 USD * 0.91 = 1820 CHF
       * Investment value with currency effect: (1000 USD * 0.85) + (1000 USD * 0.90) = 1750 CHF
       * Net performance: (1000 USD * 1.0) - (1000 USD * 1.0) = 0 CHF
       * Total account balance: 2000 USD * 0.85 = 1700 CHF (using the exchange rate on 2024-12-31)
       * Value in base currency: 2000 USD * 0.91 = 1820 CHF
       */
      expect(position).toMatchObject<TimelinePosition>({
        activitiesCount: 2,
        averagePrice: expect.any(Big),
        currency: 'USD',
        dataSource: DataSource.YAHOO,
        dateOfFirstActivity: '2023-12-31',
        dividend: expect.any(Big),
        dividendInBaseCurrency: expect.any(Big),
        fee: expect.any(Big),
        feeInBaseCurrency: expect.any(Big),
        grossPerformance: expect.any(Big),
        grossPerformancePercentage: expect.any(Big),
        grossPerformancePercentageWithCurrencyEffect: expect.any(Big),
        grossPerformanceWithCurrencyEffect: expect.any(Big),
        includeInTotalAssetValue: false,
        investment: expect.any(Big),
        investmentWithCurrencyEffect: expect.any(Big),
        marketPrice: 1,
        marketPriceInBaseCurrency: 0.91,
        netPerformance: expect.any(Big),
        netPerformancePercentage: expect.any(Big),
        netPerformancePercentageWithCurrencyEffectMap: {
          '1d': expect.any(Big),
          '1y': expect.any(Big),
          '5y': expect.any(Big),
          max: expect.any(Big),
          mtd: expect.any(Big),
          wtd: expect.any(Big),
          ytd: expect.any(Big)
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
        quantity: expect.any(Big),
        symbol: 'USD',
        timeWeightedInvestment: expect.any(Big),
        timeWeightedInvestmentWithCurrencyEffect: expect.any(Big),
        valueInBaseCurrency: expect.any(Big)
      });

      expect(portfolioSnapshot).toMatchObject({
        hasErrors: false,
        totalFeesWithCurrencyEffect: expect.any(Big),
        totalInterestWithCurrencyEffect: expect.any(Big),
        totalLiabilitiesWithCurrencyEffect: expect.any(Big)
      });
    });
  });
});
