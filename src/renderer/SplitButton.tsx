import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

type SplitButtonProps = {
  className?: string | undefined;
  disabled?: boolean | undefined;
  label: string;
  leadingIcon?: ReactNode;
  menuLabel: string;
  onPrimaryClick(): void;
  onSecondaryClick(): void;
};

export function SplitButton({
  className,
  disabled,
  label,
  leadingIcon,
  menuLabel,
  onPrimaryClick,
  onSecondaryClick
}: SplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (disabled) {
      setMenuOpen(false);
    }
  }, [disabled]);

  return (
    <div className={`split-button ${className ?? ""}`.trim()} ref={rootRef}>
      <button className="split-button__segment split-button__segment--main" disabled={disabled} onClick={onPrimaryClick}>
        {leadingIcon}
        <span>{label}</span>
      </button>
      <button
        className="split-button__segment split-button__segment--arrow"
        aria-label={menuLabel}
        disabled={disabled}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <ChevronDown size={14} />
      </button>

      {menuOpen ? (
        <div className="split-button__menu">
          <button
            className="split-button__menu-item"
            disabled={disabled}
            onClick={() => {
              setMenuOpen(false);
              onSecondaryClick();
            }}
          >
            <span>{menuLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
