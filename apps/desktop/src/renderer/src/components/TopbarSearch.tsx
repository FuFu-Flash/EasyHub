import { useTranslation } from '../localization';
import { useId, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { Language } from '../i18n';

export interface SearchProject {
  key: string;
  name: string;
  detail?: string;
  avatar?: string;
  onOpen: () => void;
}
export function TopbarSearch({
  query,
  onQueryChange,
  projects,
  onSearch,
  language,
  scope = 'projects',
}: {
  query: string;
  onQueryChange: (query: string) => void;
  projects: SearchProject[];
  onSearch: (query: string, scope: 'projects' | 'users') => void;
  language: Language;
  scope?: 'projects' | 'users';
}) {
  const t = useTranslation(language);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const composing = useRef(false);

  const value = query.trim();
  const matches = value
    ? projects.filter((project) => project.name.toLocaleLowerCase().includes(value.toLocaleLowerCase())).slice(0, 8)
    : [];
  const options = [
    ...matches.map((project) => ({
      key: project.key,
      label: project.name,
      detail: project.detail,
      avatar: project.avatar,
      action: project.onOpen,
    })),
    ...(value.length >= 2
      ? (['projects', 'users'] as const).map((target) => ({
          key: target,
          label:
            target === 'projects'
              ? t('topbarSearch.searchPublicProjects', { p0: value })
              : t('topbarSearch.searchUsers', { p0: value }),
          detail: undefined,
          avatar: undefined,
          action: () => onSearch(value, target),
        }))
      : []),
  ];
  function choose(index: number): void {
    const option = options[index];
    if (!option) return;
    setOpen(false);
    setActive(-1);
    option.action();
  }
  return (
    <div
      className="topbar-search-container"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <div className="topbar-search">
        <Search size={20} />
        <input
          ref={input}
          role="combobox"
          aria-label={t('topbarSearch.searchProjectsUsers')}
          aria-autocomplete="list"
          aria-expanded={open && Boolean(value)}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
          placeholder={t('topbarSearch.searchProjectsUsers2')}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActive((previous) =>
                options.length
                  ? previous < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : options.length - 1
                    : (previous + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                  : -1,
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (open && active >= 0) choose(active);
              else if (value.length >= 2) {
                setOpen(false);
                onSearch(value, scope);
              }
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label={t('topbarSearch.clearSearch')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onQueryChange('');
              setActive(-1);
              setOpen(false);
              input.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>
      {open && value && (
        <div
          className="topbar-search-suggestions"
          id={`${id}-list`}
          role="listbox"
          aria-label={t('topbarSearch.searchSuggestions')}
        >
          {matches.length > 0 && (
            <div className="topbar-search-group" role="presentation">
              {t('topbarSearch.myProjects')}
            </div>
          )}
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={active === index}
              id={`${id}-${index}`}
              key={option.key}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              {option.avatar ? <img src={option.avatar} alt="" /> : <Search size={16} />}
              <span>
                <strong>{option.label}</strong>
                {option.detail && <small>{option.detail}</small>}
              </span>
            </button>
          ))}
          {value.length < 2 && <p>{t('topbarSearch.enterAtLeast2CharactersToSearchPublicProjects')}</p>}
        </div>
      )}
    </div>
  );
}
