<script lang="ts">
  // family fork: a person's face, or the first letter of their name when there is no photo
  // (or the image fails to load), so a missing face never shows as a broken image.
  // getPeopleThumbnailUrl adds the /api prefix; the bare SDK path (getPeopleThumbnailPath) loads a
  // website page instead of the image, which is why every family face used to be broken.
  import { getPeopleThumbnailUrl } from '#lib/utils.ts';
  import type { PersonResponseDto } from '@immich/sdk';

  type Props = { id: string; name: string; hasPhotos: boolean; class?: string; textClass?: string };
  let { id, name, hasPhotos, class: className = 'size-24', textClass = 'text-3xl' }: Props = $props();

  let failed = $state(false);
  const initial = $derived(name.slice(0, 1) || '?');
</script>

{#if hasPhotos && !failed}
  <img
    src={getPeopleThumbnailUrl({ id } as PersonResponseDto, '')}
    alt=""
    class="{className} shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-700"
    loading="lazy"
    onerror={() => (failed = true)}
  />
{:else}
  <div
    class="{className} {textClass} flex shrink-0 items-center justify-center rounded-full bg-gray-200 font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300"
    aria-hidden="true"
  >
    {initial}
  </div>
{/if}
