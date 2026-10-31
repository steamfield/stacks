<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ItemForm } from '#lib/item-schema.ts';
	let { form }: { form: ItemForm | null } = $props();
	let pending = $state(false);
</script>

<form
	method="POST"
	use:enhance={() => {
		pending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				pending = false;
			}
		};
	}}
>
	<label for="name">Item name</label>
	<input
		id="name"
		name="name"
		value={form?.name ?? ''}
		aria-invalid={form?.errors.name ? 'true' : undefined}
		aria-describedby={form?.errors.name ? 'name-error' : undefined}
	/>
	{#if form?.errors.name}<p id="name-error" role="alert">{form.errors.name}</p>{/if}
	<button type="submit" disabled={pending}>Add item</button>
</form>
