import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { MenuCommand } from '../../../shared/applicationMenu';
import { useApplicationMenu } from '../useApplicationMenu';
import { synchronizeWindowControlStyle } from '../windowControlStyle';
import { useTranslation } from '../localization';
import { useWorkspace } from './WorkspaceContext';

/** Native commands enter the same navigation stack as the visible controls. */
export function useNativeShell(root: RefObject<HTMLDivElement | null>, refreshing: boolean): void {
  const workspace = useWorkspace();
  const t = useTranslation(workspace.language);
  const { navigation, language, windowStyle, layout, demo } = workspace;
  const [focus, setFocus] = useState<{ target: 'proxy' | 'add-folder' | 'download-project'; revision: number }>();
  const initial = useRef(workspace.initialMenuCommand);

  const command = (value: MenuCommand): void => {
    if (value === 'refresh') {
      root.current?.querySelector<HTMLButtonElement>('.sidebar-refresh')?.click();
    } else if (value === 'search') {
      root.current?.querySelector<HTMLInputElement>('.topbar-search input')?.focus();
    } else if (value === 'profile') {
      navigation.navigate('profile', { login: workspace.user.login, section: 'profile' });
    } else if (value === 'starred') {
      navigation.navigate('starred', { visit: Date.now(), section: 'profile' });
    } else if (value === 'reviews') {
      navigation.sidebar('pulls');
    } else if (value === 'proxy-settings') {
      setFocus((old) => ({ target: 'proxy', revision: (old?.revision ?? 0) + 1 }));
      navigation.sidebar('settings');
    } else if (value === 'add-folder') {
      setFocus((old) => ({ target: value, revision: (old?.revision ?? 0) + 1 }));
      navigation.navigate('local', { section: 'projects' });
    } else if (value === 'download-project') {
      setFocus((old) => ({ target: value, revision: (old?.revision ?? 0) + 1 }));
      navigation.navigate('local', { section: 'projects' });
    } else if (value === 'new-project') {
      navigation.navigate('new-project');
    } else {
      navigation.sidebar(value);
    }
  };

  useApplicationMenu(
    { language, signedIn: !demo, busy: refreshing || workspace.loading, demoOnly: Boolean(demo?.only) },
    command,
  );
  useEffect(() => {
    const pending = initial.current;
    if (pending) {
      initial.current = undefined;
      command(pending);
    }
  }, []);
  useLayoutEffect(() => {
    let active = true;
    void synchronizeWindowControlStyle(windowStyle, layout.density).catch(() => {
      if (active) workspace.setError(t('mac.windowControlsFailed'));
    });
    return () => {
      active = false;
    };
  }, [windowStyle, layout.density, language]);
  useEffect(() => {
    if (!focus || navigation.page.view !== (focus.target === 'proxy' ? 'settings' : 'local')) return;
    const frame = requestAnimationFrame(() => {
      const selector =
        focus.target === 'proxy'
          ? '.github-proxy-panel'
          : focus.target === 'add-folder'
            ? '.local-workspace > section.panel.live-section:first-of-type'
            : '.local-workspace > section.panel.live-section:last-child';
      const target = [...(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (element) => element.getClientRects().length > 0,
      );
      target?.scrollIntoView({ block: 'center' });
      target?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focus, navigation.key, root]);
}
