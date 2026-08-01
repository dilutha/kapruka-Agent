import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
  // A 20s per-attempt timeout with 3 retries meant a single slow-but-eventual
  // call could burn 60s+ before we even considered giving up — the exact
  // long-tail latency reported. Measured in production: normal calls
  // consistently resolve in 1.8-3.6s; a call still running at 9s is almost
  // never "about to finish", it's stuck — better to abort and retry than
  // keep waiting. Paired with maxRetries: 2, worst case for a single
  // generateContent() is now ~18s instead of ~60s.
  geminiTimeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS ?? '7000', 10),
  geminiMaxRetries: parseInt(process.env.GEMINI_MAX_RETRIES ?? '2', 10),
  mcpServerUrl: process.env.KAPRUKA_MCP_SERVER_URL,
  mcpTimeoutMs: parseInt(process.env.MCP_TIMEOUT_MS ?? '10000', 10),
  mcpHeartbeatMs: parseInt(process.env.MCP_HEARTBEAT_MS ?? '30000', 10),
}));
