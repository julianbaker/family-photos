<script lang="ts">
  // family fork: who is in the photo (age then, relation to you) and the family's comments
  import { familyState } from '#lib/family/family-state.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    createFamilyComment,
    deleteFamilyComment,
    getFamilyAssetPeople,
    getFamilyComments,
    type AssetResponseDto,
    type FamilyAssetPersonResponseDto,
    type FamilyCommentResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, IconButton, Text, Textarea } from '@immich/ui';
  import { mdiAccountMultipleOutline, mdiCommentTextOutline, mdiDeleteOutline } from '@mdi/js';

  type Props = { asset: AssetResponseDto };
  let { asset }: Props = $props();

  let people = $state<FamilyAssetPersonResponseDto[]>([]);
  let comments = $state<FamilyCommentResponseDto[]>([]);
  let text = $state('');
  let sending = $state(false);

  const load = async (assetId: string) => {
    await familyState.load();
    if (!familyState.inFamily) {
      return;
    }
    try {
      [people, comments] = await Promise.all([
        getFamilyAssetPeople({ id: assetId }),
        getFamilyComments({ id: assetId }),
      ]);
    } catch {
      people = [];
      comments = [];
    }
  };

  $effect(() => {
    void load(asset.id);
  });

  const onsubmit = async (event: Event) => {
    event.preventDefault();
    if (!text.trim()) {
      return;
    }
    sending = true;
    try {
      const comment = await createFamilyComment({ id: asset.id, familyCommentCreateDto: { text: text.trim() } });
      comments = [...comments, comment];
      text = '';
    } catch (error) {
      handleError(error, 'Could not add the comment');
    } finally {
      sending = false;
    }
  };

  const onDelete = async (comment: FamilyCommentResponseDto) => {
    try {
      await deleteFamilyComment({ id: comment.id });
      comments = comments.filter(({ id }) => id !== comment.id);
    } catch (error) {
      handleError(error, 'Could not delete the comment');
    }
  };

  const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' });
</script>

{#if familyState.inFamily}
  {#if people.length > 0}
    <section class="p-4">
      <div class="flex items-center gap-2 pb-2">
        <Icon icon={mdiAccountMultipleOutline} size="20" />
        <Text size="small" fontWeight="semi-bold">In this photo</Text>
      </div>
      <ul class="flex flex-col gap-1">
        {#each people as person (person.faceId)}
          <li>
            <a href={Route.familyPerson({ id: person.personId })} class="hover:text-primary">
              <Text size="small">
                <span class="font-medium">{person.name || 'Unnamed'}</span>{#if person.age !== null},
                  {person.age}{/if}{#if person.relationToMe}
                  <span class="text-gray-500 dark:text-gray-400"> · your {person.relationToMe.label}</span>{/if}
              </Text>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="p-4">
    <div class="flex items-center gap-2 pb-2">
      <Icon icon={mdiCommentTextOutline} size="20" />
      <Text size="small" fontWeight="semi-bold">Family comments</Text>
    </div>
    {#if comments.length === 0}
      <Text size="small" color="muted">No comments yet.</Text>
    {/if}
    <ul class="flex flex-col gap-3">
      {#each comments as comment (comment.id)}
        <li class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <Text size="small" class="wrap-break-word whitespace-pre-wrap">{comment.text}</Text>
            <Text size="tiny" color="muted"
              >{comment.userName ?? 'Former member'} · {formatDate(comment.createdAt)}</Text
            >
          </div>
          {#if comment.canDelete}
            <IconButton
              icon={mdiDeleteOutline}
              aria-label="Delete comment"
              size="small"
              shape="round"
              color="secondary"
              variant="ghost"
              onclick={() => onDelete(comment)}
            />
          {/if}
        </li>
      {/each}
    </ul>
    {#if familyState.canContribute}
      <form {onsubmit} class="mt-3 flex flex-col gap-2">
        <Textarea bind:value={text} placeholder="Add a comment: who, where, when…" />
        <div>
          <Button size="small" type="submit" loading={sending} disabled={!text.trim()}>Comment</Button>
        </div>
      </form>
    {/if}
  </section>
{/if}
