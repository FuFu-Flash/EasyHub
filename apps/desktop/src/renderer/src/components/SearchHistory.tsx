import { useTranslation } from '../localization';
import { Clock3 } from 'lucide-react';
import type { SearchEntry, SearchScope } from '../searchHistory';

export function SearchHistory({
  entries,
  onSelect,
  onClear,
}: {
  entries: SearchEntry[];
  onSelect: (entry: SearchEntry) => void;
  onClear: () => void;
}) {
  const t = useTranslation();
  const scopeLabels: Record<SearchScope, string> = {
    local: t('searchHistory.thisComputer'),
    mine: t('searchHistory.cloudProjects'),
    forks: t('searchHistory.repositoryCopies'),
    public: t('searchHistory.publicProjects'),
    users: t('searchHistory.users'),
  };
  if (entries.length === 0) return null;

  return (
    <section className="search-history panel">
      <div className="panel-heading">
        <Clock3 size={14} aria-hidden="true" />
        <h2>{t('searchHistory.searchHistory')}</h2>
      </div>
      <div className="search-history-list" tabIndex={0} aria-label={t('searchHistory.searchHistory')}>
        {entries.map((entry) => (
          <button
            type="button"
            key={`${entry.scope}:${entry.query}`}
            title={`${entry.query} · ${scopeLabels[entry.scope]}`}
            onFocus={(event) =>
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
            }
            onClick={() => onSelect(entry)}
          >
            <span>{entry.query}</span>
            <small>{scopeLabels[entry.scope]}</small>
          </button>
        ))}
      </div>
      <button type="button" className="text-link" onClick={onClear}>
        {t('searchHistory.clearAll')}
      </button>
    </section>
  );
}
