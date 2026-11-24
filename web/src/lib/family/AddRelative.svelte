<script lang="ts">
  // family fork: add a parent, child, partner or sibling from the person page, with the same face
  // search and the same rules as the family tree (a new person, or someone already in the family).
  import PersonPicker from '#lib/family/tree/PersonPicker.svelte';
  import { KIND_LABEL, addRelative, companion, type RelativeKind as TreeKind } from '#lib/family/tree/actions.ts';
  import { buildGraph } from '#lib/family/tree/layout.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import type { FamilyPersonResponseDto, FamilyRelationResponseDto } from '@immich/sdk';
  import { Button, Text } from '@immich/ui';

  export type RelativeKind = 'parent' | 'child' | 'spouse' | 'sibling';

  type Props = {
    person: { id: string; name: string };
    people: FamilyPersonResponseDto[];
    relations: FamilyRelationResponseDto[];
    kind: RelativeKind;
    onDone: () => void | Promise<void>;
    onCancel: () => void;
  };
  let { person, people, relations, kind, onDone, onCancel }: Props = $props();

  const treeKind: TreeKind = $derived(kind === 'spouse' ? 'partner' : kind);
  const graph = $derived(buildGraph(people, relations));
  const other = $derived(companion(graph, treeKind, person.id));
  let linkCompanion = $state(true);
  let saving = $state(false);

  const exclude = $derived([
    person.id,
    ...relations.flatMap((relation) =>
      relation.personId === person.id
        ? relation.relatedPersonId
        : relation.relatedPersonId === person.id
          ? relation.personId
          : [],
    ),
  ]);

  const save = async (choice: { existingId?: string; newName?: string }) => {
    if (saving) {
      return;
    }
    saving = true;
    try {
      await addRelative({
        kind: treeKind,
        forId: person.id,
        ...choice,
        withCompanion: linkCompanion && other ? other.id : null,
      });
      await onDone();
    } catch (error) {
      handleError(error, 'Could not add them');
    } finally {
      saving = false;
    }
  };
</script>

<div class="flex flex-col gap-3 rounded-xl border p-4 text-start dark:border-gray-700">
  <Text fontWeight="semi-bold">Add {person.name || 'their'}'s {KIND_LABEL[treeKind]}</Text>
  <PersonPicker
    {people}
    {exclude}
    placeholder="Find someone, or type a new name"
    onPick={(chosen) => save({ existingId: chosen.id })}
    onCreate={(name) => save({ newName: name })}
    {onCancel}
  />
  {#if other}
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" bind:checked={linkCompanion} />
      {other.text}
    </label>
  {/if}
  <div><Button size="small" variant="ghost" shape="round" onclick={onCancel}>Cancel</Button></div>
</div>
