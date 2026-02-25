import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ImpersonationService } from '@ghostfolio/api/services/impersonation/impersonation.service';
import { HEADER_KEY_IMPERSONATION } from '@ghostfolio/common/config';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { DataSource } from '@prisma/client';

import { ComplianceCheckDto } from './dto/compliance-check.dto';
import { MarketDataDto } from './dto/market-data.dto';
import { TransactionCategorizeDto } from './dto/transaction-categorize.dto';
import { TaxEstimateDto } from './dto/tax-estimate.dto';
import { ToolsService } from './tools.service';

@Controller('tools')
@UseGuards(AuthGuard('jwt'), HasPermissionGuard)
export class ToolsController {
  public constructor(
    @Inject(REQUEST) private readonly request: RequestWithUser,
    private readonly impersonationService: ImpersonationService,
    private readonly toolsService: ToolsService
  ) {}

  /**
   * portfolio_analysis(account_id) → holdings, allocation, performance
   * GET /api/v1/tools/portfolio-analysis/:accountId
   */
  @Get('portfolio-analysis/:accountId')
  public async portfolioAnalysis(
    @Param('accountId') accountId: string,
    @Query('range') dateRange: '1d' | '5d' | '1m' | '1y' | '5y' | 'max' = 'max',
    @Query(HEADER_KEY_IMPERSONATION.toLowerCase()) impersonationId?: string
  ) {
    const userId = await this.impersonationService.validateImpersonationId(
      impersonationId
    );
    const effectiveUserId = userId ?? this.request.user.id;
    return this.toolsService.portfolioAnalysis({
      accountId,
      dateRange,
      impersonationId: impersonationId ?? undefined,
      userId: effectiveUserId
    });
  }

  /**
   * transaction_categorize(transactions[]) → categories, patterns
   * POST /api/v1/tools/transaction-categorize
   */
  @Post('transaction-categorize')
  public async transactionCategorize(@Body() dto: TransactionCategorizeDto) {
    return this.toolsService.transactionCategorize(dto.transactions);
  }

  /**
   * tax_estimate(income, deductions) → estimated liability
   * POST /api/v1/tools/tax-estimate
   */
  @Post('tax-estimate')
  public async taxEstimate(@Body() dto: TaxEstimateDto) {
    return this.toolsService.taxEstimate({
      income: dto.income,
      deductions: dto.deductions
    });
  }

  /**
   * compliance_check(transaction, regulations[]) → violations, warnings
   * POST /api/v1/tools/compliance-check
   */
  @Post('compliance-check')
  public async complianceCheck(@Body() dto: ComplianceCheckDto) {
    return this.toolsService.complianceCheck(
      dto.transaction,
      dto.regulations ?? []
    );
  }

  /**
   * market_data(symbols[], metrics[]) → current data
   * POST /api/v1/tools/market-data
   */
  @Post('market-data')
  public async marketData(@Body() dto: MarketDataDto) {
    const items = dto.items?.map(({ dataSource, symbol }) => ({
      dataSource: DataSource[dataSource as keyof typeof DataSource] ?? DataSource.YAHOO,
      symbol
    }));
    return this.toolsService.marketData({
      symbols: dto.symbols,
      items,
      metrics: dto.metrics,
      userId: this.request.user?.id
    });
  }
}
