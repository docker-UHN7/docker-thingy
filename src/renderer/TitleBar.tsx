import { useEffect, useState } from "react";
import { Minus, Square, SquareStack, X } from "lucide-react";
import { Logo } from "./Logo";

export function TitleBar() {
  const controls = window.dockerExplorer?.windowControls;
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!controls) {
      return;
    }

    void controls.isMaximized().then(setIsMaximized);
    return controls.subscribeMaximizeChanged(setIsMaximized);
  }, [controls]);

  return (
    <header
      className="app-titlebar"
      onDoubleClick={() => controls && void controls.toggleMaximize()}
    >
      <div className="app-titlebar__brand">
        <Logo className="app-titlebar__mark" />
        <span className="app-titlebar__title">Docker Project Explorer</span>
      </div>

      {controls ? (
        <div className="app-titlebar__controls">
          <button
            className="app-titlebar__button"
            aria-label="Minimize"
            onClick={() => void controls.minimize()}
          >
            <Minus size={14} />
          </button>
          <button
            className="app-titlebar__button"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            onClick={() => void controls.toggleMaximize()}
          >
            {isMaximized ? <SquareStack size={13} /> : <Square size={12} />}
          </button>
          <button
            className="app-titlebar__button app-titlebar__button--close"
            aria-label="Close"
            onClick={() => void controls.close()}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
