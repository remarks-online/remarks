// Detects whether the extension context this content script was loaded into
// is still valid. Goes false when the user / dev reloads the extension while
// the script is still injected — at that point every chrome.* call throws
// "Extension context invalidated".
export function isExtensionContextValid(): boolean {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

export function isContextInvalidatedError(err: unknown): boolean {
  return err instanceof Error && /Extension context invalidated/i.test(err.message);
}
