import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, ChevronDown, GitBranch } from 'lucide-react';

import { useEasyHub } from '../bridge';
import { useTranslation } from '../localization';

interface Props {
  id: string;
  current: string;
  busy: boolean;
  onSwitch: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

/** Shows the branch the project is on, with a way to switch to another one or start a new one. */
export function LocalBranchBar({ id, current, busy, onSwitch, onCreate }: Props) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [branches, setBranches] = useState<string[]>([current]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let active = true;
    void easyHub
      ?.localListBranches(id)
      .then((result) => {
        if (active) setBranches(result.branches.includes(current) ? result.branches : [current, ...result.branches]);
      })
      .catch(() => undefined);
    // The branch list changes only when the project moves to another branch.
    return () => {
      active = false;
    };
  }, [easyHub, id, current]);
  useEffect(() => {
    setOpen(false);
    setCreating(false);
    setName('');
  }, [current]);
  useEffect(() => {
    if (!open) return undefined;
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    const close = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function choose(branch: string): void {
    setOpen(false);
    trigger.current?.focus();
    if (branch !== current) void onSwitch(branch);
  }
  function move(event: KeyboardEvent<HTMLUListElement>): void {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
    }
  }
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) void onCreate(name.trim());
  }

  return (
    <div className="local-branch" ref={root}>
      <div className="local-branch-picker">
        <button
          ref={trigger}
          className="local-branch-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={t('localWorkspace.switchBranch')}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          <GitBranch size={15} aria-hidden="true" />
          <span>{current}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open && (
          <ul
            ref={list}
            className="local-branch-menu"
            role="listbox"
            aria-label={t('localWorkspace.switchBranch')}
            onKeyDown={move}
          >
            {branches.map((branch) => (
              <li
                key={branch}
                role="option"
                tabIndex={-1}
                aria-selected={branch === current}
                onClick={() => choose(branch)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    choose(branch);
                  }
                }}
              >
                <span>{branch}</span>
                {branch === current && <Check size={14} aria-hidden="true" />}
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating ? (
        <form className="local-branch-form" onSubmit={submit}>
          <input
            autoFocus
            aria-label={t('localWorkspace.newBranchName')}
            placeholder={t('localWorkspace.newBranchName')}
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="button button-quiet" type="submit" disabled={busy || !name.trim()}>
            {t('localWorkspace.createAndSwitchBranch')}
          </button>
          <button className="text-link" type="button" disabled={busy} onClick={() => setCreating(false)}>
            {t('localWorkspace.cancel')}
          </button>
        </form>
      ) : (
        <button className="text-link" type="button" disabled={busy} onClick={() => setCreating(true)}>
          {t('localWorkspace.newBranch')}
        </button>
      )}
    </div>
  );
}
