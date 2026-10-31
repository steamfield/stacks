import { createApp } from './app';
import { config } from './config';

const settings = config();
export default { port: settings.PORT_API, fetch: createApp(settings.DATABASE_URL).fetch };
