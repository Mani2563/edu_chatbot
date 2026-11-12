import { groq } from '@ai-sdk/groq';
import dotenv from 'dotenv';
dotenv.config();

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

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

