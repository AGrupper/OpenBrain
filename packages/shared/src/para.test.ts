import { describe, expect, it } from "vitest";
import {
  ensureParaFolderPath,
  isParaRoot,
  PARA_DEFAULT_ROOT,
  PARA_ROOTS,
  paraRootForPath,
} from "./para";

describe("PARA helpers", () => {
  it("defines the four PARA roots in display order", () => {
    expect(PARA_ROOTS).toEqual(["Projects", "Areas", "Resources", "Archive"]);
    expect(PARA_DEFAULT_ROOT).toBe("Resources");
  });

  it("detects root folders and paths under roots", () => {
    expect(isParaRoot("Projects")).toBe(true);
    expect(isParaRoot("Inbox")).toBe(false);
    expect(paraRootForPath("Areas/Health")).toBe("Areas");
    expect(paraRootForPath("notes/meeting.md")).toBeNull();
  });

  it("places non-PARA folders under Resources by default", () => {
    expect(ensureParaFolderPath("notes/meeting")).toBe("Resources/notes/meeting");
    expect(ensureParaFolderPath("Projects/OpenBrain")).toBe("Projects/OpenBrain");
    expect(ensureParaFolderPath("")).toBe("Resources");
  });
});
