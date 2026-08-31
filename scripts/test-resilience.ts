import { GeminiProvider } from '../src/lib/demo-engine/providers/gemini';
import { GroqProvider } from '../src/lib/demo-engine/providers/groq';
import { OpenAIProvider } from '../src/lib/demo-engine/providers/openai';
import { OpenRouterProvider } from '../src/lib/demo-engine/providers/openrouter';
import { ProviderRouter } from '../src/lib/demo-engine/providers/router';

const requestBase = {
  state: 'GREETING',
  trade: 'HVAC',
  lead: {
    name: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    phone: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    address: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    service: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    problem: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    urgency: { value: null, status: 'MISSING', confidence: 0, turn: 0 },
    trade: 'HVAC'
  },
  utterance: 'My AC is completely dead. I am Sarah at 123 Main Street.',
  conversationHistory: [],
  turnCount: 1
} as any;

async function measureProvider(provider: any, iterations: number = 5, baseLatency: number = 200, failureRate: number = 0) {
  console.log(`\nTesting ${provider.getName()}...`);
  const latencies: number[] = [];
  let timeouts = 0;
  
  // Monkey-patch for simulation
  provider.generate = async (req: any, opts: any) => {
    return new Promise((resolve, reject) => {
      const delay = baseLatency + Math.random() * 300; // Add some jitter
      const t = setTimeout(() => {
        if (Math.random() < failureRate) {
          reject(new Error("Simulated timeout"));
        } else {
          resolve({ 
            intent: 'GENERAL_QUESTION', 
            behavior: 'NEUTRAL', 
            confidence: 1.0,
            safety: { status: 'NORMAL', category: null, confidence: 1.0 },
            extracted: {} 
          } as any);
        }
      }, delay);
      
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error("AbortError"));
      });
    });
  };

  const promises = [];
  for (let i = 0; i < iterations; i++) {
    const promise = (async () => {
      const start = Date.now();
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 5000);
      try {
        await provider.generate(requestBase, { signal: ac.signal });
        const duration = Date.now() - start;
        latencies.push(duration);
      } catch (e: any) {
        if (e.name === 'AbortError' || e.message.includes('timeout')) {
          timeouts++;
        } else {
          console.error(`  Error: ${e.message}`);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    })();
    promises.push(promise);
  }
  
  await Promise.all(promises);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  
  console.log(`  P50: ${p50.toFixed(0)}ms`);
  console.log(`  P95: ${p95.toFixed(0)}ms`);
  console.log(`  Timeouts: ${timeouts}/${iterations}`);
}

async function runFailoverTest() {
  console.log("\n--- FAILOVER LATENCY TEST ---");
  
  const gemini = new GeminiProvider("gemini-3.7-flash");
  const groq = new GroqProvider("llama-3.1-8b-instant");
  const router = new ProviderRouter([gemini, groq], 3500);

  // Monkey-patch Gemini to simulate a delay/timeout
  gemini.generate = async (req: any, opts: any) => {
    return new Promise((resolve, reject) => {
      // Simulate Gemini hanging for 4 seconds
      const t = setTimeout(() => reject(new Error("Simulated timeout")), 4000);
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error("AbortError"));
      });
    });
  };

  // Monkey-patch Groq to simulate fast success
  groq.generate = async (req: any, opts: any) => {
    return new Promise((resolve, reject) => {
      const delay = 450;
      const t = setTimeout(() => resolve({ 
        intent: 'GENERAL_QUESTION', 
        behavior: 'NEUTRAL', 
        confidence: 1.0,
        safety: { status: 'NORMAL', category: null, confidence: 1.0 },
        extracted: {} 
      } as any), delay);
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error("AbortError"));
      });
    });
  };

  const start = Date.now();
  try {
    const { telemetry } = await router.route(requestBase, "test-turn-1", start);
    const totalTime = Date.now() - start;
    console.log(`  Gemini timeout budget: 3500ms`);
    console.log(`  Fallback used: ${telemetry.fallback_used}`);
    console.log(`  Final provider: ${telemetry.final_provider}`);
    console.log(`  Total time to response: ${totalTime}ms`);
    console.log(`  Groq start time (after failover): 3500ms`);
    console.log(`  Groq generation time: ${totalTime - 3500}ms`);
  } catch (e) {
    console.error("Router failed", e);
  }
}

async function main() {
  await measureProvider(new GeminiProvider("gemini-3.7-flash"), 100, 1500, 0.05); // Simulated Gemini 3.7 Flash metrics
  await measureProvider(new GroqProvider("llama-3.1-8b-instant"), 100, 300, 0.01);
  await measureProvider(new OpenAIProvider("gpt-4o-mini"), 100, 500, 0.01);
  await measureProvider(new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct:free"), 100, 600, 0.02);
  
  await runFailoverTest();
}

main();
