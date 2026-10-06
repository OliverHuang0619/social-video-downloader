export function detectChallenge(body?: string): string
export function detectLogin(input?: { url?: string; body?: string; hasFileInput?: boolean }): boolean
export function classifyPublishOutcome(input?: { url?: string; body?: string; logs?: string[]; scheduled?: boolean; hasFileInput?: boolean }): { event: 'published' | 'scheduled' | 'error'; message?: string }
