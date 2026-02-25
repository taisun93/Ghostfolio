import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';

export class MarketDataDto {
  @IsArray()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  metrics!: string[];

  @IsOptional()
  @IsArray()
  symbols?: string[];

  /** Optional: [{ dataSource, symbol }]. If provided, overrides symbols. */
  @IsOptional()
  items?: { dataSource: string; symbol: string }[];
}
