import { Search } from 'lucide-react';

export function SearchEmptyState({ onClear, language = 'zh' }: { onClear: () => void; language?: string }) {
  const english = language === 'en';
  return <div className="empty-state search-empty-state" role="status">
    <span className="empty-icon"><Search size={25} /></span>
    <h3>{english ? 'No matching results' : '没有找到符合条件的结果'}</h3>
    <p>{english ? 'Try another keyword, or clear the search to browse again.' : '换个关键词试试，或清除搜索继续浏览。'}</p>
    <button type="button" className="button button-quiet" onClick={onClear}>{english ? 'Clear search' : '清除搜索'}</button>
  </div>;
}
