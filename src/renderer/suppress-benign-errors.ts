const BENIGN_ERROR =
  /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i;

function isBenignError(message: string): boolean {
  return BENIGN_ERROR.test(message);
}

window.addEventListener(
  "error",
  (event) => {
    if (isBenignError(event.message)) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  },
  true
);

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  if (isBenignError(message)) {
    event.preventDefault();
  }
});