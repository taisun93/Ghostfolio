import { IsNumber, Min } from 'class-validator';

export class TaxEstimateDto {
  @IsNumber()
  @Min(0)
  deductions!: number;

  @IsNumber()
  @Min(0)
  income!: number;
}
