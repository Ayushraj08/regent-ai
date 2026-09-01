import { NLUResponse } from "../types";
import { LLMProvider, ProviderError, TelemetryData } from "./types";
import { CircuitBreaker } from "./circuit-breaker";

export class ProviderRouter {
  private providers: LLMProvider[];
  private breakers: Map<string, CircuitBreaker>;
  private timeBudgetMs: number;

  constructor(providers: LLMProvider[], timeBudgetMs: number = 3500) {
    this.providers = providers;
    this.breakers = new Map();
    for (const p of providers) {
      this.breakers.set(p.id, new CircuitBreaker());
    }
    this.timeBudgetMs = timeBudgetMs;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async route(request: any, turnId: string, globalStartTime: number): Promise<{ nlu: NLUResponse, telemetry: Partial<TelemetryData> }> {
    const telemetry: Partial<TelemetryData> = {
      turn_id: turnId,
      fallback_used: false,
      attempted_providers: [],
    };

    // Sort providers by health state to prioritize healthy ones, while preserving original order for ties
    const sortedProviders = [...this.providers].sort((a, b) => {
      const stateA = this.breakers.get(a.id)!.getState();
      const stateB = this.breakers.get(b.id)!.getState();
      
      const score = (state: string) => {
        if (state === 'HEALTHY') return 0;
        if (state === 'RECOVERING') return 1;
        if (state === 'DEGRADED') return 2;
        if (state === 'OPEN') return 3;
        if (state === 'BLOCKED') return 4;
        return 5;
      };
      
      return score(stateA) - score(stateB);
    });

    if (sortedProviders.length > 0) {
      telemetry.initial_provider = sortedProviders[0].getName();
    }

    let attemptCount = 0;

    for (const provider of sortedProviders) {
      const breaker = this.breakers.get(provider.id)!;
      
      if (!breaker.canRoute()) {
        console.warn(`[ROUTER] Skipping ${provider.id} because circuit is ${breaker.getState()}`);
        continue;
      }

      attemptCount++;
      const attemptId = `${turnId}-${attemptCount}`;
      const providerStartTime = Date.now();
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), this.timeBudgetMs);

      telemetry.attempted_providers!.push(provider.getName());
      if (attemptCount > 1) {
        telemetry.fallback_used = true;
      }

      try {
        const nlu = await provider.generate(request, { signal: abortController.signal });
        clearTimeout(timeoutId);
        breaker.recordSuccess();

        telemetry.attempt_id = attemptId;
        telemetry.final_provider = provider.getName();
        telemetry.final_latency_ms = Date.now() - providerStartTime;
        telemetry.total_turn_latency_ms = Date.now() - globalStartTime;

        return { nlu, telemetry };

      } catch (err: any) {
        clearTimeout(timeoutId);
        
        const providerError = err as ProviderError;
        console.warn(`[ROUTER] Attempt ${attemptId} failed on ${provider.id}: ${providerError.message}`);

        breaker.recordFailure(providerError.classification || 'SERVER_ERROR');

        if (providerError.classification === 'CONFIGURATION_ERROR') {
          if (providerError.message.includes("missing") || providerError.message.includes("UNAVAILABLE")) {
            console.warn(`[ROUTER] ${provider.id} configuration missing, skipping...`);
            continue;
          }
          throw providerError; 
        }

        // Continue to the next provider for other errors
      }
    }

    // If we exhaust all providers
    const err = new Error("All LLM providers failed") as ProviderError;
    err.classification = 'TRANSIENT_TIMEOUT';
    telemetry.total_turn_latency_ms = Date.now() - globalStartTime;
    throw err;
  }
}
