export interface GenericCliPreset {
  label: string;
  name: string;
  command: string;
  args: readonly string[];
  pty: boolean;
}

export const GENERIC_CLI_PRESETS: readonly GenericCliPreset[] = [
  {
    label: "Ollama",
    name: "Ollama",
    command: "ollama",
    args: ["run", "llama3.2", "{prompt}"],
    pty: false,
  },
  {
    label: "Aider",
    name: "Aider",
    command: "aider",
    args: ["--message", "{prompt}", "--yes"],
    pty: false,
  },
  {
    label: "Gemini CLI",
    name: "Gemini CLI",
    command: "gemini",
    args: ["-p", "{prompt}"],
    pty: false,
  },
  {
    label: "LLM (simonw)",
    name: "LLM",
    command: "llm",
    args: ["{prompt}"],
    pty: false,
  },
];

export function formatCliArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (/\s/.test(arg)) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

export function hasPromptPlaceholder(args: readonly string[]): boolean {
  return args.some((arg) => arg.includes("{prompt}"));
}

export function parseArgsText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const FR_SECONDS = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatTestDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${FR_SECONDS.format(durationMs / 1000)} s`;
}
