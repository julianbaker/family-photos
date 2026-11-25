<script lang="ts">
  // family fork: sign-up page for an invite link
  import AuthPageLayout from '#lib/components/layouts/AuthPageLayout.svelte';
  import OpenInAppPanel from '#lib/family/OpenInAppPanel.svelte';
  import type { FamilyInvitePreviewWithPersonDto } from '#lib/family/app-login.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { eventManager } from '#lib/managers/event-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { getServerErrorMessage } from '#lib/utils/handle-error.ts';
  import { FamilyInviteStatus, FamilyRole, acceptFamilyInvite, type LoginResponseDto } from '@immich/sdk';
  import { Alert, Button, Field, Input, Link, PasswordInput, Stack, Text } from '@immich/ui';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let errorMessage = $state('');
  let loading = $state(false);
  // set once the account is made: the next step offers the app before going on to the photos
  let joined = $state<LoginResponseDto | null>(null);
  let continuing = $state(false);

  const preview = $derived(data.preview as FamilyInvitePreviewWithPersonDto | null);
  const passwordsMatch = $derived(password === confirmPassword);
  const canSubmit = $derived(!!name.trim() && !!email.trim() && password.length >= 8 && passwordsMatch);

  const roleText: Record<FamilyRole, string> = {
    [FamilyRole.Admin]: 'as an admin',
    [FamilyRole.Member]: 'as a member: you can add photos and help name people',
    [FamilyRole.Viewer]: 'as a viewer: you can look at and download photos',
  };

  const invalidText: Record<FamilyInviteStatus, string> = {
    [FamilyInviteStatus.Active]: '',
    [FamilyInviteStatus.Expired]: 'This invite link has expired. Ask whoever sent it for a new one.',
    [FamilyInviteStatus.UsedUp]: 'This invite link has already been used. Ask whoever sent it for a new one.',
    [FamilyInviteStatus.Revoked]: 'This invite link has been turned off. Ask whoever sent it for a new one.',
  };

  const onsubmit = async (event: Event) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    errorMessage = '';
    loading = true;
    try {
      joined = await acceptFamilyInvite({
        familyInviteAcceptDto: { token: data.token, name: name.trim(), email: email.trim(), password },
      });
    } catch (error) {
      errorMessage = getServerErrorMessage(error) || 'Something went wrong. Please try again.';
    } finally {
      loading = false;
    }
  };

  const onContinue = async () => {
    if (!joined) {
      return;
    }
    continuing = true;
    if (joined.isOnboarded) {
      await goto(Route.photos(), { refreshAll: true });
      eventManager.emit('AuthLogin', joined);
    } else {
      await goto(Route.onboarding());
    }
  };
</script>

<AuthPageLayout title={data.meta.title}>
  <Stack gap={4}>
    {#if joined}
      <Text>You've joined the {preview?.familyName ?? 'family'} photo library.</Text>
      <Text fontWeight="semi-bold">Got an iPhone? Open the app, already signed in.</Text>
      <OpenInAppPanel />
      <Button shape="round" fullWidth loading={continuing} onclick={onContinue} class="mt-2">
        Continue to the photos
      </Button>
    {:else if !preview}
      <Alert color="danger" title="This invite link doesn't work. Check that you copied the whole link." />
    {:else if authManager.authenticated}
      <Text>You're already signed in.</Text>
      <Button href={Route.photos()} shape="round" fullWidth>Go to the photos</Button>
    {:else if !preview.valid}
      <Alert color="warning" title={invalidText[preview.status]} />
    {:else}
      <Text>You've been invited to the {preview.familyName} photo library, {roleText[preview.role]}.</Text>
      {#if preview.personName}
        <Text>You've been invited as {preview.personName}.</Text>
      {/if}

      {#if preview.appUrl}
        <Text size="small">
          On an iPhone? <Link href={preview.appUrl}>Get the app</Link>, then open this link again.
        </Text>
      {/if}

      <form {onsubmit} class="flex flex-col gap-4">
        {#if errorMessage}
          <Alert color="danger" title={errorMessage} closable />
        {/if}

        <Field label="Your name" required="indicator">
          <Input id="name" name="name" autocomplete="name" bind:value={name} />
        </Field>

        <Field label="Email" required="indicator" description="You'll use this to sign in.">
          <Input id="email" name="email" type="email" autocomplete="email" bind:value={email} />
        </Field>

        <Field label="Password" required="indicator" description="At least 8 characters.">
          <PasswordInput id="password" autocomplete="new-password" bind:value={password} />
        </Field>

        <Field label="Confirm password" required="indicator">
          <PasswordInput id="confirm-password" autocomplete="new-password" bind:value={confirmPassword} />
        </Field>

        {#if confirmPassword && !passwordsMatch}
          <Text size="small" color="danger">The passwords don't match.</Text>
        {/if}

        <Button type="submit" size="large" shape="round" fullWidth {loading} disabled={!canSubmit} class="mt-2">
          Join the family library
        </Button>
      </form>
    {/if}
  </Stack>
</AuthPageLayout>
