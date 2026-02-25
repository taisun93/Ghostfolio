export interface ComplianceViolation {
  regulation: string;
  severity: 'violation' | 'warning';
  message: string;
}

export interface ComplianceCheckResult {
  violations: ComplianceViolation[];
  warnings: ComplianceViolation[];
}
