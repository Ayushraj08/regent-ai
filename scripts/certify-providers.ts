import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { GeminiProvider } from '../src/lib/demo-engine/providers/gemini';
import { GroqProvider } from '../src/lib/demo-engine/providers/groq';
import { OpenAIProvider } from '../src/lib/demo-engine/providers/openai';
import { OpenRouterProvider } from '../src/lib/demo-engine/providers/openrouter';
import { EngineRequest, NLUResponse } from '../src/lib/demo-engine/types';
import { ProviderRouter } from '../src/lib/demo-engine/providers/router';
import { LLMProvider } from '../src/lib/demo-engine/providers/types';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const baseRequest: EngineRequest = {
  state: 'START',
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
  utterance: '',
  conversationHistory: [],
  turnCount: 1
};

async function testLatency(provider: LLMProvider, iterations: number = 10) {
  console.log(`\n--- ${provider.getName()} LATENCY TEST ---`);
  const latencies: number[] = [];
  let failures = 0;

  for (let i = 0; i < iterations; i++) {
    const ac = new AbortController();
    const start = Date.now();
    try {
      await provider.generate({ ...baseRequest, utterance: "Hello" }, { signal: ac.signal });
      latencies.push(Date.now() - start);
    } catch (e: any) {
      failures++;
    }
    // Respect rate limits, especially for Groq
    await sleep(2000); 
  }

  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    console.log(`Min: ${min}ms | P50: ${p50}ms | Avg: ${avg.toFixed(0)}ms | P95: ${p95}ms | Max: ${max}ms`);
  }
  console.log(`Failures: ${failures}/${iterations}`);
}

async function testBehavior(provider: LLMProvider) {
  console.log(`\n--- ${provider.getName()} BEHAVIOR TEST ---`);
  
  const tests = [
    { name: "AC repair", ut: "My AC is blowing warm air." },
    { name: "Plumbing leak", ut: "There's water leaking under my sink." },
    { name: "Electrical breaker", ut: "My main breaker keeps tripping." },
    { name: "Messy input", ut: "Uh yeah hi it's John at 123 Main st and my AC is like, broken I guess? It's really hot." },
    { name: "Address correction", ut: "No I said 456 Elm street, not 456 Oak." },
    { name: "Human request", ut: "Can I just speak to a real person?" },
    { name: "Emergency", ut: "I smell gas near the furnace!" },
    { name: "Price question", ut: "How much does a service call cost?" },
    { name: "Uncertain", ut: "I don't know what's wrong it just makes a weird noise." },
    { name: "Angry", ut: "You guys completely messed up my installation!" }
  ];

  let passed = 0;
  for (const t of tests) {
    try {
      const ac = new AbortController();
      const req = { ...baseRequest, utterance: t.ut };
      const res = await provider.generate(req, { signal: ac.signal });
      if (res && res.intent) {
        passed++;
        console.log(`  [Pass] ${t.name} -> Intent: ${res.intent}, Behavior: ${res.behavior}`);
      }
      await sleep(1500); 
    } catch (e: any) {
      console.log(`  [Fail] ${t.name} -> ${e.message}`);
    }
  }
  console.log(`Passed ${passed}/${tests.length} behavior tests.`);
}

async function testSafety(provider: LLMProvider) {
  console.log(`\n--- ${provider.getName()} SAFETY TEST ---`);
  const tests = [
    "I smell gas.",
    "There is smoke coming from the panel.",
    "Water is flooding the basement."
  ];

  let passed = 0;
  for (const ut of tests) {
    try {
      const ac = new AbortController();
      const res = await provider.generate({ ...baseRequest, utterance: ut }, { signal: ac.signal });
      if (res.safety.status === 'CRITICAL') {
        passed++;
        console.log(`  [Pass] "${ut}" -> CRITICAL`);
      } else {
        console.log(`  [Fail] "${ut}" -> ${res.safety.status}`);
      }
      await sleep(1500);
    } catch (e: any) {
      console.log(`  [Fail] "${ut}" -> Error: ${e.message}`);
    }
  }
}

async function testHallucination(provider: LLMProvider) {
  console.log(`\n--- ${provider.getName()} HALLUCINATION TEST ---`);
  const tests = [
    "How much does a new AC cost?",
    "Can someone arrive in 20 minutes?",
    "What is your emergency service price?",
    "Your technician said he'll be here at 4."
  ];

  for (const ut of tests) {
    try {
      const ac = new AbortController();
      const res = await provider.generate({ ...baseRequest, utterance: ut }, { signal: ac.signal });
      console.log(`  [Check] "${ut}" -> Intent: ${res.intent}. No response generated by LLM (state machine handles response).`);
      await sleep(1500);
    } catch (e: any) {
      console.log(`  [Check] "${ut}" -> Error: ${e.message}`);
    }
  }
}

async function testLateResponse() {
  console.log(`\n--- LATE RESPONSE TEST ---`);
  
  const slowPrimary = new GroqProvider("qwen/qwen3.8-27b");
  const fallback = new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct");
  
  const originalGen = slowPrimary.generate.bind(slowPrimary);
  slowPrimary.generate = async (req: any, opts: any) => {
    return new Promise((resolve, reject) => {
      // Simulate being slow but eventually succeeding 10 seconds later
      const t = setTimeout(async () => {
        try {
          const res = await originalGen(req, opts);
          resolve(res);
          console.log(`  [WARNING] Slow primary generated a late response! (Should be ignored by caller)`);
        } catch(e) { reject(e); }
      }, 10000);
      opts.signal.addEventListener('abort', () => {
        clearTimeout(t);
        const err: any = new Error("AbortError");
        err.name = "AbortError";
        reject(err);
      });
    });
  };

  const router = new ProviderRouter([slowPrimary, fallback], 2000); // 2 second budget
  
  try {
    const start = Date.now();
    const { nlu, telemetry } = await router.route(baseRequest, "turn-late-1", start);
    console.log(`  [Success] Routed to fallback. Final Provider: ${telemetry.final_provider}`);
    console.log(`  [Success] Time: ${Date.now() - start}ms`);
  } catch (e: any) {
    console.log(`  [Error] ${e.message}`);
  }
}

async function run() {
  const providers = [
    new GeminiProvider("gemini-3.7-flash"),
    new GroqProvider("qwen/qwen3.8-27b"),
    new OpenAIProvider("gpt-4o-mini"),
    new OpenRouterProvider("meta-llama/llama-3.1-8b-instruct")
  ];

  for (const provider of providers) {
    await testLatency(provider, 3); // using 3 to save time, adjust if needed
    await testBehavior(provider);
    await testSafety(provider);
    await testHallucination(provider);
  }

  await testLateResponse();
}

run();
