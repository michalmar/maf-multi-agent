import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { useTheme } from "./use-theme";

function ThemeHarness() {
  const { theme, toggleTheme } = useTheme();

  return React.createElement(
    "button",
    { type: "button", onClick: toggleTheme },
    theme,
  );
}

describe("useTheme", () => {
  it("uses the bootstrap DOM theme when no saved preference exists", () => {
    document.documentElement.setAttribute("data-theme", "night");

    render(React.createElement(ThemeHarness));

    expect(screen.getByRole("button", { name: "night" })).toBeInTheDocument();
    expect(window.localStorage.getItem("maf-theme")).toBe("night");
  });

  it("prefers a saved theme over the bootstrap DOM attribute", () => {
    document.documentElement.setAttribute("data-theme", "night");
    window.localStorage.setItem("maf-theme", "daybreak");

    render(React.createElement(ThemeHarness));

    expect(screen.getByRole("button", { name: "daybreak" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "daybreak");
  });

  it("toggles and persists the next theme", async () => {
    document.documentElement.setAttribute("data-theme", "night");
    const user = userEvent.setup();

    render(React.createElement(ThemeHarness));
    await user.click(screen.getByRole("button", { name: "night" }));

    expect(screen.getByRole("button", { name: "daybreak" })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "daybreak");
    expect(window.localStorage.getItem("maf-theme")).toBe("daybreak");
  });
});
