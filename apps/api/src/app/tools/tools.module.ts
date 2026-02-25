import { ApiModule } from '@ghostfolio/api/services/api/api.module';
import { DataProviderModule } from '@ghostfolio/api/services/data-provider/data-provider.module';
import { ImpersonationModule } from '@ghostfolio/api/services/impersonation/impersonation.module';
import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';

import { Module } from '@nestjs/common';

import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  controllers: [ToolsController],
  exports: [ToolsService],
  imports: [
    ApiModule,
    DataProviderModule,
    ImpersonationModule,
    PortfolioModule
  ],
  providers: [ToolsService]
})
export class ToolsModule {}
