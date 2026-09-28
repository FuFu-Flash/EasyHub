import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption { value: string; label: string }

export function StyledDropdown({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const pointer = (event: PointerEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('.styled-dropdown-trigger')?.focus(); }
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);

  function focusOption(index: number): void {
    requestAnimationFrame(() => root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')[index]?.focus());
  }

  return <div className="styled-dropdown" ref={root}>
    <button type="button" role="combobox" className="styled-dropdown-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled}
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); focusOption(Math.max(0, options.findIndex((option) => option.value === value))); }
      }}><span>{selected?.label ?? value}</span><ChevronDown size={16} aria-hidden="true" /></button>
    {open && <div className="styled-dropdown-menu" id={id} role="listbox" aria-label={label}>{options.map((option, index) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? 'selected' : ''} key={option.value}
      onClick={() => { onChange(option.value); setOpen(false); }} onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); focusOption((index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length); }
        if (event.key === 'Home') { event.preventDefault(); focusOption(0); }
        if (event.key === 'End') { event.preventDefault(); focusOption(options.length - 1); }
      }}><span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}</button>)}</div>}
  </div>;
}
