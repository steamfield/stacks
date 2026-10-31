import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

export const variables = defineEnvVars({
	APP_TITLE: { schema: z.string().trim().min(1).default('Items') }
});
