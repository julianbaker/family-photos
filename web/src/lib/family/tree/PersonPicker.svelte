<script lang="ts">
  // family fork: find someone by typing, with their faces; or add a new person by name. Replaces long
  // dropdowns of every name in the family.
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import { lifespan } from '#lib/family/format.ts';
  import type { FamilyPersonResponseDto } from '@immich/sdk';
  import { onMount } from 'svelte';

  type Props = {
    people: FamilyPersonResponseDto[];
    /** People who can't be chosen here (the person themselves, existing parents...). */
    exclude?: string[];
    placeholder?: string;
    /** Offer "Add <name> as someone new". */
    allowNew?: boolean;
    onPick: (person: FamilyPersonResponseDto) => void;
    onCreate?: (name: string) => void;
    onCancel?: () => void;
  };
  let {
    people,
    exclude = [],
    placeholder = 'Find someone',
    allowNew = true,
    onPick,
    onCreate,
    onCancel,
  }: Props = $props();

  let query = $state('');
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  const listId = `picker-${Math.random().toString(36).slice(2)}`;

  onMount(() => input?.focus());

  const matches = $derived.by(() => {
    const text = query.trim().toLowerCase();
    const candidates = people.filter((person) => person.name && !exclude.includes(person.id));
    if (!text) {
      return candidates.slice(0, 0);
    }
    const words = (name: string) => name.toLowerCase().split(/\s+/);
    return candidates
      .filter((person) => person.name.toLowerCase().includes(text))
      .sort((a, b) => {
        // names starting with what you typed first, then any word starting with it, then the rest
        const rank = (name: string) =>
          name.toLowerCase().startsWith(text) ? 0 : words(name).some((word) => word.startsWith(text)) ? 1 : 2;
        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  });

  const exact = $derived(matches.some((person) => person.name.trim().toLowerCase() === query.trim().toLowerCase()));
  const offerNew = $derived(allowNew && !!onCreate && query.trim().length > 0 && !exact);
  const count = $derived(matches.length + (offerNew ? 1 : 0));

  $effect(() => {
    // keep the highlight on a real row when the list changes
    if (active >= count) {
      active = Math.max(0, count - 1);
    }
  });

  const choose = (index: number) => {
    if (index < matches.length) {
      onPick(matches[index]);
    } else if (offerNew) {
      onCreate?.(query.trim());
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        active = count === 0 ? 0 : (active + 1) % count;
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        active = count === 0 ? 0 : (active - 1 + count) % count;
        break;
      }
      case 'Enter': {
        event.preventDefault();
        if (count > 0) {
          choose(active);
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        event.stopPropagation();
        onCancel?.();
        break;
      }
    }
  };
</script>

<div class="flex flex-col gap-1">
  <input
    bind:this={input}
    bind:value={query}
    oninput={() => (active = 0)}
    onkeydown={onKeydown}
    {placeholder}
    role="combobox"
    aria-expanded={count > 0}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={count > 0 ? `${listId}-${active}` : undefined}
    class="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-gray-600 dark:bg-gray-800"
  />
  {#if count > 0}
    <ul id={listId} role="listbox" class="flex flex-col overflow-hidden rounded-xl border dark:border-gray-700">
      {#each matches as person, index (person.id)}
        <li
          id="{listId}-{index}"
          role="option"
          aria-selected={index === active}
          class="flex cursor-pointer items-center gap-3 px-3 py-2"
          class:bg-gray-100={index === active}
          class:dark:bg-gray-700={index === active}
          onpointerenter={() => (active = index)}
          onpointerdown={(event) => {
            event.preventDefault();
            choose(index);
          }}
        >
          <FamilyFace
            id={person.id}
            name={person.name}
            hasPhotos={person.faceCount > 0}
            class="size-9"
            textClass="text-sm"
          />
          <span class="flex min-w-0 flex-col">
            <span class="truncate text-sm font-medium">{person.name}</span>
            {#if lifespan(person) || person.relationToMe}
              <span class="truncate text-xs text-gray-500 dark:text-gray-400">
                {[
                  person.relationToMe && person.relationToMe.key !== 'self' ? `Your ${person.relationToMe.label}` : '',
                  lifespan(person),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            {/if}
          </span>
        </li>
      {/each}
      {#if offerNew}
        <li
          id="{listId}-{matches.length}"
          role="option"
          aria-selected={active === matches.length}
          class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm"
          class:bg-gray-100={active === matches.length}
          class:dark:bg-gray-700={active === matches.length}
          onpointerenter={() => (active = matches.length)}
          onpointerdown={(event) => {
            event.preventDefault();
            choose(matches.length);
          }}
        >
          <span
            class="flex size-9 items-center justify-center rounded-full border-2 border-dashed border-gray-300 text-lg text-gray-500 dark:border-gray-600"
            aria-hidden="true">+</span
          >
          <span>Add <strong>{query.trim()}</strong> as someone new</span>
        </li>
      {/if}
    </ul>
  {/if}
</div>
