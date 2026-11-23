<script lang="ts">
  // family fork: generations above and below one person; click anyone to centre on them, and add
  // relatives right where the gaps are
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import AddRelative, { type RelativeKind } from '#lib/family/AddRelative.svelte';
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import { familyState } from '#lib/family/family-state.svelte.ts';
  import { lifespan } from '#lib/family/format.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { updateFamilyPerson, type FamilyPersonResponseDto } from '@immich/sdk';
  import { Alert, Button, Heading, Input, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  onMount(() => void familyState.load());

  const people = $derived(data.people ?? []);
  const byId = $derived(new Map(people.map((person) => [person.id, person])));
  const named = $derived(people.filter((person) => person.name).sort((a, b) => a.name.localeCompare(b.name)));
  const iAmLinked = $derived(people.some((person) => person.linkedUserId === authManager.user.id));

  let adding = $state<RelativeKind | null>(null);
  let search = $state('');

  const addButtons: Array<{ kind: RelativeKind; label: string }> = [
    { kind: 'parent', label: 'Parent' },
    { kind: 'spouse', label: 'Partner' },
    { kind: 'sibling', label: 'Sibling' },
    { kind: 'child', label: 'Child' },
  ];

  const rows = $derived.by(() => {
    const pick = (match: (key: string) => boolean) =>
      data.relatives
        .filter((relative) => match(relative.key))
        .map((relative) => ({ person: byId.get(relative.personId), label: relative.label }))
        .filter((item): item is { person: FamilyPersonResponseDto; label: string } => !!item.person);

    return [
      { title: 'Great-grandparents and older', focus: false, items: pick((key) => key.endsWith('great-grandparent')) },
      { title: 'Grandparents', focus: false, items: pick((key) => key === 'grandparent') },
      {
        title: 'Parents, aunts and uncles',
        focus: false,
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
        focus: false,
        items: pick(
          (key) => ['child', 'adopted-child', 'step-child', 'child-in-law'].includes(key) || key === 'niece-nephew',
        ),
      },
      { title: 'Grandchildren', focus: false, items: pick((key) => key === 'grandchild') },
      {
        title: 'Great-grandchildren and younger',
        focus: false,
        items: pick((key) => key.endsWith('great-grandchild')),
      },
    ].filter((row) => row.items.length > 0);
  });

  const pickable = $derived(named.filter((person) => person.name.toLowerCase().includes(search.trim().toLowerCase())));

  const choose = async (person: FamilyPersonResponseDto, isMe: boolean) => {
    if (isMe) {
      try {
        await updateFamilyPerson({ id: person.id, familyPersonUpdateDto: { linkedUserId: authManager.user.id } });
      } catch (error) {
        handleError(error, 'Could not save');
        return;
      }
    }
    await goto(Route.familyTree({ focus: person.id }));
  };

  const added = async () => {
    adding = null;
    await invalidateAll();
  };
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-6xl flex-col gap-6 pb-16">
    {#if !data.people}
      <Alert color="secondary" title="You're not in a family library yet." />
    {:else if named.length === 0}
      <Alert color="secondary" title="No one has been named yet. Name people on the People page to start the tree." />
      <div><Button href={Route.familyPeople()} shape="round">People</Button></div>
    {:else if !data.focus}
      <!-- nobody chosen and no "this is me": ask, never guess -->
      <div class="flex flex-col gap-2">
        <Heading size="medium">Who are you?</Heading>
        <Text color="muted">Choose yourself to see your family around you, or pick anyone to explore theirs.</Text>
      </div>
      <div class="max-w-sm"><Input bind:value={search} placeholder="Find someone" /></div>
      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each pickable as person (person.id)}
          <li class="flex flex-col items-center gap-2 p-3 text-center">
            <button type="button" class="flex flex-col items-center gap-2" onclick={() => choose(person, false)}>
              <FamilyFace id={person.id} name={person.name} hasPhotos={person.faceCount > 0} class="size-20" />
              <Text size="small" fontWeight="semi-bold">{person.name}</Text>
            </button>
            {#if familyState.canContribute && !iAmLinked && !person.linkedUserId}
              <Button size="tiny" variant="outline" shape="round" onclick={() => choose(person, true)}
                >This is me</Button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="flex flex-wrap items-center gap-3">
        <Text color="muted" class="flex-1">Click anyone to see the family around them.</Text>
        <Button href="/family/tree?choose" variant="ghost" size="small" shape="round">Choose someone else</Button>
      </div>

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
                  <FamilyFace
                    id={item.person.id}
                    name={item.person.name}
                    hasPhotos={item.person.faceCount > 0}
                    class="size-16"
                    textClass="text-xl"
                  />
                  <Text size="small" fontWeight="semi-bold">{item.person.name || 'Unnamed'}</Text>
                  {#if item.label}<Text size="tiny" color="muted">{item.label}</Text>{/if}
                  {#if lifespan(item.person)}<Text size="tiny" color="muted">{lifespan(item.person)}</Text>{/if}
                </a>
              </li>
            {/each}
          </ul>
          {#if row.focus && familyState.canContribute}
            <!-- add relatives where they belong in the tree -->
            <div class="flex flex-wrap justify-center gap-2 pt-1">
              {#each addButtons as button (button.kind)}
                <Button size="tiny" variant="outline" shape="round" onclick={() => (adding = button.kind)}>
                  + {button.label}
                </Button>
              {/each}
            </div>
            {#if adding}
              <div class="w-full max-w-xl">
                <AddRelative
                  person={data.focus}
                  {people}
                  kind={adding}
                  onCancel={() => (adding = null)}
                  onDone={added}
                />
              </div>
            {/if}
          {/if}
        </section>
        {#if index < rows.length - 1}
          <div class="mx-auto h-6 w-px bg-gray-300 dark:bg-gray-600"></div>
        {/if}
      {/each}

      {#if data.relatives.length === 0}
        <Alert color="secondary" title={`No relatives recorded for ${data.focus.name || 'them'} yet.`}>
          <Text size="small">
            {familyState.canContribute
              ? 'Use the buttons under their name to add parents, a partner, siblings or children. Grandparents, cousins and in-laws fill in by themselves.'
              : 'Family members who can edit will add them.'}
          </Text>
        </Alert>
      {/if}
    {/if}
  </div>
</UserPageLayout>
