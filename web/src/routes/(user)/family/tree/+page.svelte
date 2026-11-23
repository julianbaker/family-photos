<script lang="ts">
  // family fork: generations above and below one person; click anyone to centre on them
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import { lifespan } from '#lib/family/format.ts';
  import { Route } from '#lib/route.ts';
  import { getPeopleThumbnailPath, type FamilyPersonResponseDto } from '@immich/sdk';
  import { Alert, Button, Text } from '@immich/ui';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  const byId = $derived(new Map((data.people ?? []).map((person) => [person.id, person])));

  const rows = $derived.by(() => {
    const relatives = data.relatives;
    const pick = (match: (key: string) => boolean) =>
      relatives
        .filter((relative) => match(relative.key))
        .map((relative) => ({ person: byId.get(relative.personId), label: relative.label }))
        .filter((item): item is { person: FamilyPersonResponseDto; label: string } => !!item.person);

    return [
      { title: 'Great-grandparents and older', items: pick((key) => key.endsWith('great-grandparent')) },
      { title: 'Grandparents', items: pick((key) => key === 'grandparent') },
      {
        title: 'Parents, aunts and uncles',
        items: pick((key) => ['parent', 'adoptive-parent', 'step-parent'].includes(key) || key === 'aunt-uncle'),
      },
      {
        title: '',
        focus: true,
        items: [
          ...(data.focus ? [{ person: data.focus, label: '' }] : []),
          ...pick((key) => key === 'spouse' || key === 'former-spouse'),
          ...pick((key) => ['sibling', 'half-sibling', 'step-sibling'].includes(key)),
          ...pick((key) => key === 'cousin' || key.startsWith('sibling-in-law')),
        ],
      },
      {
        title: 'Children, nieces and nephews',
        items: pick(
          (key) => ['child', 'adopted-child', 'step-child', 'child-in-law'].includes(key) || key === 'niece-nephew',
        ),
      },
      { title: 'Grandchildren', items: pick((key) => key === 'grandchild') },
      { title: 'Great-grandchildren and younger', items: pick((key) => key.endsWith('great-grandchild')) },
    ].filter((row) => row.items.length > 0);
  });
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-6xl flex-col gap-6 pb-16">
    {#if !data.focus}
      <Alert color="secondary" title="No one in the family tree yet. Name people or add them on the People page." />
      <div><Button href={Route.familyPeople()} shape="round">Family people</Button></div>
    {:else}
      <Text color="muted">Click anyone to see the family around them.</Text>
      {#each rows as row, index (index)}
        <section class="flex flex-col items-center gap-2">
          {#if row.title}
            <Text size="tiny" color="muted" class="tracking-wide uppercase">{row.title}</Text>
          {/if}
          <ul class="flex flex-wrap justify-center gap-3">
            {#each row.items as item (item.person.id)}
              {const isFocus = $derived(item.person.id === data.focus.id)}
              <li>
                <a
                  href={isFocus
                    ? Route.familyPerson({ id: item.person.id })
                    : Route.familyTree({ focus: item.person.id })}
                  class="flex w-32 flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  class:ring-2={isFocus}
                  class:ring-primary={isFocus}
                >
                  {#if item.person.faceCount > 0}
                    <img
                      src={getPeopleThumbnailPath(item.person.id)}
                      alt=""
                      class="size-16 rounded-full object-cover"
                      loading="lazy"
                    />
                  {:else}
                    <div
                      class="flex size-16 items-center justify-center rounded-full bg-gray-200 text-xl font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                    >
                      {(item.person.name || '?').slice(0, 1)}
                    </div>
                  {/if}
                  <Text size="small" fontWeight="semi-bold">{item.person.name || 'Unnamed'}</Text>
                  {#if item.label}<Text size="tiny" color="muted">{item.label}</Text>{/if}
                  {#if lifespan(item.person)}<Text size="tiny" color="muted">{lifespan(item.person)}</Text>{/if}
                </a>
              </li>
            {/each}
          </ul>
        </section>
        {#if index < rows.length - 1}
          <div class="mx-auto h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
        {/if}
      {/each}
    {/if}
  </div>
</UserPageLayout>
