import { describe, it, expect } from 'vitest';
import type { ResolveParams, TemplateResolver } from '../../src/templates/resolver.js';

describe('ResolveParams locale/timezone', () => {
  it('carries locale and timezone to the resolver', async () => {
    let seen: ResolveParams | undefined;
    const resolver: TemplateResolver = { async resolve(p) { seen = p; return { body: 'x' }; } };
    await resolver.resolve({ event: 'e', channel: 'email', lang: 'pl', locale: 'pl-PL', timezone: 'Europe/Warsaw', payload: {} });
    expect(seen?.locale).toBe('pl-PL');
    expect(seen?.timezone).toBe('Europe/Warsaw');
  });
});
