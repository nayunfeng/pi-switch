import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  title?: string;
  className?: string;
  "aria-label"?: string;
};

type ListboxPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  flip: boolean;
};

const LIST_GAP = 6;
const LIST_MARGIN = 8;
const MAX_LIST_HEIGHT = 280;

export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  id,
  title,
  className,
  "aria-label": ariaLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<ListboxPosition>();
  const [container, setContainer] = useState<HTMLElement>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reactId = useId();
  const listboxId = `${id ?? "select"}-${reactId}-listbox`;
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const displayLabel = selectedOption?.label ?? placeholder ?? "";

  const computePosition = (): ListboxPosition | undefined => {
    const trigger = triggerRef.current;
    if (!trigger) return undefined;
    const rect = trigger.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom - LIST_MARGIN;
    const spaceAbove = rect.top - LIST_MARGIN;
    const flip = spaceBelow < Math.min(MAX_LIST_HEIGHT, 200) && spaceAbove > spaceBelow;
    const available = flip ? spaceAbove - LIST_GAP : spaceBelow - LIST_GAP;
    const maxHeight = Math.max(120, Math.min(MAX_LIST_HEIGHT, available));
    return {
      left: rect.left,
      width: rect.width,
      top: flip ? rect.top - LIST_GAP : rect.bottom + LIST_GAP,
      maxHeight,
      flip,
    };
  };

  const openListbox = () => {
    if (disabled) return;
    // Portal into the nearest open <dialog> so the listbox joins the dialog's
    // top-layer subtree; otherwise a body-level listbox renders *under* any
    // modal dialog (dialog.showModal() promotes the dialog to the top layer,
    // where it ignores z-index). Falls back to document.body when not inside a
    // modal dialog (e.g. settings popover / table rows).
    const host = triggerRef.current?.closest<HTMLElement>("dialog[open]") ?? document.body;
    setContainer(host);
    setPosition(computePosition());
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options));
    setOpen(true);
  };

  const closeListbox = (refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    closeListbox();
  };

  // Position synchronously before paint to avoid a flash at the wrong spot.
  useLayoutEffect(() => {
    if (!open) return;
    setPosition(computePosition());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on outside interaction, scroll, resize.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      closeListbox(false);
    };
    const onScroll = (event: Event) => {
      // Ignore the listbox's own scroll (mouse wheel / dragging its scrollbar);
      // only close when an outer container (dialog / form / page) scrolls.
      if (listRef.current && event.target instanceof Node && listRef.current.contains(event.target)) {
        return;
      }
      closeListbox(false);
    };
    const onResize = () => closeListbox(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onResize);
    // capture=true so scrolls inside dialogs / .prov-form also close the listbox
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const item = list?.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const moveActive = (delta: number) => {
    setActiveIndex((current) => {
      const start = current < 0 ? selectedIndex : current;
      return nextEnabledIndex(options, start, delta);
    });
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openListbox();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(firstEnabledIndex(options));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(lastEnabledIndex(options));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (activeIndex >= 0) selectIndex(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        closeListbox();
        break;
      case "Tab":
        closeListbox(false);
        break;
    }
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        title={title}
        aria-label={ariaLabel}
        className={`app-select ${className ?? ""}`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => (open ? closeListbox() : openListbox())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`app-select-value ${selectedOption ? "" : "placeholder"}`}>{displayLabel}</span>
        <ChevronDown size={14} className="app-select-chevron" aria-hidden="true" />
      </button>
      {open && position
        ? createPortal(
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              data-listbox=""
              tabIndex={-1}
              className="app-select-listbox"
              style={{
                left: position.left,
                width: position.width,
                maxHeight: position.maxHeight,
                ...(position.flip
                  ? { bottom: window.innerHeight - position.top }
                  : { top: position.top }),
              }}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={`app-select-option ${index === activeIndex ? "active" : ""} ${
                    option.value === value ? "selected" : ""
                  } ${option.disabled ? "disabled" : ""}`}
                  onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectIndex(index)}
                >
                  <span className="app-select-option-label">{option.label}</span>
                  {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
                </li>
              ))}
            </ul>,
            container ?? document.body,
          )
        : null}
    </>
  );
}

function firstEnabledIndex(options: SelectOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

function lastEnabledIndex(options: SelectOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index].disabled) return index;
  }
  return -1;
}

function nextEnabledIndex(options: SelectOption[], start: number, delta: number): number {
  if (options.length === 0) return -1;
  let index = start;
  for (let step = 0; step < options.length; step += 1) {
    index += delta;
    if (index < 0) index = options.length - 1;
    if (index >= options.length) index = 0;
    if (!options[index].disabled) return index;
  }
  return start;
}
