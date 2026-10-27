import { useCallback } from 'react';
import { PublicProjectBrowser } from '../components/PublicProjectBrowser';
import { TranslationPreferencesContext } from '../components/TranslatableContent';

import { usePageRoute } from '../workspace/NavigationContext';
import { isSearchResults } from '../workspace/navigation';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { useRepository } from '../workspace/pageData';
import { PageStatus } from './shared';

export function PublicPage() {
  const w = useWorkspace();
  const { user, language, automaticTranslation, translationTarget, translationNames, downloads, navigation } = w;
  const { params } = usePageRoute();
  const { openReadmeLink, openCreatedFork } = usePageActions();
  const scrollArea = navigation.scrollArea;
  const navigateSidebar = navigation.sidebar;

  const publicSelected = useRepository();
  const onPageChange = useCallback(
    (key: string) => {
      if (key !== params.nestedKey) navigation.updateParams({ nestedKey: key });
    },
    [params.nestedKey],
  );
  if (!publicSelected) return <PageStatus loading error="" />;

  return (
    <TranslationPreferencesContext.Provider
      value={{
        automatic: automaticTranslation && !publicSelected.private,
        target: translationTarget,
        repository: {
          name: publicSelected.name,
          owner: publicSelected.owner.login,
          fullName: publicSelected.full_name,
        },
        names: translationNames,
      }}
    >
      <PublicProjectBrowser
        outerBackBoundary={params.outerBoundary}
        onPageChange={onPageChange}
        repo={publicSelected}
        language={language}
        currentUser={user.login}
        onBack={() => navigation.back('discover')}
        backToSearchResults={isSearchResults(navigation.previous)}
        scrollArea={scrollArea}
        onOpenLink={(url) => void openReadmeLink(url, publicSelected)}
        onDownload={(request) => void downloads.start(request)}
        onForkReady={openCreatedFork}
        onOpenAiSettings={() => navigateSidebar('settings')}
        downloadBusy={downloads.busy}
        startInDownloads={Boolean(params.download) || params.tag !== undefined}
        initialFocusTag={params.tag || undefined}
      />
    </TranslationPreferencesContext.Provider>
  );
}
