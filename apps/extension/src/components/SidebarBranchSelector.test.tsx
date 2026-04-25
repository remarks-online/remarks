import { MAX_BRANCH_NAME_LENGTH } from "@remarks/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SidebarBranchSelector } from "./SidebarBranchSelector";

afterEach(() => {
  cleanup();
});

describe("SidebarBranchSelector", () => {
  test("renders the current value", () => {
    render(<SidebarBranchSelector value="feat/foo" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    expect(input.value).toBe("feat/foo");
  });

  test("typing updates the local draft without committing", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="main" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "feat/bar" } });
    expect(input.value).toBe("feat/bar");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("blur commits the trimmed draft via onChange", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="main" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  feat/bar  " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("feat/bar");
    expect(input.value).toBe("feat/bar");
  });

  test("Enter commits and blurs the input", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="main" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "release/1.0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("release/1.0");
  });

  test("blur with empty input falls back to 'main'", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="feat/foo" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("main");
    expect(input.value).toBe("main");
  });

  test("Escape reverts the draft to the prop value", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="main" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("main");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("does not call onChange when committed value equals current value", () => {
    const onChange = vi.fn();
    render(<SidebarBranchSelector value="main" onChange={onChange} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "main" } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("input is bounded by MAX_BRANCH_NAME_LENGTH", () => {
    render(<SidebarBranchSelector value="main" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_BRANCH_NAME_LENGTH);
  });

  test("syncs draft when the value prop changes", () => {
    const { rerender } = render(<SidebarBranchSelector value="main" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Branch") as HTMLInputElement;
    expect(input.value).toBe("main");
    rerender(<SidebarBranchSelector value="release/2.0" onChange={vi.fn()} />);
    expect(input.value).toBe("release/2.0");
  });
});
