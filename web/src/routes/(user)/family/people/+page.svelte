<script lang="ts">
  // family fork: everyone in the family tree, with or without photos
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import { familyState } from '#lib/family/family-state.svelte.ts';
  import { bySurname, lifespan } from '#lib/family/format.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { createFamilyPerson, FamilyPersonKind, type FamilyPersonResponseDto } from '@immich/sdk';
  import { Alert, Button, Field, Input, Stack, Text } from '@immich/ui';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  let search = $state('');
  let newName = $state('');
  let newKind = $state<FamilyPersonKind>(FamilyPersonKind.Person);
  let adding = $state(false);

  onMount(() => void familyState.load());

  const people = $derived(
    (data.people ?? []).filter((person) => person.name.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const named = $derived(
    people.filter((person) => person.name && person.kind === FamilyPersonKind.Person).sort(bySurname),
  );
  const unnamedCount = $derived(
    people.filter((person) => !person.name && person.kind === FamilyPersonKind.Person).length,
  );
  // pets found by pet recognition start without a name; show them so someone can name them
  const pets = $derived(
    (data.people ?? [])
      .filter((person) => person.kind === FamilyPersonKind.Pet)
      .filter((person) => !search.trim() || person.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => (a.name && b.name ? a.name.localeCompare(b.name) : a.name ? -1 : b.name ? 1 : b.faceCount - a.faceCount)),
  );
  const petLabel = (pet: FamilyPersonResponseDto) => pet.name || 'Name this pet';

  const onAdd = async (event: Event) => {
    event.preventDefault();
    if (!newName.trim()) {
      return;
    }
    adding = true;
    try {
      const person = await createFamilyPerson({ familyPersonCreateDto: { name: newName.trim(), kind: newKind } });
      await goto(Route.familyPerson({ id: person.id }));
    } catch (error) {
      handleError(error, 'Could not add the person');
      adding = false;
    }
  };
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-5xl flex-col gap-8 pb-16">
    {#if !data.people}
      <Alert color="secondary" title="You're not in a family library yet." />
    {:else}
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-60 flex-1">
          <Field label="Find someone">
            <Input bind:value={search} placeholder="Name" />
          </Field>
        </div>
        <Button href={Route.familyTree()} variant="outline" shape="round">Family tree</Button>
      </div>

      <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {#each named as person (person.id)}
          <li>
            <a
              href={Route.familyPerson({ id: person.id })}
              class="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <FamilyFace id={person.id} name={person.name} hasPhotos={person.faceCount > 0} />
              <Text fontWeight="semi-bold">{person.name}</Text>
              {#if person.relationToMe}
                <Text size="small" color="muted">
                  {person.relationToMe.key === 'self' ? 'You' : `Your ${person.relationToMe.label}`}
                </Text>
              {/if}
              {#if lifespan(person)}
                <Text size="tiny" color="muted">{lifespan(person)}</Text>
              {/if}
            </a>
          </li>
        {/each}
      </ul>

      {#if pets.length > 0}
        <section class="flex flex-col gap-3">
          <Text size="large" fontWeight="semi-bold">Pets</Text>
          <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {#each pets as pet (pet.id)}
              <li>
                <a
                  href={Route.familyPerson({ id: pet.id })}
                  class="flex flex-col items-center gap-2 rounded-xl p-3 text-center transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <FamilyFace id={pet.id} name={pet.name} hasPhotos={pet.faceCount > 0} />
                  <Text fontWeight="semi-bold" color={pet.name ? undefined : 'primary'}>{petLabel(pet)}</Text>
                  <Text size="tiny" color="muted">
                    {pet.faceCount === 1 ? '1 photo' : `${pet.faceCount} photos`}{lifespan(pet) ? ` · ${lifespan(pet)}` : ''}
                  </Text>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if unnamedCount > 0}
        <Text size="small" color="muted">
          {unnamedCount} more {unnamedCount === 1 ? 'person has' : 'people have'} no name yet. Name and merge faces on the
          <a href={Route.people()} class="underline">faces</a> page.
        </Text>
      {/if}

      {#if familyState.canContribute}
        <section class="rounded-xl border p-4 dark:border-gray-700">
          <form onsubmit={onAdd}>
            <Stack gap={3}>
              <Text fontWeight="semi-bold">Add someone without photos</Text>
              <Text size="small" color="muted"
                >For example a grandparent or great-grandparent, or a much-loved dog, so they can be in the tree.</Text
              >
              <div class="flex flex-wrap gap-2">
                <div class="min-w-60 flex-1"><Input bind:value={newName} placeholder="Their name" /></div>
                <select
                  bind:value={newKind}
                  aria-label="Person or pet"
                  class="rounded-xl border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
                  <option value={FamilyPersonKind.Person}>Person</option>
                  <option value={FamilyPersonKind.Pet}>Pet</option>
                </select>
                <Button type="submit" shape="round" loading={adding} disabled={!newName.trim()}>Add</Button>
              </div>
            </Stack>
          </form>
        </section>
      {/if}

      {#if familyState.canContribute}
        <section class="flex flex-wrap items-center gap-3 rounded-xl border p-4 dark:border-gray-700">
          <div class="min-w-60 flex-1">
            <Text fontWeight="semi-bold">Invite someone to the family</Text>
            <Text size="small" color="muted">
              {familyState.isAdmin
                ? 'Make an invite link, or approve requests from the family.'
                : 'Ask for an invite and an admin will approve it.'}
            </Text>
          </div>
          <Button href={Route.family()} shape="round" variant="outline">
            {familyState.isAdmin ? 'Family Settings' : 'Ask for an Invite'}
          </Button>
        </section>
      {/if}
    {/if}
  </div>
</UserPageLayout>
