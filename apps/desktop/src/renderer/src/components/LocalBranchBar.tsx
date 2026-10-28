import { useEffect, useState, type FormEvent } from 'react';
import { GitBranch } from 'lucide-react';

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
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let active = true;
    void easyHub
      ?.localListBranches(id)
      .then((list) => {
        if (active) setBranches(list.branches.includes(current) ? list.branches : [current, ...list.branches]);
      })
      .catch(() => undefined);
    // The branch list changes only when the project moves to another branch.
    return () => {
      active = false;
    };
  }, [easyHub, id, current]);
  useEffect(() => {
    setCreating(false);
    setName('');
  }, [current]);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (name.trim()) void onCreate(name.trim());
  }

  return (
    <div className="local-branch">
      <GitBranch size={16} aria-hidden="true" />
      <select
        className="local-branch-select"
        aria-label={t('localWorkspace.switchBranch')}
        value={current}
        disabled={busy}
        onChange={(event) => void onSwitch(event.target.value)}
      >
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
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
