<script lang="ts">
  // family fork: the text wordmark shown where Immich shows its logo
  import { branding } from '#lib/family/branding.svelte.ts';
  import { onMount } from 'svelte';

  type Props = { size?: 'small' | 'medium' | 'large' | 'giant'; class?: string };
  let { size = 'medium', class: className = '' }: Props = $props();

  const sizes = { small: 'text-xl', medium: 'text-3xl', large: 'text-4xl', giant: 'text-6xl' };

  onMount(() => void branding.load());
</script>

<span class="{sizes[size]} {className} inline-block font-bold tracking-tight text-primary select-none" translate="no">
  {branding.wordmark}
</span>
