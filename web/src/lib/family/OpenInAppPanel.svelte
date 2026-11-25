<script lang="ts">
  // family fork: "Open in the App". Makes a one-time sign-in code and shows it as a button on a phone,
  // or as a QR code to scan with a phone on a computer. The app opens signed in to this server.
  import Qrcode from '#lib/components/shared-components/Qrcode.svelte';
  import {
    APP_LOGIN_MINUTES,
    createFamilyAppLoginCode,
    isMobileDevice,
    type FamilyAppLoginCodeResponseDto,
  } from '#lib/family/app-login.ts';
  import { getServerErrorMessage } from '#lib/utils/handle-error.ts';
  import { Alert, Button, Stack, Text } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';

  let login = $state<FamilyAppLoginCodeResponseDto | null>(null);
  let loading = $state(false);
  let expired = $state(false);
  let errorMessage = $state('');
  let mobile = $state(false);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  const makeCode = async () => {
    loading = true;
    errorMessage = '';
    clearTimeout(expiryTimer);
    try {
      login = await createFamilyAppLoginCode();
      expired = false;
      // the server refuses the code after this, so stop offering it rather than let a scan fail
      expiryTimer = setTimeout(() => (expired = true), new Date(login.expiresAt).getTime() - Date.now());
    } catch (error) {
      login = null;
      errorMessage =
        getServerErrorMessage(error) || (error instanceof Error ? error.message : '') || 'Could not make a code';
    } finally {
      loading = false;
    }
  };

  onMount(() => {
    mobile = isMobileDevice(navigator.userAgent, navigator.maxTouchPoints);
    void makeCode();
  });

  onDestroy(() => clearTimeout(expiryTimer));
</script>

<Stack gap={3}>
  {#if errorMessage}
    <Alert color="danger" title={errorMessage} />
  {:else if login && !expired}
    {#if mobile}
      <Text size="small">Opens the app on this phone, already signed in.</Text>
      <!--
        The sibred:// link rather than the https one: iOS doesn't hand a link to an app when it's tapped on
        a page of the same site, so the https link would just open this website again.
      -->
      <div><Button href={login.appUrl} shape="round" size="large">Open in the App</Button></div>
    {:else}
      <div class="flex flex-col items-center gap-2 self-start">
        <Qrcode value={login.url} width={220} alt="QR code that signs the app in" />
        <Text size="small" fontWeight="semi-bold">Scan with your iPhone camera</Text>
      </div>
    {/if}
    <Text size="small" color="muted">This works once and expires in {APP_LOGIN_MINUTES} minutes.</Text>
  {:else if expired}
    <Text size="small" color="muted">That code has expired. Make a new one.</Text>
  {/if}

  <div>
    <Button size="small" variant="outline" shape="round" {loading} onclick={makeCode}>New code</Button>
  </div>
</Stack>
