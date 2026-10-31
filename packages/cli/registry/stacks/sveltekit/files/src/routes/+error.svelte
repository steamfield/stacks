<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<h1>{page.status}</h1>
<p>We couldn't load this page.</p>
<a href={resolve('/')}>Back to items</a>
