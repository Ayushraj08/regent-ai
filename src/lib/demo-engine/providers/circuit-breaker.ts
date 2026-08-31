import { FailureClassification } from "./types";

export type CircuitState = 'HEALTHY' | 'DEGRADED' | 'OPEN' | 'RECOVERING' | 'BLOCKED';

export class CircuitBreaker {
  private state: CircuitState = 'HEALTHY';
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  
  private readonly failureThreshold: number = 2; // Open after 2 consecutive failures
  private readonly cooldownPeriodMs: number = 30000; // 30 seconds cooldown for OPEN

  public getState(): CircuitState {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.cooldownPeriodMs) {
        this.state = 'RECOVERING';
      }
    }
    return this.state;
  }

  public recordFailure(classification: FailureClassification): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (['QUOTA_EXHAUSTED', 'BILLING_BLOCKED', 'AUTH_INVALID', 'CONFIGURATION_ERROR'].includes(classification)) {
      this.state = 'BLOCKED';
    } else if (classification === 'RATE_LIMITED') {
      this.state = 'OPEN';
    } else {
      if (this.failureCount >= this.failureThreshold) {
        this.state = 'OPEN';
      } else {
        this.state = 'DEGRADED';
      }
    }
  }

  public recordSuccess(): void {
    // If blocked, we shouldn't really be seeing successes, but if we do, we could recover.
    // However, blocked is terminal until restarted.
    if (this.state === 'BLOCKED') return;

    if (this.state === 'RECOVERING' || this.state === 'DEGRADED') {
      this.state = 'HEALTHY';
      this.failureCount = 0;
    }
  }

  public canRoute(): boolean {
    const currentState = this.getState();
    return currentState === 'HEALTHY' || currentState === 'DEGRADED' || currentState === 'RECOVERING';
  }
}
