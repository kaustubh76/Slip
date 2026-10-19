import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Workbench } from "./Workbench.js";

describe("Workbench", () => {
  it("puts the three parts where the stylesheet expects them, in reading order", () => {
    const { container } = render(
      <Workbench rail={<p>waiting</p>} list={<p>the roll</p>} dock={<p>one slip</p>} />,
    );
    const bench = container.querySelector(".slip-workbench");
    expect([...(bench?.children ?? [])].map((part) => part.className)).toEqual([
      "slip-rail",
      "slip-listpane",
      "slip-dock",
    ]);
    expect(bench?.querySelector(".slip-rail")?.textContent).toBe("waiting");
    expect(bench?.querySelector(".slip-listpane")?.textContent).toBe("the roll");
    expect(bench?.querySelector(".slip-dock")?.textContent).toBe("one slip");
  });

  it("leaves the rail out altogether when a screen has nothing waiting to show", () => {
    const { container } = render(<Workbench list={<p>the roll</p>} dock={<p>one slip</p>} />);
    expect(container.querySelector(".slip-rail")).toBeNull();
    expect(screen.getByText("the roll")).toBeDefined();
    expect(screen.getByText("one slip")).toBeDefined();
  });
});
