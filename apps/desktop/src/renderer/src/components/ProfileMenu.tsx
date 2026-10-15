import { useTranslation } from '../localization';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Star, UserRound } from 'lucide-react';

export function ProfileMenu({ avatar, name, onProfile, onStarred }: {
  avatar: ReactNode;
  name: string;
  onProfile: () => void;
  onStarred: () => void;
}) {
  const t = useTranslation();
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
    <button type="button" className="topbar-profile" title={name} aria-label={t("profileMenu.accountMenu")} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
      <span className="topbar-avatar">{avatar}</span><ChevronDown size={16} />
    </button>
    {open && <div className="profile-menu" role="menu" aria-label={t("profileMenu.accountMenu")}>
      <div className="profile-menu-identity"><span>{t("profileMenu.currentAccount")}</span><strong>{name}</strong></div>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onProfile(); }}><UserRound size={17} /><span>{t("profileMenu.profile")}</span></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onStarred(); }}><Star size={17} /><span>{t("profileMenu.starredProjects")}</span></button>
    </div>}
  </div>;
}
