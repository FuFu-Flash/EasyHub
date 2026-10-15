export type WelcomeChoice = 'login' | 'demo';
const key = 'easyhub:welcome-choice';
export function readWelcomeChoice(): WelcomeChoice | null {
  try {
    const value = localStorage.getItem(key);
    return value === 'login' || value === 'demo' ? value : null;
  } catch {
    return null;
  }
}
export function saveWelcomeChoice(choice: WelcomeChoice): void {
  try {
    localStorage.setItem(key, choice);
  } catch {
    /* Session choice still applies. */
  }
}
export function needsWelcome(state: string, choice: WelcomeChoice | null): boolean {
  return state === 'signed-out' && choice === null;
}
