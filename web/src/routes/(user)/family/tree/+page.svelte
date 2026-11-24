<script lang="ts">
  // family fork: the family tree. First visit: "who are you?"; then the tree canvas around a person.
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import { familyState } from '#lib/family/family-state.svelte.ts';
  import { bySurname } from '#lib/family/format.ts';
  import FamilyTree from '#lib/family/tree/FamilyTree.svelte';
  import PersonPicker from '#lib/family/tree/PersonPicker.svelte';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { getFamilyPeople, getFamilyRelations, updateFamilyPerson, type FamilyPersonResponseDto } from '@immich/sdk';
  import { Alert, Button, Heading, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  onMount(() => void familyState.load());

  // the page owns the data; the tree re-centres without reloading anything
  let people = $state(data.people ?? []);
  let relations = $state(data.relations);
  let focusId = $state<string | null>(data.focusId);
  let meId = $state<string | null>(data.meId);

  $effect(() => {
    // a new load (e.g. ?choose, or a link to someone) replaces the local state
    people = data.people ?? [];
    relations = data.relations;
    focusId = data.focusId;
    meId = data.meId;
  });

  const named = $derived(people.filter((person) => person.name).sort(bySurname));

  const focusOn = (id: string) => {
    focusId = id;
    const url = new URL(location.href);
    url.searchParams.delete('choose');
    url.searchParams.set('focus', id);
    // update the address without a navigation, so Back and shared links keep working
    void replaceState(url, {});
  };

  const reload = async () => {
    const [nextPeople, nextRelations] = await Promise.all([getFamilyPeople(), getFamilyRelations()]);
    people = nextPeople;
    relations = nextRelations;
    meId = nextPeople.find((person) => person.linkedUserId === authManager.user.id)?.id ?? null;
  };

  const chooseMe = async (person: FamilyPersonResponseDto) => {
    try {
      await updateFamilyPerson({ id: person.id, familyPersonUpdateDto: { linkedUserId: authManager.user.id } });
      await reload();
      focusOn(person.id);
    } catch (error) {
      handleError(error, 'Could not save');
    }
  };
</script>

<UserPageLayout title={data.meta.title} scrollbar={false}>
  {#if !data.people}
    <div class="mx-auto max-w-3xl"><Alert color="secondary" title="You're not in a family library yet." /></div>
  {:else if named.length === 0}
    <div class="mx-auto flex max-w-3xl flex-col gap-4">
      <Alert color="secondary" title="No one has been named yet. Name people on the People page to start the tree." />
      <div><Button href={Route.familyPeople()} shape="round">People</Button></div>
    </div>
  {:else if !focusId}
    <!-- nobody chosen and no "this is me": ask, never guess -->
    <div class="mx-auto flex max-w-5xl flex-col gap-6 pb-16">
      <div class="flex flex-col gap-2">
        <Heading size="medium">Who are you?</Heading>
        <Text color="muted">Find yourself to see your family around you, or choose anyone to explore theirs.</Text>
      </div>
      <div class="max-w-md">
        <PersonPicker
          people={named}
          placeholder="Type a name"
          allowNew={false}
          onPick={(person) => focusOn(person.id)}
        />
      </div>
      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {#each named as person (person.id)}
          <li class="flex flex-col items-center gap-2 p-2 text-center">
            <button type="button" class="flex flex-col items-center gap-2" onclick={() => focusOn(person.id)}>
              <FamilyFace id={person.id} name={person.name} hasPhotos={person.faceCount > 0} class="size-20" />
              <Text size="small" fontWeight="semi-bold">{person.name}</Text>
            </button>
            {#if familyState.canContribute && !meId && !person.linkedUserId}
              <Button size="tiny" variant="outline" shape="round" onclick={() => chooseMe(person)}>This is me</Button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <FamilyTree
      {people}
      {relations}
      {focusId}
      {meId}
      canEdit={familyState.canContribute}
      myUserId={authManager.user.id}
      onFocus={focusOn}
      onChanged={reload}
    />
  {/if}
</UserPageLayout>
