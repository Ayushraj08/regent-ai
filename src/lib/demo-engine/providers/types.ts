import { EngineRequest, NLUResponse } from "../types";

export type FailureClassification = 
  | 'TRANSIENT_TIMEOUT' 
  | 'RATE_LIMITED' 
  | 'QUOTA_EXHAUSTED' 
  | 'BILLING_BLOCKED' 
  | 'AUTH_INVALID' 
  | 'CONFIGURATION_ERROR' 
  | 'SERVER_ERROR' 
  | 'APPLICATION_ERROR';

export interface ProviderError extends Error {
  classification: FailureClassification;
  provider: string;
}

export interface LLMProvider {
  id: string;
  generate(request: EngineRequest, options: { signal: AbortSignal }): Promise<NLUResponse>;
  getName(): string;
}

export interface TelemetryData {
  initial_provider: string;
  attempted_providers: string[];
  final_provider: string;
  fallback_used: boolean;
  final_latency_ms: number;
  total_turn_latency_ms: number;
  duration_ms: number;
  provider: string;
  
  // Legacy / extra debug fields
  request_id?: string;
  turn_id: string;
  attempt_id?: string;
  started_at: string;
  result: 'SUCCESS' | 'ERROR';
  error_type?: FailureClassification | string;
  message?: string;
  model?: string;
}
