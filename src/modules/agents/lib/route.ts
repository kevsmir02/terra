import { usePreferencesStore } from "@/modules/settings/preferences";
import { useAgentStore } from "../store/agentStore";
import type { AgentSource, NotificationKind } from "./types";

type RouteArgs = {
  source: AgentSource;
  agent: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  focused: boolean;
  /** True when the user is currently looking at this agent. */
  visible: boolean;
  /** Allow an in-app toast when focused but not looking at the agent. */
  allowToast: boolean;
  tabId?: number;
  leafId?: number;
  onActivate: () => void;
};

export function routeAgentNotification({
  source,
  agent,
  kind,
  title,
  body,
  focused,
  visible,
  allowToast,
  tabId = 0,
  leafId = 0,
  onActivate,
}: RouteArgs): void {
  if (!usePreferencesStore.getState().agentNotifications) return;
  if (focused && visible) return;

  useAgentStore
    .getState()
    .pushNotification({ source, agent, kind, tabId, leafId });

  if (!focused) {
    // The notification plugin's client loads on the first desktop alert.
    void import("./notify")
      .then((m) => m.osNotify(title, body ?? agent))
      .catch(() => undefined);
    return;
  }
  if (allowToast) {
    // The toast and its brand icons load with the first in-app alert.
    void import("../components/AgentToast")
      .then((m) => m.showAgentToast({ agent, title, body, onActivate }))
      .catch(() => undefined);
  }
}
