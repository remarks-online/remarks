import type { BackgroundRequest, BackgroundResponse } from "@/types";

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (message: BackgroundRequest, _sender, sendResponse: (response: BackgroundResponse) => void) => {
      if (message.kind === "ping") {
        sendResponse({ ok: true, pong: Date.now() });
        return true;
      }
      sendResponse({ ok: false, error: "unknown_message_kind" });
      return true;
    }
  );
});
