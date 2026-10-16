import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library cleans up by itself only with Vitest globals, which this repo does not use.
afterEach(() => {
  cleanup();
});

// jsdom has <dialog> but not its modal methods; these do what the kit relies on.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (this.open) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    }
  };
}
