export interface TransactionForCompliance {
  amount?: number;
  date?: string;
  id?: string;
  symbol?: string;
  tags?: string[];
  type?: string;
}

export class ComplianceCheckDto {
  regulations!: string[];
  transaction!: TransactionForCompliance;
}
