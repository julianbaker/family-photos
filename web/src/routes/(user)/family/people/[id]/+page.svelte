<script lang="ts">
  // family fork: one person's details, bio, relations and relatives
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import AddRelative, { type RelativeKind } from '#lib/family/AddRelative.svelte';
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import PartialDateInput from '#lib/family/PartialDateInput.svelte';
  import { renderBio } from '#lib/family/bio.ts';
  import { familyState } from '#lib/family/family-state.svelte.ts';
  import { BROWSE_KEYS, RELATIVE_GROUPS, bySurname, formatDate, lifespan } from '#lib/family/format.ts';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    FamilyGender,
    FamilyRelationQualifier,
    FamilyRelationType,
    createFamilyRelation,
    deleteFamilyRelation,
    mergePeople,
    updateFamilyPerson,
    type FamilyRelationResponseDto,
  } from '@immich/sdk';
  import { Alert, Badge, Button, Field, Heading, Input, Select, Stack, Text, Textarea } from '@immich/ui';
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  onMount(() => void familyState.load());

  const person = $derived(data.person);
  const names = $derived(new Map(data.people.map((item) => [item.id, item.name || 'Unnamed'])));
  const isMe = $derived(person.linkedUserId === authManager.user.id);
  const linkedElsewhere = $derived(
    data.people.some((item) => item.id !== person.id && item.linkedUserId === authManager.user.id),
  );

  // editing
  let editing = $state(false);
  let name = $state('');
  let birthDate = $state('');
  let deathDate = $state('');
  let gender = $state<'' | FamilyGender>('');
  let bio = $state('');
  let saving = $state(false);

  const startEditing = () => {
    name = person.name;
    birthDate = person.birthDate ?? '';
    deathDate = person.deathDate ?? '';
    gender = person.gender ?? '';
    bio = person.bio ?? '';
    editing = true;
  };

  const save = async (event: Event) => {
    event.preventDefault();
    saving = true;
    try {
      await updateFamilyPerson({
        id: person.id,
        familyPersonUpdateDto: {
          name: name.trim() || undefined,
          birthDate: birthDate || null,
          deathDate: deathDate || null,
          gender: gender || null,
          bio: bio.trim() || null,
        },
      });
      editing = false;
      await invalidateAll();
    } catch (error) {
      handleError(error, 'Could not save');
    } finally {
      saving = false;
    }
  };

  // merging: duplicates of the same person (same name, or chosen by hand). The person on this page
  // is kept; the other's faces, relations and missing details move onto them, for every member.
  const duplicates = $derived(
    person.name
      ? data.people.filter(
          (item) => item.id !== person.id && item.name.trim().toLowerCase() === person.name.trim().toLowerCase(),
        )
      : [],
  );
  let mergeId = $state('');
  let merging = $state(false);

  const merge = async (otherId: string) => {
    const other = data.people.find((item) => item.id === otherId);
    const label = other?.name || 'this person';
    if (
      !confirm(
        `Merge ${label} into ${person.name || 'this person'}? Their photos and relations move here, for everyone.`,
      )
    ) {
      return;
    }
    merging = true;
    try {
      await mergePeople({ mergePersonDto: { ids: [person.id, otherId] } });
      mergeId = '';
      await invalidateAll();
      await goto(Route.familyPerson({ id: person.id }), { invalidateAll: true });
    } catch (error) {
      handleError(error, 'Could not merge');
    } finally {
      merging = false;
    }
  };

  const setMe = async (linked: boolean) => {
    try {
      await updateFamilyPerson({
        id: person.id,
        familyPersonUpdateDto: { linkedUserId: linked ? authManager.user.id : null },
      });
      await invalidateAll();
    } catch (error) {
      handleError(error, 'Could not update');
    }
  };

  const setHidden = async (isHidden: boolean) => {
    try {
      await updateFamilyPerson({ id: person.id, familyPersonUpdateDto: { isHidden } });
      await invalidateAll();
    } catch (error) {
      handleError(error, isHidden ? 'Could not hide them' : 'Could not show them again');
    }
  };

  // quick add, like the tree: parent, partner, sibling, child
  let quickAdd = $state<RelativeKind | null>(null);
  const quickButtons: Array<{ kind: RelativeKind; label: string }> = [
    { kind: 'parent', label: 'Parent' },
    { kind: 'spouse', label: 'Partner' },
    { kind: 'sibling', label: 'Sibling' },
    { kind: 'child', label: 'Child' },
  ];

  // relations
  type Choice = 'parent' | 'child' | 'spouse' | 'sibling' | 'godparent' | 'godchild' | 'friend' | 'custom';
  const choices: Array<{ value: Choice; label: string }> = [
    { value: 'parent', label: 'Parent' },
    { value: 'child', label: 'Child' },
    { value: 'spouse', label: 'Spouse or partner' },
    { value: 'sibling', label: 'Brother or sister' },
    { value: 'godparent', label: 'Godparent' },
    { value: 'godchild', label: 'Godchild' },
    { value: 'friend', label: 'Friend' },
    { value: 'custom', label: 'Something else' },
  ];
  const qualifiers: Partial<Record<Choice, Array<{ value: string; label: string }>>> = {
    parent: [
      { value: '', label: 'Birth parent' },
      { value: FamilyRelationQualifier.Adopted, label: 'Adoptive parent' },
      { value: FamilyRelationQualifier.Step, label: 'Step-parent' },
    ],
    child: [
      { value: '', label: 'Birth child' },
      { value: FamilyRelationQualifier.Adopted, label: 'Adopted child' },
      { value: FamilyRelationQualifier.Step, label: 'Stepchild' },
    ],
    sibling: [
      { value: '', label: 'Full sibling' },
      { value: FamilyRelationQualifier.Half, label: 'Half-sibling' },
      { value: FamilyRelationQualifier.Step, label: 'Step-sibling' },
      { value: FamilyRelationQualifier.Adopted, label: 'Adopted sibling' },
    ],
    spouse: [
      { value: '', label: 'Current' },
      { value: FamilyRelationQualifier.Former, label: 'Former' },
    ],
  };

  let choice = $state<Choice>('parent');
  let qualifier = $state('');
  let otherId = $state('');
  let customLabel = $state('');
  let addingRelation = $state(false);

  const others = $derived(
    data.people
      .filter((item) => item.id !== person.id && item.name)
      .sort(bySurname)
      .map((item) => ({ value: item.id, label: item.name })),
  );

  const addRelation = async (event: Event) => {
    event.preventDefault();
    if (!otherId) {
      return;
    }
    // "otherId is the <choice> of this person"
    const forward: Record<Choice, { type: FamilyRelationType; otherFirst: boolean }> = {
      parent: { type: FamilyRelationType.Parent, otherFirst: true },
      child: { type: FamilyRelationType.Parent, otherFirst: false },
      spouse: { type: FamilyRelationType.Spouse, otherFirst: true },
      sibling: { type: FamilyRelationType.Sibling, otherFirst: true },
      godparent: { type: FamilyRelationType.Godparent, otherFirst: true },
      godchild: { type: FamilyRelationType.Godparent, otherFirst: false },
      friend: { type: FamilyRelationType.Friend, otherFirst: true },
      custom: { type: FamilyRelationType.Custom, otherFirst: true },
    };
    const { type, otherFirst } = forward[choice];
    addingRelation = true;
    try {
      await createFamilyRelation({
        familyRelationCreateDto: {
          personId: otherFirst ? otherId : person.id,
          relatedPersonId: otherFirst ? person.id : otherId,
          type,
          qualifier: (qualifier || null) as FamilyRelationQualifier | null,
          label: choice === 'custom' ? customLabel.trim() || null : null,
        },
      });
      otherId = '';
      customLabel = '';
      await invalidateAll();
    } catch (error) {
      handleError(error, 'Could not add the relation');
    } finally {
      addingRelation = false;
    }
  };

  const ownRelations = $derived(
    data.relations.filter((relation) => relation.personId === person.id || relation.relatedPersonId === person.id),
  );

  const describe = (relation: FamilyRelationResponseDto) => {
    const other = relation.personId === person.id ? relation.relatedPersonId : relation.personId;
    const otherName = names.get(other) ?? 'Someone';
    const q = relation.qualifier ? `${relation.qualifier} ` : '';
    switch (relation.type) {
      case FamilyRelationType.Parent: {
        return relation.personId === person.id ? `${q}parent of ${otherName}` : `${otherName} is their ${q}parent`;
      }
      case FamilyRelationType.Godparent: {
        return relation.personId === person.id ? `godparent of ${otherName}` : `${otherName} is their godparent`;
      }
      case FamilyRelationType.Custom: {
        return relation.personId === person.id
          ? `${relation.label} to ${otherName}`
          : `${otherName} is their ${relation.label}`;
      }
      default: {
        return `${q}${relation.type} of ${otherName}`;
      }
    }
  };

  const removeRelation = async (relation: FamilyRelationResponseDto) => {
    try {
      await deleteFamilyRelation({ id: relation.id });
      await invalidateAll();
    } catch (error) {
      handleError(error, 'Could not remove the relation');
    }
  };

  const groups = $derived(
    RELATIVE_GROUPS.map((group) => ({
      title: group.title,
      relatives: data.relatives.filter((relative) => group.match(relative.key)),
    })).filter((group) => group.relatives.length > 0),
  );

  const browseLinks = $derived(
    BROWSE_KEYS.map(({ title, keys }) => ({
      title: `Photos of ${person.name || 'them'}'s ${title}`,
      ids: data.relatives.filter((relative) => keys.includes(relative.key)).map((relative) => relative.personId),
    })).filter((link) => link.ids.length > 0),
  );
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-3xl flex-col gap-8 pb-16">
    <header class="flex flex-wrap items-center gap-6">
      <FamilyFace
        id={person.id}
        name={person.name}
        hasPhotos={person.faceCount > 0}
        class="size-28"
        textClass="text-4xl"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <Heading size="large">{person.name || 'Unnamed person'}</Heading>
        {#if person.relationToMe && person.relationToMe.key !== 'self'}
          <Text color="muted">Your {person.relationToMe.label}</Text>
        {/if}
        {#if isMe}
          <Badge color="primary">This is you</Badge>
        {/if}
        {#if person.birthDate}<Text size="small">Born {formatDate(person.birthDate)}</Text>{/if}
        {#if person.deathDate}<Text size="small">Died {formatDate(person.deathDate)}</Text>{/if}
        {#if !person.birthDate && !person.deathDate && lifespan(person)}<Text size="small">{lifespan(person)}</Text
          >{/if}
      </div>
    </header>

    {#if familyState.canContribute && duplicates.length > 0}
      <Alert
        color="warning"
        title={`There ${duplicates.length === 1 ? 'is another' : `are ${duplicates.length} others`} named ${person.name}.`}
      >
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Text size="small" class="me-2">If they're the same person, merge them so everyone sees one.</Text>
          {#each duplicates as duplicate (duplicate.id)}
            <Button size="small" shape="round" loading={merging} onclick={() => merge(duplicate.id)}>
              Merge {duplicate.faceCount > 0 ? `(${duplicate.faceCount} photos)` : ''}
            </Button>
          {/each}
        </div>
      </Alert>
    {/if}

    <div class="flex flex-wrap gap-2">
      {#if person.faceCount > 0}
        <Button href={Route.viewPerson(person)} shape="round">Photos of {person.name || 'them'}</Button>
      {/if}
      <Button href={Route.familyTree({ focus: person.id })} variant="outline" shape="round">Family tree</Button>
      {#if familyState.canContribute && !editing}
        <Button variant="outline" shape="round" onclick={startEditing}>Edit</Button>
        {#if isMe}
          <Button variant="ghost" shape="round" onclick={() => setMe(false)}>This isn't me</Button>
        {:else if !person.linkedUserId && !linkedElsewhere}
          <Button variant="ghost" shape="round" onclick={() => setMe(true)}>This is me</Button>
        {/if}
        <Button variant="ghost" shape="round" onclick={() => setHidden(!person.isHidden)}>
          {person.isHidden ? 'Show in People' : 'Hide from People'}
        </Button>
      {/if}
    </div>

    {#if editing}
      <form onsubmit={save} class="flex flex-col gap-4 rounded-xl border p-4 dark:border-gray-700">
        <Field label="Name"><Input bind:value={name} /></Field>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <PartialDateInput label="Born" bind:value={birthDate} />
          <PartialDateInput label="Died" bind:value={deathDate} />
          <Field label="Gender" description="Only used for words like grandmother">
            <Select
              bind:value={gender}
              options={[
                { value: '', label: 'Not set' },
                { value: FamilyGender.Female, label: 'Female' },
                { value: FamilyGender.Male, label: 'Male' },
              ]}
            />
          </Field>
        </div>
        <Field
          label="About them"
          description="Blank lines start a new paragraph. **bold**, *italic*, [link text](https://…)"
        >
          <Textarea bind:value={bio} rows={8} />
        </Field>
        <div class="flex gap-2">
          <Button type="submit" shape="round" loading={saving}>Save</Button>
          <Button variant="ghost" shape="round" onclick={() => (editing = false)}>Cancel</Button>
        </div>
      </form>
    {:else if person.bio}
      <section class="prose dark:prose-invert max-w-none [&_a]:underline [&_p]:mb-3">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderBio escapes everything and only emits p, br, strong, em and http(s) links -->
        {@html renderBio(person.bio)}
      </section>
    {/if}

    <section>
      <Heading size="small" class="mb-4">Family</Heading>
      {#if groups.length === 0}
        <Text color="muted" class="mb-3">No relatives recorded yet.</Text>
      {/if}
      {#if familyState.canContribute}
        <div class="mb-4 flex flex-wrap gap-2">
          {#each quickButtons as button (button.kind)}
            <Button size="small" variant="outline" shape="round" onclick={() => (quickAdd = button.kind)}>
              + {button.label}
            </Button>
          {/each}
        </div>
        {#if quickAdd}
          <div class="mb-4">
            <AddRelative
              {person}
              people={data.people}
              relations={data.relations}
              kind={quickAdd}
              onCancel={() => (quickAdd = null)}
              onDone={async () => {
                quickAdd = null;
                await invalidateAll();
              }}
            />
          </div>
        {/if}
      {/if}
      {#if groups.length > 0}
        <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {#each groups as group (group.title)}
            <div>
              <Text fontWeight="semi-bold" class="mb-1">{group.title}</Text>
              <ul>
                {#each group.relatives as relative (relative.personId)}
                  <li>
                    <a href={Route.familyPerson({ id: relative.personId })} class="hover:text-primary">
                      <Text size="small"
                        >{relative.name || 'Unnamed'} <span class="text-gray-500">· {relative.label}</span></Text
                      >
                    </a>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    {#if browseLinks.length > 0}
      <section class="flex flex-wrap gap-2">
        {#each browseLinks as link (link.title)}
          <Button
            href={Route.familyBrowse({ people: link.ids.join(','), mode: 'any', title: link.title })}
            variant="outline"
            size="small"
            shape="round">{link.title}</Button
          >
        {/each}
      </section>
    {/if}

    <section>
      {#if familyState.canContribute}
        <div class="mb-8 flex flex-col gap-3 rounded-xl border p-4 dark:border-gray-700">
          <Text fontWeight="semi-bold">Same person as someone else?</Text>
          <Text size="small" color="muted">
            Merge a duplicate into {person.name || 'this person'}: their photos and relations move here, for everyone.
          </Text>
          <div class="flex flex-wrap items-end gap-2">
            <div class="min-w-60 flex-1">
              <Select bind:value={mergeId} options={[{ value: '', label: 'Choose the duplicate' }, ...others]} />
            </div>
            <Button size="small" shape="round" loading={merging} disabled={!mergeId} onclick={() => merge(mergeId)}>
              Merge
            </Button>
          </div>
        </div>
      {/if}

      <Heading size="small" class="mb-4">All recorded relations</Heading>
      {#if ownRelations.length === 0}
        <Text color="muted">None yet.</Text>
      {:else}
        <ul class="flex flex-col gap-2">
          {#each ownRelations as relation (relation.id)}
            <li class="flex items-center gap-3">
              <Text size="small" class="flex-1">{describe(relation)}</Text>
              {#if familyState.canContribute}
                <Button size="tiny" variant="ghost" color="danger" onclick={() => removeRelation(relation)}
                  >Remove</Button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if familyState.canContribute}
        <form onsubmit={addRelation} class="mt-4 flex flex-col gap-3 rounded-xl border p-4 dark:border-gray-700">
          <Text fontWeight="semi-bold">Add another kind of relation</Text>
          <Text size="small" color="muted">Godparents, friends, step and adopted family, or anything else.</Text>
          {#if others.length === 0}
            <Alert color="secondary" title="Name some more people first." />
          {:else}
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Who">
                <Select bind:value={otherId} options={[{ value: '', label: 'Choose a person' }, ...others]} />
              </Field>
              <Field label={`is ${person.name || 'their'}'s`}>
                <Select bind:value={choice} options={choices} onChange={() => (qualifier = '')} />
              </Field>
              {#if qualifiers[choice]}
                <Field label="Kind">
                  <Select bind:value={qualifier} options={qualifiers[choice] ?? []} />
                </Field>
              {:else if choice === 'custom'}
                <Field label="Relation"><Input bind:value={customLabel} placeholder="e.g. best man" /></Field>
              {/if}
            </div>
            <Stack>
              <div>
                <Button type="submit" size="small" shape="round" loading={addingRelation} disabled={!otherId}>
                  Add relation
                </Button>
              </div>
            </Stack>
          {/if}
        </form>
      {/if}
    </section>
  </div>
</UserPageLayout>
