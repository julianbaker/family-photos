<script lang="ts">
  // family fork: a one-time sign-in link opened in a browser. Offers the app again through its own
  // sibred:// link, which names this server, and where to get the app.
  import AuthPageLayout from '#lib/components/layouts/AuthPageLayout.svelte';
  import { APP_LOGIN_MINUTES, isMobileDevice, sibredAppUrl } from '#lib/family/app-login.ts';
  import { Alert, Button, Link, Stack, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  let mobile = $state(true);
  onMount(() => {
    mobile = isMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
  });

  const appUrl = $derived(data.code ? sibredAppUrl(location.origin, data.code) : '');
</script>

<AuthPageLayout title={data.meta.title}>
  <Stack gap={4}>
    {#if !data.code}
      <Alert color="danger" title="This sign-in link is missing its code. Check that you copied the whole link." />
    {:else}
      <Text>This link signs the sibred app in to this photo library, so you don't have to type the server address.</Text
      >

      {#if mobile}
        <Button href={appUrl} shape="round" size="large" fullWidth>Open in sibred</Button>
        {#if data.storeUrl}
          <Text size="small">
            Don't have the app yet? <Link href={data.storeUrl}>Get the app</Link>, then come back and tap Open in
            sibred.
          </Text>
        {/if}
      {:else}
        <Text>Open this link on your iPhone, or scan the QR code shown on the website with your iPhone camera.</Text>
        {#if data.storeUrl}
          <Text size="small"><Link href={data.storeUrl}>Get the app</Link></Text>
        {/if}
      {/if}

      <Text size="small" color="muted">
        The link works once and expires {APP_LOGIN_MINUTES} minutes after it was made. If it doesn't work, make a new one
        on the website.
      </Text>
    {/if}
  </Stack>
</AuthPageLayout>
