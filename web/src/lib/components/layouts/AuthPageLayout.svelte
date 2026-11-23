<script lang="ts">
  import Wordmark from '#lib/family/Wordmark.svelte';
  import { Card, CardBody, CardHeader, Heading, VStack } from '@immich/ui';
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    children?: Snippet;
    withHeader?: boolean;
    withBackdrop?: boolean;
  }

  let { title, children, withHeader = true, withBackdrop = true }: Props = $props();
</script>

<section class="relative isolate flex min-h-dvh min-w-dvw items-center justify-center">
  {#if withBackdrop}
    <div class="absolute -z-10 flex size-full place-content-center place-items-center">
      <!-- family fork: a soft colour wash instead of the Immich logo -->
      <div
        class="mx-auto h-2/3 w-full max-w-(--breakpoint-md) rounded-full bg-radial from-primary/40 via-primary/10 to-transparent"
      ></div>
      <div
        class="absolute inset-s-0 top-0 h-[99%] w-full bg-transparent backdrop-blur-[200px] dark:bg-immich-dark-bg/20"
      ></div>
    </div>
  {/if}

  <Card color="secondary" class="m-2 w-full max-w-xl border">
    {#if withHeader}
      <CardHeader class="mt-6">
        <VStack>
          <Wordmark size="giant" />
          <Heading size="large" class="font-semibold" color="primary" tag="h1">{title}</Heading>
        </VStack>
      </CardHeader>
    {/if}

    <CardBody class="p-8">
      {@render children?.()}
    </CardBody>
  </Card>
  <!-- family fork: credit where it's due (AGPL) -->
  <p class="absolute bottom-4 text-xs text-gray-500 dark:text-gray-400">
    Built on <a href="https://immich.app" target="_blank" rel="noopener noreferrer" class="underline">Immich</a>
  </p>
</section>
