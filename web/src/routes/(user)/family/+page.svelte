<script lang="ts">
  // family fork: members, invite links and invite requests
  import UserPageLayout from '#lib/components/layouts/UserPageLayout.svelte';
  import { authManager } from '#lib/managers/auth-manager.svelte.ts';
  import { Route } from '#lib/route.ts';
  import { copyToClipboard } from '#lib/utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import {
    FamilyInviteRequestStatus,
    FamilyInviteStatus,
    FamilyRole,
    approveFamilyInviteRequest,
    createFamilyInvite,
    createFamilyInviteRequest,
    declineFamilyInviteRequest,
    getFamilyInviteRequests,
    getFamilyInvites,
    getMyFamily,
    removeFamilyMember,
    revokeFamilyInvite,
    updateFamilyMember,
    type FamilyInviteRequestResponseDto,
    type FamilyInviteResponseDto,
    type FamilyResponseDto,
  } from '@immich/sdk';
  import { Alert, Badge, Button, Field, Heading, Input, Select, Stack, Text, Textarea } from '@immich/ui';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  type Props = { data: PageData };
  let { data }: Props = $props();

  let family = $state<FamilyResponseDto | null>(data.family);
  let invites = $state<FamilyInviteResponseDto[]>([]);
  let requests = $state<FamilyInviteRequestResponseDto[]>([]);
  let newLink = $state<string | null>(null);

  // new link form
  let linkRole = $state<FamilyRole>(FamilyRole.Member);
  let linkUses = $state<'one' | 'many'>('one');
  let linkDays = $state('7');
  let linkLabel = $state('');
  let creating = $state(false);

  // request form
  let requestName = $state('');
  let requestNote = $state('');
  let requesting = $state(false);

  const isAdmin = $derived(family?.role === FamilyRole.Admin);
  const canRequest = $derived(family?.role === FamilyRole.Member);

  const roleOptions = [
    { value: FamilyRole.Member, label: 'Member: adds photos, names people' },
    { value: FamilyRole.Viewer, label: 'Viewer: looks and downloads' },
    { value: FamilyRole.Admin, label: 'Admin: also manages members and invites' },
  ];
  const roleLabel: Record<FamilyRole, string> = {
    [FamilyRole.Admin]: 'Admin',
    [FamilyRole.Member]: 'Member',
    [FamilyRole.Viewer]: 'Viewer',
  };
  const statusLabel: Record<FamilyInviteStatus, string> = {
    [FamilyInviteStatus.Active]: 'Active',
    [FamilyInviteStatus.UsedUp]: 'Used',
    [FamilyInviteStatus.Expired]: 'Expired',
    [FamilyInviteStatus.Revoked]: 'Turned off',
  };
  const requestLabel: Record<FamilyInviteRequestStatus, string> = {
    [FamilyInviteRequestStatus.Pending]: 'Waiting for an admin',
    [FamilyInviteRequestStatus.Approved]: 'Approved',
    [FamilyInviteRequestStatus.Declined]: 'Declined',
  };

  const toUrl = (path: string) => new URL(path, location.origin).href;
  const formatDate = (date: string) => new Date(date).toLocaleDateString(undefined, { dateStyle: 'medium' });

  const share = async (path: string) => {
    const url = toUrl(path);
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${family?.name ?? 'our family'} photos`, url });
        return;
      } catch {
        // cancelled, or not allowed: fall back to copying
      }
    }
    await copyToClipboard(url);
  };

  const refresh = async () => {
    try {
      family = await getMyFamily();
      requests = await getFamilyInviteRequests();
      invites = family.role === FamilyRole.Admin ? await getFamilyInvites() : [];
    } catch (error) {
      handleError(error, 'Could not load the family');
    }
  };

  onMount(async () => {
    if (family) {
      await refresh();
    }
  });

  const onCreateLink = async (event: Event) => {
    event.preventDefault();
    creating = true;
    try {
      const invite = await createFamilyInvite({
        familyInviteCreateDto: {
          role: linkRole,
          maxUses: linkUses === 'one' ? 1 : null,
          expiresInDays: Number(linkDays),
          label: linkLabel.trim() || undefined,
        },
      });
      newLink = invite.path ? toUrl(invite.path) : null;
      linkLabel = '';
      await refresh();
    } catch (error) {
      handleError(error, 'Could not create the link');
    } finally {
      creating = false;
    }
  };

  const onRevoke = async (invite: FamilyInviteResponseDto) => {
    try {
      await revokeFamilyInvite({ id: invite.id });
      await refresh();
    } catch (error) {
      handleError(error, 'Could not turn off the link');
    }
  };

  const onRoleChange = async (userId: string, role: FamilyRole) => {
    try {
      await updateFamilyMember({ id: userId, familyMemberUpdateDto: { role } });
      await refresh();
    } catch (error) {
      handleError(error, 'Could not change the role');
      await refresh();
    }
  };

  const onRemove = async (userId: string, name: string) => {
    if (!confirm(`Remove ${name} from the family? They will stop seeing the family's photos.`)) {
      return;
    }
    try {
      await removeFamilyMember({ id: userId });
      await refresh();
    } catch (error) {
      handleError(error, 'Could not remove the member');
    }
  };

  const onRequest = async (event: Event) => {
    event.preventDefault();
    if (!requestName.trim()) {
      return;
    }
    requesting = true;
    try {
      await createFamilyInviteRequest({
        familyInviteRequestCreateDto: { name: requestName.trim(), note: requestNote.trim() || undefined },
      });
      requestName = '';
      requestNote = '';
      await refresh();
    } catch (error) {
      handleError(error, 'Could not send the request');
    } finally {
      requesting = false;
    }
  };

  const onApprove = async (request: FamilyInviteRequestResponseDto) => {
    try {
      await approveFamilyInviteRequest({
        id: request.id,
        familyInviteRequestApproveDto: { role: FamilyRole.Member, maxUses: 1, expiresInDays: 14 },
      });
      await refresh();
    } catch (error) {
      handleError(error, 'Could not approve the request');
    }
  };

  const onDecline = async (request: FamilyInviteRequestResponseDto) => {
    try {
      await declineFamilyInviteRequest({ id: request.id });
      await refresh();
    } catch (error) {
      handleError(error, 'Could not decline the request');
    }
  };
