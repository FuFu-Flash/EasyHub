import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Star, UserRound } from 'lucide-react';

export function ProfileMenu({ avatar, name, onProfile, onStarred }: {
  avatar: ReactNode;
  name: string;
  onProfile: () => void;
  onStarred: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.topbar-profile')?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="profile-menu-anchor" ref={root}>
    <button type="button" className="topbar-profile" aria-label="账户菜单" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
      <span className="topbar-avatar">{avatar}</span><ChevronDown size={16} />
    </button>
    {open && <div className="profile-menu" role="menu" aria-label="账户菜单">
      <div className="profile-menu-identity"><span>当前账户</span><strong>{name}</strong></div>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onProfile(); }}><UserRound size={17} /><span>个人资料</span></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onStarred(); }}><Star size={17} /><span>我收藏的项目</span></button>
    </div>}
  </div>;
}
