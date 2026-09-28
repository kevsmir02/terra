import { submitToLeaf } from "@/modules/terminal/lib/useTerminalSession";
import { useResumeStore } from "../store/resumeStore";
import { resumeCommand } from "./resume";

/** Types the offered resume command into the leaf through the ordinary submit
 * path, once. False when the leaf has no offer. */
export function acceptResume(leafId: number): boolean {
  const store = useResumeStore.getState();
  const agent = store.offers[leafId];
  if (!agent) return false;
  store.dismiss(leafId);
  submitToLeaf(leafId, resumeCommand(agent));
  return true;
}
