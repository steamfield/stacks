import { expect, it } from 'vitest';
import { variables } from './env';

it('defaults, trims and validates the runtime title', () => {
	expect(variables.APP_TITLE.schema.parse(undefined)).toBe('Items');
	expect(variables.APP_TITLE.schema.parse('  Inventory  ')).toBe('Inventory');
	expect(variables.APP_TITLE.schema.safeParse('  ').success).toBe(false);
});
