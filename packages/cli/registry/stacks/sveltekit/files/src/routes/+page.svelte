<script lang="ts">
	import AddItemForm from '#lib/components/AddItemForm.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>{data.title}</title></svelte:head>
<h1>{data.title}</h1>
<ul aria-label="Items">
	{#each data.items as item (item.id)}<li>{item.name}</li>{/each}
</ul>
<AddItemForm {form} />
