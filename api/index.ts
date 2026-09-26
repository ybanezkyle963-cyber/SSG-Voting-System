import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from './src/app.module';

/**
 * Dual-mode entry.
 *
 *  - On Vercel, `createServer` is wrapped as a serverless function (see the
 *    root vercel.json). The Nest app is built once per lambda instance and
 *    reused across warm invocations; schema and seed run on cold start.
 *  - Locally, `node dist/index.js` listens like the old election server did.
 */

let cached: any;

async function bootstrap() {
  if (cached) return cached;
  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);
  const app = await NestFactory.create(AppModule, adapter, { logger: ['error', 'warn'] });
  app.enableCors();
  await app.init();
  cached = expressApp;
  return cached;
}

export default async function handler(req: any, res: any) {
  const app = await bootstrap();
  app(req, res);
}

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT || 4000);
  bootstrap().then((app) => {
    app.listen(port, () => console.log(`SSG election API on http://localhost:${port}`));
  });
}