</script>

<UserPageLayout title={data.meta.title}>
  <div class="mx-auto flex max-w-3xl flex-col gap-10 pb-16">
    {#if !family}
      <Alert color="secondary" title="You're not in a family library yet." />
    {:else}
      <div class="flex flex-wrap gap-2">
        <Button href={Route.familyPeople()} shape="round">People</Button>
        <Button href={Route.familyTree()} variant="outline" shape="round">Family tree</Button>
      </div>

      <section>
        <Heading size="small" class="mb-4">Members</Heading>
        <ul class="flex flex-col gap-2">
          {#each family.members as member (member.userId)}
            <li class="flex flex-wrap items-center gap-3 rounded-lg border p-3 dark:border-gray-700">
              <div class="min-w-0 flex-1">
                <Text fontWeight="semi-bold">{member.name}</Text>
                <Text size="small" color="muted">{member.email}</Text>
              </div>
              {#if isAdmin && member.userId !== authManager.user.id}
                <div class="w-40">
                  <Select
                    value={member.role}
                    options={roleOptions.map(({ value }) => ({ value, label: roleLabel[value] }))}
                    onChange={(value) => onRoleChange(member.userId, value as FamilyRole)}
                  />
                </div>
                <Button
                  size="small"
                  color="danger"
                  variant="ghost"
                  onclick={() => onRemove(member.userId, member.name)}
                >
                  Remove
                </Button>
              {:else}
                <Badge>{roleLabel[member.role]}</Badge>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      {#if isAdmin}
        <section>
          <Heading size="small" class="mb-2">Invite someone</Heading>
          <Text size="small" color="muted" class="mb-4">
            Make a link and send it any way you like: WhatsApp, a text message or email. Whoever opens it sets up their
            own account and joins the family library.
          </Text>
          <form onsubmit={onCreateLink} class="flex flex-col gap-4">
            <Field label="Role">
              <Select bind:value={linkRole} options={roleOptions} />
            </Field>
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Can be used">
                <Select
                  bind:value={linkUses}
                  options={[
                    { value: 'one', label: 'Once (one person)' },
                    { value: 'many', label: 'By anyone, until it expires' },
                  ]}
                />
              </Field>
              <Field label="Expires after">
                <Select
                  bind:value={linkDays}
                  options={[
                    { value: '1', label: '1 day' },
                    { value: '7', label: '1 week' },
                    { value: '30', label: '30 days' },
                    { value: '90', label: '90 days' },
                  ]}
                />
              </Field>
            </div>
            <Field label="Note (only admins see it)" description="For example who the link is for.">
              <Input bind:value={linkLabel} />
            </Field>
            <div>
              <Button type="submit" shape="round" loading={creating}>Make a link</Button>
            </div>
          </form>

          {#if newLink}
            <div class="mt-4 flex flex-col gap-2 rounded-lg border p-4 dark:border-gray-700">
              <Text fontWeight="semi-bold">Your new link (copy it now; it's only shown once)</Text>
              <code class="break-all">{newLink}</code>
              <div class="flex gap-2">
                <Button size="small" onclick={() => copyToClipboard(newLink)}>Copy</Button>
                <Button size="small" variant="outline" onclick={() => newLink && share(new URL(newLink).pathname)}>
                  Share
                </Button>
              </div>
            </div>
          {/if}
        </section>

        <section>
          <Heading size="small" class="mb-4">Invite links</Heading>
          {#if invites.length === 0}
            <Text color="muted">No links yet.</Text>
          {:else}
            <ul class="flex flex-col gap-2">
              {#each invites as invite (invite.id)}
                <li class="flex flex-wrap items-center gap-3 rounded-lg border p-3 dark:border-gray-700">
                  <div class="min-w-0 flex-1">
                    <Text fontWeight="semi-bold">{invite.label || roleLabel[invite.role] + ' link'}</Text>
                    <Text size="small" color="muted">
                      {roleLabel[invite.role]} · used {invite.uses}{invite.maxUses === null
                        ? ''
                        : ` of ${invite.maxUses}`}
                      · expires {formatDate(invite.expiresAt)}
                    </Text>
                    {#if invite.usedBy.length > 0}
                      <Text size="small" color="muted">Joined: {invite.usedBy.map(({ name }) => name).join(', ')}</Text>
                    {/if}
                  </div>
                  <Badge color={invite.status === FamilyInviteStatus.Active ? 'success' : 'secondary'}>
                    {statusLabel[invite.status]}
                  </Badge>
                  {#if invite.status === FamilyInviteStatus.Active}
                    <Button size="small" color="danger" variant="ghost" onclick={() => onRevoke(invite)}
                      >Turn off</Button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      {#if canRequest}
        <section>
          <Heading size="small" class="mb-2">Ask for an invite</Heading>
          <Text size="small" color="muted" class="mb-4">
            Want to add someone? Ask an admin. Once they approve, you'll get a link here to send on.
          </Text>
          <form onsubmit={onRequest} class="flex flex-col gap-4">
            <Field label="Who should be invited?" required="indicator">
              <Input bind:value={requestName} placeholder="Their name" />
            </Field>
            <Field label="Note for the admin">
              <Textarea bind:value={requestNote} />
            </Field>
            <div>
              <Button type="submit" shape="round" loading={requesting} disabled={!requestName.trim()}
                >Send request</Button
              >
            </div>
          </form>
        </section>
      {/if}

      {#if requests.length > 0}
        <section>
          <Heading size="small" class="mb-4">{isAdmin ? 'Invite requests' : 'Your requests'}</Heading>
          <ul class="flex flex-col gap-2">
            {#each requests as request (request.id)}
              <li class="flex flex-col gap-2 rounded-lg border p-3 dark:border-gray-700">
                <div class="flex flex-wrap items-center gap-3">
                  <div class="min-w-0 flex-1">
                    <Text fontWeight="semi-bold">{request.name}</Text>
                    <Text size="small" color="muted">
                      {isAdmin ? `Asked by ${request.requestedByName} · ` : ''}{formatDate(request.createdAt)}
                    </Text>
                    {#if request.note}
                      <Text size="small">{request.note}</Text>
                    {/if}
                  </div>
                  <Badge color={request.status === FamilyInviteRequestStatus.Approved ? 'success' : 'secondary'}>
                    {requestLabel[request.status]}
                  </Badge>
                  {#if isAdmin && request.status === FamilyInviteRequestStatus.Pending}
                    <Button size="small" onclick={() => onApprove(request)}>Approve</Button>
                    <Button size="small" variant="ghost" color="danger" onclick={() => onDecline(request)}
                      >Decline</Button
                    >
                  {/if}
                </div>
                {#if request.path}
                  <Stack gap={1}>
                    <code class="text-sm break-all">{toUrl(request.path)}</code>
                    <div class="flex gap-2">
                      <Button size="small" onclick={() => request.path && copyToClipboard(toUrl(request.path))}
                        >Copy</Button
                      >
                      <Button size="small" variant="outline" onclick={() => request.path && share(request.path)}>
                        Share
                      </Button>
                    </div>
                  </Stack>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}
  </div>
</UserPageLayout>
