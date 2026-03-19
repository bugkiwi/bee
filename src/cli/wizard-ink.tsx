import { useMemo, useState } from "react";
import { Box, Text, render, useInput } from "ink";
import { ConfirmInput, MultiSelect, Select } from "@inkjs/ui";
import type { WorkspaceConfig } from "../types/config.ts";
import { writeJsonFile } from "../utils/fs.ts";
import { rtkStatus } from "../plugins/rtk.ts";

type ProviderChoice = "claude" | "codex" | "kimi";
type FeatureToggle = "use_rtk" | "edit_mode" | "use_plugins";
type WizardStep = "provider" | "features" | "confirm";

const PROVIDERS: Array<{ key: ProviderChoice; label: string; desc: string }> = [
  {
    key: "claude",
    label: "Claude",
    desc: "Anthropic Claude CLI",
  },
  {
    key: "codex",
    label: "Codex",
    desc: "OpenAI Codex CLI",
  },
  {
    key: "kimi",
    label: "Kimi",
    desc: "Moonshot Kimi CLI",
  },
];

function normalizeProvider(provider: string): ProviderChoice {
  if (provider === "codex" || provider === "kimi") return provider;
  return "claude";
}

interface SetupWizardProps {
  initialProvider: ProviderChoice;
  initialFeatures: FeatureToggle[];
  rtkAvailable: boolean;
  rtkVersion?: string;
  onSubmit: (provider: ProviderChoice, features: FeatureToggle[]) => void;
  onCancel: () => void;
}

function SetupWizard({
  initialProvider,
  initialFeatures,
  rtkAvailable,
  rtkVersion,
  onSubmit,
  onCancel,
}: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>("provider");
  const [provider, setProvider] = useState<ProviderChoice>(initialProvider);
  const [features, setFeatures] = useState<FeatureToggle[]>(initialFeatures);

  const providerOptions = useMemo(
    () =>
      PROVIDERS.map((item) => ({
        value: item.key,
        label: `${item.label}  ${item.desc}`,
      })),
    []
  );

  const featureOptions = useMemo(() => {
    const options: Array<{ value: FeatureToggle; label: string }> = [
      { value: "edit_mode", label: "Edit mode (provider can edit files)" },
      { value: "use_plugins", label: "Plugin pipeline (context/diff/critic)" },
    ];
    if (rtkAvailable) {
      options.unshift({
        value: "use_rtk",
        label: `RTK token savings${rtkVersion ? ` (${rtkVersion})` : ""}`,
      });
    }
    return options;
  }, [rtkAvailable, rtkVersion]);

  useInput((input, key) => {
    if (key.escape || (key.ctrl && (input === "c" || input === "d"))) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyan">BEE First Run Setup</Text>
      <Text dimColor>Esc cancel • Enter confirm • Space toggle checkbox</Text>
      <Text>{""}</Text>

      {step === "provider" ? (
        <Box flexDirection="column">
          <Text bold>1. Provider (single select)</Text>
          <Select
            options={providerOptions}
            defaultValue={provider}
            onChange={(value) => {
              const next = normalizeProvider(value);
              setProvider(next);
              setStep("features");
            }}
          />
        </Box>
      ) : null}

      {step === "features" ? (
        <Box flexDirection="column">
          <Text bold>2. Features (checkbox)</Text>
          <Text dimColor>{rtkAvailable ? "RTK detected." : "RTK not found; RTK option hidden."}</Text>
          <MultiSelect
            options={featureOptions}
            defaultValue={features}
            onChange={(value) => {
              const next = value.filter(
                (v): v is FeatureToggle => v === "use_rtk" || v === "edit_mode" || v === "use_plugins"
              );
              setFeatures(next);
            }}
            onSubmit={(value) => {
              const next = value.filter(
                (v): v is FeatureToggle => v === "use_rtk" || v === "edit_mode" || v === "use_plugins"
              );
              setFeatures(next);
              setStep("confirm");
            }}
          />
        </Box>
      ) : null}

      {step === "confirm" ? (
        <Box flexDirection="column">
          <Text bold>3. Confirm</Text>
          <Text>{`provider: ${provider}`}</Text>
          <Text>{`features: ${features.length > 0 ? features.join(", ") : "none"}`}</Text>
          <Text>
            <Text dimColor>Save these settings? </Text>
            <ConfirmInput
              defaultChoice="confirm"
              onConfirm={() => onSubmit(provider, features)}
              onCancel={() => setStep("features")}
            />
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export async function runFirstRunWizardInk(
  config: WorkspaceConfig,
  configPath: string
): Promise<WorkspaceConfig> {
  const rtk = await rtkStatus();
  const initialProvider = normalizeProvider(config.provider);
  const initialFeatures: FeatureToggle[] = [];

  if (config.edit_mode) initialFeatures.push("edit_mode");
  if (config.use_plugins) initialFeatures.push("use_plugins");
  if (rtk.available && config.use_rtk) initialFeatures.push("use_rtk");

  return await new Promise<WorkspaceConfig>((resolve, reject) => {
    let settled = false;

    const finalize = async (updated: WorkspaceConfig) => {
      if (settled) return;
      settled = true;
      try {
        await writeJsonFile(configPath, updated);
      } catch (err) {
        reject(err);
        return;
      }
      resolve(updated);
      app.unmount();
    };

    const app = render(
      <SetupWizard
        initialProvider={initialProvider}
        initialFeatures={initialFeatures}
        rtkAvailable={rtk.available}
        rtkVersion={rtk.version}
        onSubmit={(provider, features) => {
          const updated: WorkspaceConfig = {
            ...config,
            provider,
            use_rtk: rtk.available ? features.includes("use_rtk") : false,
            edit_mode: features.includes("edit_mode"),
            use_plugins: features.includes("use_plugins"),
            _initialized: true,
          };
          void finalize(updated);
        }}
        onCancel={() => {
          const updated: WorkspaceConfig = {
            ...config,
            _initialized: true,
          };
          void finalize(updated);
        }}
      />,
      { exitOnCtrlC: false }
    );

    void app.waitUntilExit().catch((err) => {
      if (!settled) reject(err);
    });
  });
}

