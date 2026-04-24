import { SidebarCapturePanel } from "@/components/SidebarCapturePanel";
import { SidebarPickerHint } from "@/components/SidebarPickerHint";
import { usePicker } from "@/lib/picker-store";

export function SidebarShell() {
  const mode = usePicker((s) => s.mode);
  const capture = usePicker((s) => s.capture);

  return (
    <div className="rmk-root">
      <aside className="rmk-sidebar" aria-label="Remarks sidebar">
        <header className="rmk-sidebar-header">Remarks</header>
        <div className="rmk-sidebar-body">
          {capture ? (
            <SidebarCapturePanel capture={capture} />
          ) : (
            <SidebarPickerHint active={mode === "element"} />
          )}
        </div>
      </aside>
    </div>
  );
}
