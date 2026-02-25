export interface TransactionForCategorize {
  amount?: number;
  date?: string;
  id?: string;
  symbol?: string;
  tags?: string[];
  type: string;
}

export interface TransactionCategory {
  category: string;
  count: number;
  transactionIds: string[];
}

export interface TransactionPattern {
  description: string;
  type: 'frequency' | 'amount_band' | 'type_distribution';
  value: unknown;
}

export interface TransactionCategorizeResult {
  categories: TransactionCategory[];
  patterns: TransactionPattern[];
}
