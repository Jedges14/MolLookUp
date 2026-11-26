import { z } from 'zod';

const factsSchema = z.array(z.object({ fact: z.string().min(1) })).min(1);

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Daily science fact from RapidAPI ("Facts by API Ninjas"), fetched server-side so the
 * key never reaches the browser. One upstream call per day per process.
 */
export class FactService {
  private cached: { fact: string; at: number } | null = null;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async today(): Promise<string> {
    if (!this.apiKey) throw new Error('Fact service is not configured');
    if (this.cached && this.now() - this.cached.at < ONE_DAY_MS) return this.cached.fact;
    const res = await this.fetchFn('https://facts-by-api-ninjas.p.rapidapi.com/v1/facts', {
      headers: {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'facts-by-api-ninjas.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Fact API responded HTTP ${res.status}`);
    const parsed = factsSchema.parse(await res.json());
    this.cached = { fact: parsed[0]!.fact, at: this.now() };
    return this.cached.fact;
  }
}
