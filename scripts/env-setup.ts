import { config } from 'dotenv';
config({ path: '.env.local' });
import WebSocket from 'ws';
(global as any).WebSocket = WebSocket;
