<script lang="ts">
  import { branding } from '#lib/family/branding.svelte.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { hideBackupsReminder } from '#lib/stores/preferences.store.ts';
  import { ImmichBackupsSidebarItem } from '@futo-org/backups-orchestrator-ui';
  import PurchaseInfo from './PurchaseInfo.svelte';
  import ServerStatus from './ServerStatus.svelte';
  import StorageSpace from './StorageSpace.svelte';
</script>

<div class="ms-4 mt-auto overflow-hidden rounded-lg">
  <StorageSpace />

  {#if authManager.user.isAdmin && featureFlagsManager.value.backups && !$hideBackupsReminder}
    <ImmichBackupsSidebarItem href={Route.backups()} />
  {/if}
</div>

<PurchaseInfo />

<div class="mt-2 mb-6">
  <ServerStatus />
  <!-- family fork: credit where it's due (AGPL) -->
  <p class="ms-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
    {branding.wordmark} · Built on
    <a href="https://immich.app" target="_blank" rel="noopener noreferrer" class="underline">Immich</a>
  </p>
</div>
