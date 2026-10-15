import { useTranslation } from '../localization';
import { Search } from 'lucide-react';

export function SearchEmptyState({ onClear, language }: { onClear: () => void; language?: string }) {
  const t = useTranslation(language === undefined ? undefined : language === 'en' ? 'en' : 'zh');
  return (
    <div className="empty-state search-empty-state" role="status">
      <span className="empty-icon">
        <Search size={25} />
      </span>
      <h3>{t('searchEmptyState.noMatchingResults')}</h3>
      <p>{t('searchEmptyState.tryAnotherKeywordOrClearTheSearchToBrowse')}</p>
      <button type="button" className="button button-quiet" onClick={onClear}>
        {t('searchEmptyState.clearSearch')}
      </button>
    </div>
  );
}
