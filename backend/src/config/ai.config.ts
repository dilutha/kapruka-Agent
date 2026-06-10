import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  openaiApiKey:  process.env.OPENAI_API_KEY,
  mcpServerUrl:  process.env.KAPRUKA_MCP_SERVER_URL,
  mcpTimeoutMs:  parseInt(process.env.MCP_TIMEOUT_MS ?? '10000', 10),
}));