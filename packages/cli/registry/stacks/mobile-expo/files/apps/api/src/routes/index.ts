import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../env';
import { health } from './health';
import { items } from './items';

export const routes = new OpenAPIHono<AppEnv>().route('/health', health).route('/items', items);
export type AppType = typeof routes;
