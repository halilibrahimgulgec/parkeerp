import { ActionDraftPayload } from './aiActionTypes';

export type WatchdogAnomalySeverity = 'critical' | 'warning' | 'info';

export type WatchdogAnomalyCategory = 'scale_tare' | 'waste' | 'stock' | 'pallet' | 'transit';

export interface WatchdogAnomaly {
  id: string;
  category: WatchdogAnomalyCategory;
  severity: WatchdogAnomalySeverity;
  title: string;
  description: string;
  metric: string;
  detectedAt: string;
  suggestedAction: string;
  targetEntity?: string;
  actionDraft?: ActionDraftPayload;
}

export interface WatchdogScanResult {
  timestamp: string;
  totalAnomalies: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  anomalies: WatchdogAnomaly[];
  summaryText: string;
}
