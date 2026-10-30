/** The test buttons (src/demo.ts): local dev and Vercel preview deployments only, never Vercel production. */
export const demoEnabled = (dev: boolean, vercelEnv: string | undefined): boolean => vercelEnv !== 'production' && (dev || vercelEnv === 'preview');
