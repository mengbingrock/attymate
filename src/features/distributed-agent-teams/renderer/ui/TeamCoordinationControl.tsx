import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Crown, RefreshCw, Users } from 'lucide-react';

import type {
  DistributedMembershipRouteDto,
  DistributedTeamCoordination,
  DistributedTeamSettingsDto,
} from '../../contracts';

interface TeamCoordinationControlProps {
  settings: DistributedTeamSettingsDto;
  /** Active memberships of this team. */
  members: readonly DistributedMembershipRouteDto[];
  disabled: boolean;
  updating: boolean;
  onUpdate: (coordination: DistributedTeamCoordination, expectedRevision: number) => Promise<void>;
}

/** The Relay promotes the earliest-joined active member when a team becomes led again. */
const oldestMember = (
  members: readonly DistributedMembershipRouteDto[]
): DistributedMembershipRouteDto | undefined =>
  [...members].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.membershipId.localeCompare(right.membershipId)
  )[0];

const switchConsequence = (
  target: DistributedTeamCoordination,
  members: readonly DistributedMembershipRouteDto[]
): string => {
  if (target === 'leaderless') {
    const lead = members.find((member) => member.role === 'lead');
    return lead === undefined
      ? 'Every member joins as a peer. No lead will be assigned, even after a Relay restart.'
      : `${lead.label} stops leading and restarts as a member. No lead will be assigned, even after a Relay restart.`;
  }
  const promoted = oldestMember(members);
  return promoted === undefined
    ? 'The first Worker to join will become the lead.'
    : `${promoted.label}, the earliest member, becomes the lead and restarts in that role.`;
};

export const TeamCoordinationControl = ({
  settings,
  members,
  disabled,
  updating,
  onUpdate,
}: TeamCoordinationControlProps): React.JSX.Element => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const leaderless = settings.coordination === 'leaderless';
  const target: DistributedTeamCoordination = leaderless ? 'led' : 'leaderless';

  const confirm = async (): Promise<void> => {
    try {
      await onUpdate(target, settings.revision);
      setConfirmOpen(false);
    } catch {
      // The parent surfaces the Relay error while keeping the confirmation open for retry.
    }
  };

  return (
    <>
      <span
        data-testid="team-coordination-badge"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          leaderless ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'
        }`}
      >
        {leaderless ? <Users className="size-3" /> : <Crown className="size-3" />}
        {leaderless ? 'Leaderless' : 'Led'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[11px]"
        disabled={disabled || updating}
        onClick={() => setConfirmOpen(true)}
      >
        {updating ? <RefreshCw className="size-3 animate-spin" /> : null}
        {leaderless ? 'Assign a lead' : 'Make leaderless'}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {leaderless ? 'Run this team with a lead?' : 'Run this team without a lead?'}
            </DialogTitle>
            <DialogDescription>
              {switchConsequence(target, members)}{' '}
              {target === 'leaderless'
                ? 'Members coordinate peer to peer, and only you can add or remove other members.'
                : 'The lead coordinates the roster and can add or remove members.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={updating} onClick={() => void confirm()}>
              {updating ? 'Switching…' : leaderless ? 'Assign a lead' : 'Make leaderless'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
