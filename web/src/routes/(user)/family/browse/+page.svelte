<script lang="ts">
  // family fork: photos of a group of people
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import { Route } from '#lib/route.ts';
  import { getAssetMediaUrl } from '#lib/utils.ts';
  import { AssetMediaSize } from '@immich/sdk';
  import { Text } from '@immich/ui';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <div class="pb-16">
    {#if data.assets.length === 0}
      <Text color="muted">No photos found.</Text>
    {:else}
      <Text size="small" color="muted" class="mb-4">{data.assets.length} photos</Text>
      <ul class="grid grid-cols-3 gap-1 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {#each data.assets as asset (asset.id)}
          <li>
            <a
              href={Route.viewAsset(asset)}
              class="block aspect-square overflow-hidden rounded-sm bg-gray-100 dark:bg-gray-800"
            >
              <img
                src={getAssetMediaUrl({ id: asset.id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash })}
                alt=""
                class="size-full object-cover"
                loading="lazy"
              />
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</UserPageLayout>
