import { Clock3 } from 'lucide-react';
import type { SearchEntry, SearchScope } from '../searchHistory';

const scopeLabels: Record<SearchScope, string> = {
  local: '这台电脑',
  mine: '我的云端项目',
  forks: '仓库副本',
  public: '公开项目',
  users: '用户',
};

export function SearchHistory({ entries, onSelect, onClear }: {
  entries: SearchEntry[];
  onSelect: (entry: SearchEntry) => void;
  onClear: () => void;
}) {
  if (entries.length === 0) return null;

  return <section className="search-history panel">
    <div className="panel-heading"><Clock3 size={14} aria-hidden="true" /><h2>搜索历史</h2></div>
    <div className="search-history-list" tabIndex={0} aria-label="搜索历史">
      {entries.map((entry) => <button type="button" key={`${entry.scope}:${entry.query}`} title={`${entry.query} · ${scopeLabels[entry.scope]}`} onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })} onClick={() => onSelect(entry)}>
        <span>{entry.query}</span><small>{scopeLabels[entry.scope]}</small>
      </button>)}
    </div>
    <button type="button" className="text-link" onClick={onClear}>清除全部</button>
  </section>;
}
