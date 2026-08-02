import { render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { describe, expect, it } from "vitest";
import { CapabilityNotice, EmptyState, ErrorState } from "./FoundationStates";

function renderWithTheme(node: React.ReactNode) {
  return render(<Theme>{node}</Theme>);
}

describe("foundation states", () => {
  it("shows actionable empty and error copy", () => {
    renderWithTheme(
      <>
        <EmptyState title="No files" description="Choose a file to begin." />
        <ErrorState message="The file could not be read." />
      </>,
    );
    expect(screen.getByRole("heading", { name: "No files" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be read");
  });

  it("only renders a capability warning when support is missing", () => {
    const { rerender } = renderWithTheme(<CapabilityNotice missing={[]} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <Theme>
        <CapabilityNotice missing={["webGpu"]} />
      </Theme>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("WebGPU");
  });
});
