<script lang="ts">
  // family fork: add a parent, child, partner or sibling to someone, choosing an existing person or
  // typing a new name (for example a great-grandparent with no photos). Used on the person page and
  // in the tree, where the gaps are.
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    FamilyRelationType,
    createFamilyPerson,
    createFamilyRelation,
    type FamilyPersonResponseDto,
  } from '@immich/sdk';
  import { Button, Field, Input, Select, Text } from '@immich/ui';

  export type RelativeKind = 'parent' | 'child' | 'spouse' | 'sibling';

  type Props = {
    person: { id: string; name: string };
    people: FamilyPersonResponseDto[];
    kind: RelativeKind;
    onDone: () => void | Promise<void>;
    onCancel: () => void;
  };
  let { person, people, kind, onDone, onCancel }: Props = $props();

  const noun: Record<RelativeKind, string> = {
    parent: 'parent',
    child: 'child',
    spouse: 'partner',
    sibling: 'brother or sister',
  };

  let existingId = $state('');
  let newName = $state('');
  let saving = $state(false);

  const options = $derived([
    { value: '', label: 'Choose someone' },
    ...people
      .filter((item) => item.id !== person.id && item.name)
      .map((item) => ({ value: item.id, label: item.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);

  const canSave = $derived(!!existingId || !!newName.trim());

  const save = async (event: Event) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    saving = true;
    try {
      let otherId = existingId;
      if (!otherId) {
        const created = await createFamilyPerson({ familyPersonCreateDto: { name: newName.trim() } });
        otherId = created.id;
      }
      // relations are stored as "personId is the <type> of relatedPersonId"
      const otherFirst = kind !== 'child';
      const type =
        kind === 'spouse'
          ? FamilyRelationType.Spouse
          : kind === 'sibling'
            ? FamilyRelationType.Sibling
            : FamilyRelationType.Parent;
      await createFamilyRelation({
        familyRelationCreateDto: {
          personId: otherFirst ? otherId : person.id,
          relatedPersonId: otherFirst ? person.id : otherId,
          type,
        },
      });
      await onDone();
    } catch (error) {
      handleError(error, 'Could not add them');
    } finally {
      saving = false;
    }
  };
</script>

<form onsubmit={save} class="flex flex-col gap-3 rounded-xl border p-4 text-start dark:border-gray-700">
  <Text fontWeight="semi-bold">Add {person.name || 'their'}'s {noun[kind]}</Text>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Field label="Someone already here">
      <Select bind:value={existingId} {options} onChange={() => (newName = '')} />
    </Field>
    <Field label="Or someone new">
      <Input bind:value={newName} placeholder="Their name" oninput={() => (existingId = '')} />
    </Field>
  </div>
  <div class="flex gap-2">
    <Button type="submit" size="small" shape="round" loading={saving} disabled={!canSave}>Add</Button>
    <Button size="small" variant="ghost" shape="round" onclick={onCancel}>Cancel</Button>
  </div>
</form>
