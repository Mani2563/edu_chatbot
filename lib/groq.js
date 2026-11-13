import { groq } from '@ai-sdk/groq';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const FALLBACK_MODELS = ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'allam-2-7b'];

export function isGroqConfigured() {
  const key = process.env.GROQ_API_KEY;
  return Boolean(key && key.trim().length > 0 && !key.includes('your_groq_api_key'));
}

export function getGroqModel(customModel = null) {
  const modelName = customModel || process.env.GROQ_MODEL || DEFAULT_MODEL;
  if (!isGroqConfigured()) {
    return null;
  }
  return groq(modelName);
}

export function getFallbackGroqModels() {
  if (!isGroqConfigured()) return [];
  const primary = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const list = [primary, ...FALLBACK_MODELS.filter(m => m !== primary)];
  return list.map(m => ({ name: m, model: groq(m) }));
}

