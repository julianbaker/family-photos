<script lang="ts">
  // family fork: the family tree as one canvas you can move around. Loads the whole family once and
  // re-centres instantly (tiles slide to their new places); no page loads while exploring.
  import FamilyFace from '#lib/family/FamilyFace.svelte';
  import { lifespan } from '#lib/family/format.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    FamilyPersonKind,
    deleteFamilyRelation,
    updateFamilyPerson,
    type FamilyPersonResponseDto,
    type FamilyRelationResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, IconButton, Text } from '@immich/ui';
  import { mdiAccountCircleOutline, mdiClose, mdiFitToScreenOutline, mdiMagnify, mdiMinus, mdiPlus } from '@mdi/js';
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import PersonPicker from './PersonPicker.svelte';
  import { KIND_LABEL, addRelative, companion, type RelativeKind } from './actions';
  import { TILE, buildGraph, layoutTree, neighbour, type AddKind } from './layout';

  type Props = {
    people: FamilyPersonResponseDto[];
    relations: FamilyRelationResponseDto[];
    focusId: string;
    meId: string | null;
    canEdit: boolean;
    myUserId: string;
    onFocus: (id: string) => void;
    onChanged: () => Promise<void>;
  };
  let { people, relations, focusId, meId, canEdit, myUserId, onFocus, onChanged }: Props = $props();

  const byId = $derived(new Map(people.map((person) => [person.id, person])));
  const graph = $derived(buildGraph(people, relations));
  // pets hang from their owners; they get no father, mother, partner or child slots
  const isPet = (id: string) => people.find((person) => person.id === id)?.kind === FamilyPersonKind.Pet;
  const layout = $derived(layoutTree(graph, focusId, { editable: canEdit, isPet }));
  const focus = $derived(byId.get(focusId));

  // ---- camera: the canvas is translated and scaled; (0, 0) in tree space is the focused person
  let viewport: HTMLDivElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let scale = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let animate = $state(false);
  const MIN = 0.3;
  const MAX = 1.8;

  const clamp = (value: number) => Math.min(MAX, Math.max(MIN, value));
  const settle = () => {
    animate = true;
    setTimeout(() => (animate = false), 320);
  };

  /** Centre the focused person, a little below the middle so the generations above show. */
  const centre = (smooth = true) => {
    if (smooth) {
      settle();
    }
    panX = 0;
    panY = height * 0.12;
  };

  /** On opening: the whole family if it fits at a readable size, otherwise centred on the person. */
  const frame = () => {
    const { minX, maxX, minY, maxY } = layout.bounds;
    const pad = 48;
    const fitScale = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY));
    const readable = width < 640 ? 0.6 : 0.75;
    if (fitScale >= readable) {
      scale = clamp(Math.min(fitScale, 1));
      panX = -((minX + maxX) / 2) * scale;
      panY = -((minY + maxY) / 2) * scale;
    } else {
      scale = width < 640 ? 0.7 : 0.9;
      centre(false);
    }
  };

  const fit = () => {
    const { minX, maxX, minY, maxY } = layout.bounds;
    const pad = 48;
    scale = clamp(Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2) / (maxY - minY), 1.2));
    settle();
    panX = -((minX + maxX) / 2) * scale;
    panY = -((minY + maxY) / 2) * scale;
  };

  const zoomBy = (factor: number, aroundX = width / 2, aroundY = height / 2) => {
    const next = clamp(scale * factor);
    // keep the point under the cursor (or the centre) where it is
    const px = aroundX - width / 2 - panX;
    const py = aroundY - height / 2 - panY;
    panX -= (px / scale) * (next - scale);
    panY -= (py / scale) * (next - scale);
    scale = next;
  };

  // ---- choosing someone: re-centre on them (the tiles slide), update the address quietly
  let panelOpen = $state(true);
  let adding = $state<{ kind: RelativeKind; forId: string } | null>(null);
  let searching = $state(false);
  let saving = $state(false);
  let linkCompanion = $state(true);

  const choose = (id: string) => {
    adding = null;
    searching = false;
    panelOpen = true;
    if (id !== focusId) {
      onFocus(id);
    }
    centre();
    void tick().then(() => viewport?.focus());
  };

  const openAdd = (kind: RelativeKind, forId: string) => {
    if (forId !== focusId) {
      onFocus(forId);
      centre();
    }
    adding = { kind, forId };
    linkCompanion = true;
    panelOpen = true;
  };

  const addFromSlot = (kind: AddKind, forId: string) => openAdd(kind as RelativeKind, forId);

  const finishAdd = async (choice: { existingId?: string; newName?: string }) => {
    if (!adding || saving) {
      return;
    }
    saving = true;
    try {
      const other = isPet(adding.forId) ? null : companion(graph, adding.kind, adding.forId);
      await addRelative({
        kind: adding.kind,
        forId: adding.forId,
        forIsPet: isPet(adding.forId),
        ...choice,
        withCompanion: linkCompanion && other ? other.id : null,
      });
      adding = null;
      await onChanged();
    } catch (error) {
      handleError(error, 'Could not add them');
    } finally {
      saving = false;
    }
  };

  const removeRelation = async (relation: FamilyRelationResponseDto) => {
    const other = byId.get(relation.personId === focusId ? relation.relatedPersonId : relation.personId);
    if (!confirm(`Remove this relation with ${other?.name || 'them'}? The people stay.`)) {
      return;
    }
    try {
      await deleteFamilyRelation({ id: relation.id });
      await onChanged();
    } catch (error) {
      handleError(error, 'Could not remove the relation');
    }
  };

  const setMe = async () => {
    try {
      await updateFamilyPerson({ id: focusId, familyPersonUpdateDto: { linkedUserId: myUserId } });
      await onChanged();
    } catch (error) {
      handleError(error, 'Could not save');
    }
  };

  // ---- the focused person's direct relations, described from their side
  const describe = (relation: FamilyRelationResponseDto) => {
    const otherId = relation.personId === focusId ? relation.relatedPersonId : relation.personId;
    const other = byId.get(otherId)?.name || 'Someone';
    const q = relation.qualifier ? `${relation.qualifier} ` : '';
    switch (relation.type) {
      case 'parent': {
        return relation.personId === focusId ? `${q}parent of ${other}` : `${q}child of ${other}`;
      }
      case 'spouse': {
        return `${relation.qualifier === 'former' ? 'former ' : ''}partner of ${other}`;
      }
      case 'sibling': {
        return `${q}sibling of ${other}`;
      }
      case 'godparent': {
        return relation.personId === focusId ? `godparent of ${other}` : `godchild of ${other}`;
      }
      case 'custom': {
        return `${relation.label} (${other})`;
      }
      default: {
        return `${relation.type} of ${other}`;
      }
    }
  };
  const ownRelations = $derived(relations.filter((r) => r.personId === focusId || r.relatedPersonId === focusId));

  // ---- pan (drag), zoom (wheel, pinch); a drag doesn't count as a click on a tile
  // not state: it only tracks fingers during a gesture, and nothing renders from it
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let pinchDistance = 0;

  const onPointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest('[data-no-pan]')) {
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last) {
      return;
    }
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      if (Math.abs(dx) + Math.abs(dy) > 0 && (dragged || Math.hypot(dx, dy) > 3)) {
        if (!dragged) {
          viewport?.setPointerCapture(event.pointerId);
        }
        dragged = true;
        panX += dx;
        panY += dy;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = viewport!.getBoundingClientRect();
      if (pinchDistance > 0) {
        zoomBy(distance / pinchDistance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      }
      pinchDistance = distance;
      dragged = true;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchDistance = 0;
    }
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = viewport!.getBoundingClientRect();
    // a trackpad scroll pans, like a map; a pinch (ctrl + wheel) or a mouse wheel zooms
    const mouseWheel = event.deltaMode === WheelEvent.DOM_DELTA_LINE || Math.abs(event.deltaY) >= 100;
    if (event.ctrlKey || mouseWheel) {
      zoomBy(
        Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015)),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    } else {
      panX -= event.deltaX;
      panY -= event.deltaY;
    }
  };

  const onTileClick = (event: MouseEvent, id: string) => {
    if (dragged) {
      event.preventDefault();
      return;
    }
    choose(id);
  };

  // ---- keyboard
  const onKeydown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
      return;
    }
    const arrows: Partial<Record<string, 'up' | 'down' | 'left' | 'right'>> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const direction = arrows[event.key];
    if (direction) {
      event.preventDefault();
      const next = neighbour(layout, focusId, direction);
      if (next) {
        choose(next);
      }
      return;
    }
    switch (event.key) {
      case 'Enter': {
        void goto(Route.familyPerson({ id: focusId }));
        break;
      }
      case 'Escape': {
        if (adding || searching) {
          adding = null;
          searching = false;
        } else {
          panelOpen = false;
        }
        break;
      }
      case '/': {
        event.preventDefault();
        searching = true;
        break;
      }
      case '+':
      case '=': {
        settle();
        zoomBy(1.25);
        break;
      }
      case '-': {
        settle();
        zoomBy(0.8);
        break;
      }
      case '0': {
        fit();
        break;
      }
      case 'm':
      case 'M': {
        if (meId) {
          choose(meId);
        }
        break;
      }
    }
  };

  // re-frame when the space changes between narrow (phone) and wide, e.g. rotating an iPad
  let narrow: boolean | null = null;
  $effect(() => {
    const isNarrow = width > 0 && width < 640;
    if (width > 0 && narrow !== null && isNarrow !== narrow) {
      frame();
    }
    if (width > 0) {
      narrow = isNarrow;
    }
  });

  onMount(() => {
    // the viewport has its size after the first layout
    requestAnimationFrame(() => {
      frame();
      viewport?.focus();
    });
  });

  const tileLabel = (person: FamilyPersonResponseDto) =>
    [
      person.name || 'Unnamed',
      person.relationToMe?.key === 'self' ? 'you' : person.relationToMe ? `your ${person.relationToMe.label}` : '',
      lifespan(person),
    ]
      .filter(Boolean)
      .join(', ');

  const slotLabel: Record<AddKind, string> = {
    father: 'Add father',
    mother: 'Add mother',
    parent: 'Add parent',
    partner: 'Add partner',
    child: 'Add child',
  };

  /** Nobody can be added as their own relative, or again as someone they're already related to. */
  const excludedFor = (forId: string) => {
    const existing = [forId];
    for (const relation of relations) {
      if (relation.personId === forId) {
        existing.push(relation.relatedPersonId);
      } else if (relation.relatedPersonId === forId) {
        existing.push(relation.personId);
      }
    }
    return existing;
  };

  const bioPreview = (bio: string | null | undefined) => {
    const text = (bio ?? '').replaceAll(/\*\*|\*|\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
    return text.length > 220 ? `${text.slice(0, 220).trimEnd()}…` : text;
  };
</script>

<div class="flex size-full flex-col gap-2 md:flex-row">
  <!-- the canvas: role="application" is the WAI-ARIA role for a pan/zoom surface with its own
       keyboard handling (arrows, Enter, /, +, -, 0, M), which Svelte's checker doesn't count as
       interactive -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={viewport}
    bind:clientWidth={width}
    bind:clientHeight={height}
    class="relative min-h-0 flex-1 touch-none overflow-hidden rounded-2xl bg-gray-50 outline-none select-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-gray-900"
    role="application"
    aria-label="Family tree. Arrow keys move between relatives, Enter opens their page, slash searches."
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    onkeydown={onKeydown}
  >
    <div
      class="absolute top-0 left-0"
      style:transform="translate({width / 2 + panX}px, {height / 2 + panY}px) scale({scale})"
      style:transition={animate ? 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none'}
    >
      <svg class="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden="true">
        {#each layout.lines as line (line.key)}
          <polyline
            points={line.points.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            class="stroke-gray-400 dark:stroke-gray-500"
            stroke-width="2"
            stroke-dasharray={line.dashed ? '6 5' : undefined}
            stroke-linejoin="round"
          />
        {/each}
      </svg>

      {#each layout.tiles as tile (tile.key)}
        <div
          class="absolute top-0 left-0 transition-transform duration-300 ease-out"
          style:transform="translate({tile.x - TILE.width / 2}px, {tile.y - TILE.height / 2}px)"
          style:width="{TILE.width}px"
          style:height="{TILE.height}px"
        >
          {#if tile.kind === 'person'}
            {const person = $derived(byId.get(tile.personId))}
            {#if person}
              <button
                type="button"
                data-no-pan-click
                class="flex size-full flex-col items-center gap-1 rounded-2xl border bg-white px-2 pt-3 pb-2 text-center shadow-sm transition-colors hover:border-primary dark:border-gray-700 dark:bg-gray-800"
                class:ring-2={tile.focus}
                class:ring-primary={tile.focus}
                class:border-primary={tile.focus}
                aria-label={tileLabel(person)}
                aria-current={tile.focus ? 'true' : undefined}
                onclick={(event) => onTileClick(event, person.id)}
              >
                <FamilyFace
                  id={person.id}
                  name={person.name}
                  hasPhotos={person.faceCount > 0}
                  class="size-16"
                  textClass="text-2xl"
                />
                <span class="line-clamp-2 text-sm/tight font-semibold">{person.name || 'Unnamed'}</span>
                {#if lifespan(person)}
                  <span class="text-xs text-gray-500 dark:text-gray-400">{lifespan(person)}</span>
                {/if}
                {#if person.relationToMe}
                  <span class="line-clamp-2 text-xs/tight text-primary">
                    {person.relationToMe.key === 'self' ? 'You' : `Your ${person.relationToMe.label}`}
                  </span>
                {/if}
              </button>
            {/if}
          {:else}
            <button
              type="button"
              class="flex size-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 text-sm text-gray-500 transition-colors hover:border-primary hover:text-primary dark:border-gray-600 dark:text-gray-400"
              aria-label="{slotLabel[tile.add]} for {byId.get(tile.forId)?.name || 'them'}"
              onclick={(event) => {
                if (dragged) {
                  event.preventDefault();
                } else {
                  addFromSlot(tile.add, tile.forId);
                }
              }}
            >
              <Icon icon={mdiPlus} size="1.5rem" />
              {slotLabel[tile.add]}
            </button>
          {/if}
        </div>
      {/each}
    </div>

    <!-- controls -->
    <div class="absolute top-3 left-3 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-2" data-no-pan>
      {#if searching}
        <div class="rounded-2xl bg-white p-2 shadow-lg dark:bg-gray-800">
          <PersonPicker
            {people}
            placeholder="Find someone in the tree"
            allowNew={false}
            onPick={(person) => choose(person.id)}
            onCancel={() => (searching = false)}
          />
        </div>
      {:else}
        <div>
          <Button
            size="small"
            shape="round"
            color="secondary"
            leadingIcon={mdiMagnify}
            onclick={() => (searching = true)}
          >
            Find someone
          </Button>
        </div>
      {/if}
    </div>
    <div class="absolute top-3 right-3 flex flex-col gap-2" data-no-pan>
      {#if meId}
        <IconButton
          icon={mdiAccountCircleOutline}
          aria-label="Go to me"
          shape="round"
          color="secondary"
          onclick={() => choose(meId!)}
        />
      {/if}
      <IconButton
        icon={mdiPlus}
        aria-label="Zoom in"
        shape="round"
        color="secondary"
        onclick={() => (settle(), zoomBy(1.25))}
      />
      <IconButton
        icon={mdiMinus}
        aria-label="Zoom out"
        shape="round"
        color="secondary"
        onclick={() => (settle(), zoomBy(0.8))}
      />
      <IconButton
        icon={mdiFitToScreenOutline}
        aria-label="Fit the tree"
        shape="round"
        color="secondary"
        onclick={fit}
      />
    </div>
  </div>

  <!-- the side panel (below the tree on narrow screens) -->
  {#if panelOpen && focus}
    <aside
      class="flex max-h-[38%] w-full shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border bg-white p-4 md:max-h-none md:w-80 dark:border-gray-700 dark:bg-gray-800"
      aria-label="{focus.name || 'This person'}: details"
    >
      <div class="flex items-start gap-3">
        <FamilyFace
          id={focus.id}
          name={focus.name}
          hasPhotos={focus.faceCount > 0}
          class="size-16"
          textClass="text-2xl"
        />
        <div class="flex min-w-0 flex-1 flex-col">
          <Text fontWeight="semi-bold" size="large" class="truncate">{focus.name || 'Unnamed'}</Text>
          {#if focus.relationToMe}
            <Text size="small" color="primary">
              {focus.relationToMe.key === 'self' ? 'This is you' : `Your ${focus.relationToMe.label}`}
            </Text>
          {/if}
          {#if lifespan(focus)}<Text size="small" color="muted">{lifespan(focus)}</Text>{/if}
        </div>
        <IconButton
          icon={mdiClose}
          aria-label="Close"
          variant="ghost"
          shape="round"
          size="small"
          onclick={() => (panelOpen = false)}
        />
      </div>

      {#if adding}
        {const other = $derived(isPet(adding.forId) ? null : companion(graph, adding.kind, adding.forId))}
        <div class="flex flex-col gap-2">
          <Text fontWeight="semi-bold">Add {byId.get(adding.forId)?.name || 'their'}'s {KIND_LABEL[adding.kind]}</Text>
          <PersonPicker
            {people}
            exclude={excludedFor(adding.forId)}
            placeholder="Find someone, or type a new name"
            onPick={(person) => finishAdd({ existingId: person.id })}
            onCreate={(name) => finishAdd({ newName: name })}
            onCancel={() => (adding = null)}
          />
          {#if other}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={linkCompanion} />
              {other.text}
            </label>
          {/if}
          <div><Button size="small" variant="ghost" shape="round" onclick={() => (adding = null)}>Cancel</Button></div>
        </div>
      {:else}
        {#if bioPreview(focus.bio)}
          <Text size="small" class="whitespace-pre-line">{bioPreview(focus.bio)}</Text>
        {/if}

        <div class="flex flex-wrap gap-2">
          <Button size="small" shape="round" href={Route.familyPerson({ id: focus.id })}>Open page</Button>
          {#if canEdit && !meId}
            <Button size="small" shape="round" variant="outline" onclick={setMe}>This is me</Button>
          {/if}
        </div>

        {#if canEdit}
          <div class="flex flex-col gap-2">
            <Text size="small" fontWeight="semi-bold" color="muted">ADD A RELATIVE</Text>
            <div class="flex flex-wrap gap-2">
              {#each [['father', 'Father'], ['mother', 'Mother'], ['partner', 'Partner'], ['child', 'Child'], ['sibling', 'Sibling']] as [kind, label] (kind)}
                <Button
                  size="small"
                  variant="outline"
                  shape="round"
                  onclick={() => openAdd(kind as RelativeKind, focus.id)}
                >
                  + {label}
                </Button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-1">
          <Text size="small" fontWeight="semi-bold" color="muted">RECORDED RELATIONS</Text>
          {#if ownRelations.length === 0}
            <Text size="small" color="muted">None yet.</Text>
          {/if}
          {#each ownRelations as relation (relation.id)}
            <div class="flex items-center gap-2">
              <Text size="small" class="flex-1">{describe(relation)}</Text>
              {#if canEdit}
                <IconButton
                  icon={mdiClose}
                  aria-label="Remove: {describe(relation)}"
                  variant="ghost"
                  shape="round"
                  size="tiny"
                  onclick={() => removeRelation(relation)}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  {/if}
</div>
