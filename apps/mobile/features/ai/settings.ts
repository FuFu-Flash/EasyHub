import * as SecureStore from 'expo-secure-store';
import { validateAiSettings, type AiSettings } from './review';

const KEY = 'easyhub.ai.review.credentials';
export async function loadAiSettings(): Promise<AiSettings | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try { return validateAiSettings(JSON.parse(raw) as unknown); } catch { return null; }
}
export async function saveAiSettings(value: AiSettings): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(validateAiSettings(value)));
}
export async function clearAiSettings(): Promise<void> { await SecureStore.deleteItemAsync(KEY); }
