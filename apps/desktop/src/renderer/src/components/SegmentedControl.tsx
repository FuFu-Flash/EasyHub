import { Children, cloneElement, isValidElement, useLayoutEffect, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

interface IndicatorPosition {
  transform: string;
  width: string;
  height: string;
}

// Where each shared tab bar last showed its selection. Pages that cache one copy per tab
// render a new bar on every switch; the new bar slides from here instead of jumping.
const lastPositions = new Map<string, IndicatorPosition>();

/** Keeps each option's existing click behavior, with one measured selection background. */
export function SegmentedControl({
  children,
  className = '',
  motionKey,
  ...props
}: HTMLAttributes<HTMLDivElement> & { motionKey?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const measureSelection = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const group = container.current;
    if (!group) return;
    const indicator = group.querySelector<HTMLElement>(':scope > .segmented-indicator');
    if (!indicator) return;
    const buttons = (): HTMLButtonElement[] => [...group.querySelectorAll<HTMLButtonElement>(':scope > button')];
    let shown = false;
    const place = (position: IndicatorPosition): void => {
      indicator.style.transform = position.transform;
      indicator.style.width = position.width;
      indicator.style.height = position.height;
    };
    const measure = (): void => {
      const selected = group.querySelector<HTMLButtonElement>(':scope > button.selected');
      if (!selected || !selected.offsetWidth || !selected.offsetHeight) {
        delete group.dataset.segmentedReady;
        shown = false;
        return;
      }
      const groupRect = group.getBoundingClientRect();
      const buttonRect = selected.getBoundingClientRect();
      const target = {
        transform: `translate3d(${buttonRect.left - groupRect.left - group.clientLeft + group.scrollLeft}px, ${buttonRect.top - groupRect.top - group.clientTop + group.scrollTop}px, 0)`,
        width: `${buttonRect.width}px`,
        height: `${buttonRect.height}px`,
      };
      const previous = motionKey ? lastPositions.get(motionKey) : undefined;
      if (!shown && previous && previous.transform !== target.transform) {
        // Start where the last bar for this key left off, then let the transition carry it over.
        delete group.dataset.segmentedMotion;
        place(previous);
        group.dataset.segmentedReady = 'true';
        void indicator.offsetWidth;
        group.dataset.segmentedMotion = 'true';
      }
      shown = true;
      place(target);
      if (motionKey) lastPositions.set(motionKey, target);
      indicator.style.borderRadius = getComputedStyle(selected).borderRadius;
      group.dataset.segmentedReady = 'true';
    };
    measureSelection.current = measure;
    measure();
    // First paint starts under the already selected option, including restored pages.
    const frame = requestAnimationFrame(() => {
      group.dataset.segmentedMotion = 'true';
    });
    const resize = new ResizeObserver(measure);
    resize.observe(group);
    for (const button of buttons()) resize.observe(button);
    const mutations = new MutationObserver(() => {
      // Counts and translated option labels can change width without a selection change.
      resize.disconnect();
      resize.observe(group);
      for (const button of buttons()) resize.observe(button);
      measure();
    });
    mutations.observe(group, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-pressed'],
    });
    group.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      group.removeEventListener('scroll', measure);
      measureSelection.current = null;
    };
  }, [motionKey]);

  useLayoutEffect(() => {
    measureSelection.current?.();
  });

  return (
    <div
      {...props}
      role={props.role ?? 'group'}
      ref={container}
      className={`segmented segmented-animated ${className}`.trim()}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (
          props.role !== 'tablist' ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
        )
          return;
        const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')];
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next]?.focus();
        tabs[next]?.click();
      }}
    >
      <div className="segmented-indicator" aria-hidden="true" />
      {Children.map(children, (child) => {
        if (!isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(child) || child.type !== 'button') return child;
        const selected = child.props.className?.split(/\s+/u).includes('selected') ?? false;
        return cloneElement(
          child,
          props.role === 'tablist'
            ? { role: 'tab', 'aria-selected': selected, tabIndex: selected ? 0 : -1 }
            : { 'aria-pressed': child.props['aria-pressed'] ?? selected },
        );
      })}
    </div>
  );
}
