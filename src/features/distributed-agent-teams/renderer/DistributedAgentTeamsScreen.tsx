import { useDistributedAgentTeams } from './hooks/useDistributedAgentTeams';
import { DistributedAgentTeamsView } from './ui/DistributedAgentTeamsView';

interface DistributedAgentTeamsScreenProps {
  isActive: boolean;
}

export const DistributedAgentTeamsScreen = ({
  isActive,
}: DistributedAgentTeamsScreenProps): React.JSX.Element => {
  const state = useDistributedAgentTeams(isActive);

  return (
    <DistributedAgentTeamsView
      topology={state.topology}
      assignmentEvents={state.assignmentEvents}
      loading={state.loading}
      refreshing={state.refreshing}
      error={state.error}
      onRefresh={() => void state.refresh()}
    />
  );
};
