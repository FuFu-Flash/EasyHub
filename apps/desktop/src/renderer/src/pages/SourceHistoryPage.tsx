import { SourceHistory } from '../components/SourceHistory';

import { useWorkspace } from '../workspace/WorkspaceContext';
import { useRepository } from '../workspace/pageData';
import { PageStatus } from './shared';

export function SourceHistoryPage() {
  const w = useWorkspace();
  const { language, navigation } = w;
  const scrollArea = navigation.scrollArea;
  const selected = useRepository();
  if (!selected) return <PageStatus loading error="" />;
  return (
    <SourceHistory
      key={selected.id}
      repo={selected}
      language={language}
      scrollArea={scrollArea}
      onBack={() => navigation.back('project')}
    />
  );
}
