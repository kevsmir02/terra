import { Switch } from "@/components/ui/switch";
import {
  BUILTIN_AGENT_COMMANDS,
  MAX_AGENT_COMMANDS,
  parseAgentCommands,
} from "@/modules/settings/agentCommands";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setAgentCommands,
  setAgentNotifications,
} from "@/modules/settings/store";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { SectionHeader } from "../components/SectionHeader";
import { SettingRow } from "../components/SettingRow";

export function AgentsSection() {
  const agentNotifications = usePreferencesStore((s) => s.agentNotifications);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Agents"
        description="The coding agents Terra watches in its terminals."
      />

      <div className="flex flex-col gap-2">
        <Label>Notifications</Label>
        <SettingRow
          title="Coding agent notifications"
          description="Alert when an agent running in a terminal needs your input or finishes. Desktop notification when Terra is unfocused, in-app otherwise."
        >
          <Switch
            checked={agentNotifications}
            onCheckedChange={(v) => void setAgentNotifications(v)}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Detection</Label>
        <AgentCommandsField />
      </div>
    </div>
  );
}

function AgentCommandsField() {
  const commands = usePreferencesStore((s) => s.agentCommands);
  const [draft, setDraft] = useState("");
  const [refused, setRefused] = useState<string[]>([]);
  const full = commands.length >= MAX_AGENT_COMMANDS;

  const add = () => {
    const parsed = parseAgentCommands(`${commands.join(" ")} ${draft}`);
    setRefused(parsed.refused);
    setDraft(parsed.refused.join(" "));
    if (parsed.accepted.join(" ") !== commands.join(" ")) {
      void setAgentCommands(parsed.accepted);
    }
  };

  const remove = (name: string) => {
    void setAgentCommands(commands.filter((c) => c !== name));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border/(--emph-strong) bg-card/(--emph-strong) px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium">Extra agent commands</span>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Command names treated as coding agents, beyond{" "}
          {BUILTIN_AGENT_COMMANDS.join(", ")}. Applies to terminals opened after
          the change.
        </span>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          type="text"
          value={draft}
          disabled={full}
          aria-label="Agent command names"
          aria-invalid={refused.length > 0}
          placeholder={
            full ? `Limit of ${MAX_AGENT_COMMANDS} reached` : "gemini, aider"
          }
          onChange={(e) => {
            setDraft(e.target.value);
            if (refused.length) setRefused([]);
          }}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-foreground/(--emph-soft) disabled:opacity-60 aria-invalid:border-destructive"
        />
        <button
          type="submit"
          disabled={full || draft.trim() === ""}
          className="h-8 rounded-md border border-border px-3 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {refused.length > 0 ? (
        <span className="text-[10.5px] leading-relaxed text-destructive">
          Not added: {refused.join(", ")}. Use a bare command name (letters,
          digits, dot, dash, underscore; up to 32 characters), at most{" "}
          {MAX_AGENT_COMMANDS} in all.
        </span>
      ) : null}
      {commands.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {commands.map((name) => (
            <li
              key={name}
              className="flex items-center gap-1 rounded-md border border-border/(--emph-strong) bg-background py-0.5 pr-0.5 pl-2 text-[11.5px]"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Remove ${name}`}
                className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={11}
                  strokeWidth={1.75}
                />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-[10.5px] text-muted-foreground">None added.</span>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
