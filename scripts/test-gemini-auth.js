import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config({path: '.env.local'});
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.log('GEMINI_API_KEY = MISSING');
    process.exit(1);
}
console.log('GEMINI_API_KEY = PRESENT');
console.log('Key type:', apiKey.startsWith('AQ.') ? 'Authorization' : 'Standard');

async function testSDK() {
    console.log('\n--- SDK TEST ---');
    try {
        const start = performance.now();
        const ai = new GoogleGenAI({ apiKey: apiKey });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: 'say hi',
        });
        const latency = performance.now() - start;
        console.log('SDK result: SUCCESS');
        console.log('Exact safe error: NONE');
        console.log('Latency: ' + latency.toFixed(2) + 'ms');
    } catch (e) {
        console.log('SDK result: FAILED');
        console.log('HTTP status:', e.status || 'UNKNOWN');
        console.log('Exact safe error:', e.message);
    }
}

async function testREST() {
    console.log('\n--- REST TEST ---');
    try {
        const start = performance.now();
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: 'say hi' }] }]
            })
        });
        const latency = performance.now() - start;
        const data = await res.json();
        if (res.ok) {
            console.log('REST result: SUCCESS');
            console.log('Exact safe error: NONE');
        } else {
            console.log('REST result: FAILED');
            console.log('HTTP status:', res.status);
            console.log('Exact safe error:', data?.error?.message || JSON.stringify(data));
        }
        console.log('Latency: ' + latency.toFixed(2) + 'ms');
    } catch (e) {
        console.log('REST result: ERROR');
        console.log('Exact safe error:', e.message);
    }
}

async function run() {
    await testSDK();
    await testREST();
}
run();
