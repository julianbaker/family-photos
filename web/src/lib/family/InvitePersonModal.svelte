<script lang="ts">
  // family fork: an admin invites a family person. Whoever joins with the link is linked to that person
  // ("this is me") automatically.
  import type { FamilyInviteCreateWithPersonDto } from '#lib/family/app-login.ts';
  import { copyToClipboard } from '#lib/utils.ts';
  import { handleError } from '#lib/utils/handle-error.ts';
  import { FamilyRole, createFamilyInvite } from '@immich/sdk';
  import { Button, Field, HStack, Modal, ModalBody, ModalFooter, Select, Stack, Text } from '@immich/ui';
  import { mdiAccountPlus } from '@mdi/js';

  type Props = {
    person: { id: string; name: string };
    onClose: () => void;
  };

  let { person, onClose }: Props = $props();

  let role = $state<FamilyRole>(FamilyRole.Member);
  let days = $state('7');
  let creating = $state(false);
  let link = $state<string | null>(null);

  const displayName = $derived(person.name || 'them');
  const roleOptions = [
    { value: FamilyRole.Member, label: 'Member: adds photos, names people' },
    { value: FamilyRole.Viewer, label: 'Viewer: looks and downloads' },
    { value: FamilyRole.Admin, label: 'Admin: also manages members and invites' },
  ];

  const create = async () => {
    creating = true;
    try {
      const dto: FamilyInviteCreateWithPersonDto = {
        role,
        maxUses: 1,
        expiresInDays: Number(days),
        personId: person.id,
      };
      const invite = await createFamilyInvite({ familyInviteCreateDto: dto });
      link = invite.path ? new URL(invite.path, location.origin).href : null;
    } catch (error) {
      handleError(error, 'Could not create the invite');
    } finally {
      creating = false;
    }
  };

  const share = async () => {
    if (!link) {
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Join our family photos', url: link });
        return;
      } catch {
        // cancelled, or not allowed: fall back to copying
      }
    }
    await copyToClipboard(link);
  };
</script>

<Modal title={`Invite ${displayName} to sibred`} icon={mdiAccountPlus} {onClose} size="small">
  <ModalBody>
    {#if link}
      <Stack gap={2}>
        <Text>
          Send this link to {displayName}. When they join, their account is linked to {displayName} in the family.
        </Text>
        <Text size="small" fontWeight="semi-bold">Copy it now; it's only shown once.</Text>
        <code class="break-all">{link}</code>
      </Stack>
    {:else}
      <Stack gap={4}>
        <Text size="small" color="muted">
          The link works for one person. When they join, their account is linked to {displayName} automatically.
        </Text>
        <Field label="Role">
          <Select bind:value={role} options={roleOptions} />
        </Field>
        <Field label="Expires after">
          <Select
            bind:value={days}
            options={[
              { value: '1', label: '1 day' },
              { value: '7', label: '1 week' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        </Field>
      </Stack>
    {/if}
  </ModalBody>

  <ModalFooter>
    <HStack fullWidth>
      {#if link}
        <Button shape="round" onclick={() => link && copyToClipboard(link)} fullWidth>Copy</Button>
        <Button shape="round" variant="outline" onclick={share} fullWidth>Share</Button>
        <Button shape="round" variant="ghost" onclick={onClose} fullWidth>Done</Button>
      {:else}
        <Button shape="round" variant="ghost" onclick={onClose} fullWidth>Cancel</Button>
        <Button shape="round" loading={creating} onclick={create} fullWidth>Make the link</Button>
      {/if}
    </HStack>
  </ModalFooter>
</Modal>
