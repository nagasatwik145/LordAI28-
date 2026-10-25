import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, GitCompareArrows, Loader2, RefreshCw, Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AppShell } from "@/components/lord/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requestWhatIf } from "@/lib/what-if/api-client";
import {
  analyzeScenario,
  WhatIfScenarioSchema,
  type WhatIfOption,
  type WhatIfPriority,
  type WhatIfScenario,
} from "@/lib/what-if/scenarios";

export const Route = createFileRoute("/_authenticated/what-if")({
  head: () => ({
    meta: [
      { title: "LORD — What-If Lab" },
      {
        name: "description",
        content: "Compare scenarios with transparent estimates and assumptions.",
      },
    ],
  }),
  component: WhatIfPage,
});

const SavedScenarioSchema = z.object({
  id: z.string().uuid(),
  scenario_group_id: z.string().uuid(),
  revision: z.number().int(),
  title: z.string(),
  data: WhatIfScenarioSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
type SavedScenario = z.infer<typeof SavedScenarioSchema>;
const SavedListSchema = z.object({ scenarios: z.array(SavedScenarioSchema) });
const SaveResponseSchema = z.object({ saved: SavedScenarioSchema });
const GenerateResponseSchema = z.object({
  scenario: WhatIfScenarioSchema,
  modelContentType: z.literal("qualitative-hypothesis"),
});

function listValue(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function WhatIfPage() {
  const queryClient = useQueryClient();
  const savedQuery = useQuery({
    queryKey: ["what-if-scenarios"],
    queryFn: () => requestWhatIf(SavedListSchema),
    retry: false,
  });
  const [objective, setObjective] = useState("");
  const [constraints, setConstraints] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [proposedOptions, setProposedOptions] = useState("");
  const [timeHorizonMonths, setTimeHorizonMonths] = useState(12);
  const [priority, setPriority] = useState<WhatIfPriority>("cost");
  const [sensitivityPercent, setSensitivityPercent] = useState(10);
  const [scenario, setScenario] = useState<WhatIfScenario | null>(null);
  const [scenarioGroupId, setScenarioGroupId] = useState<string | undefined>();
  const [selectedRevisions, setSelectedRevisions] = useState<string[]>([]);
  const [busy, setBusy] = useState<"generate" | "save" | string | null>(null);

  const currentAnalysis = useMemo(() => (scenario ? analyzeScenario(scenario) : null), [scenario]);
  const compareRows = (savedQuery.data?.scenarios ?? []).filter((row) =>
    selectedRevisions.includes(row.id),
  );

  const generate = async () => {
    setBusy("generate");
    try {
      const result = await requestWhatIf(GenerateResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          action: "generate",
          objective,
          constraints: listValue(constraints),
          assumptions: listValue(assumptions),
          proposedOptions: listValue(proposedOptions),
          timeHorizonMonths,
          priority,
          sensitivityPercent,
        }),
      });
      setScenario(result.scenario);
      setScenarioGroupId(undefined);
      toast.success("Distinct scenario options are ready to review.");
    } catch (error) {
      toast.error("Could not generate scenarios", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!scenario) return;
    const validated = WhatIfScenarioSchema.safeParse(scenario);
    if (!validated.success) {
      toast.error("Review invalid scenario inputs", {
        description: validated.error.issues[0]?.message,
      });
      return;
    }
    setBusy("save");
    try {
      const result = await requestWhatIf(SaveResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          action: "save",
          scenario: validated.data,
          ...(scenarioGroupId ? { scenarioGroupId } : {}),
        }),
      });
      setScenarioGroupId(result.saved.scenario_group_id);
      await queryClient.invalidateQueries({ queryKey: ["what-if-scenarios"] });
      toast.success(`Saved revision ${result.saved.revision}.`);
    } catch (error) {
      toast.error("Could not save scenario", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const loadScenario = (row: SavedScenario) => {
    setScenario(row.data);
    setScenarioGroupId(row.scenario_group_id);
    setObjective(row.data.objective);
    setConstraints(row.data.constraints.join("\n"));
    setAssumptions(row.data.assumptions.join("\n"));
    setTimeHorizonMonths(row.data.timeHorizonMonths);
    setPriority(row.data.priority);
    setSensitivityPercent(row.data.sensitivityPercent);
  };

  const duplicate = async (row: SavedScenario) => {
    setBusy(row.id);
    try {
      const result = await requestWhatIf(SaveResponseSchema, {
        method: "POST",
        body: JSON.stringify({ action: "duplicate", scenarioId: row.id }),
      });
      await queryClient.invalidateQueries({ queryKey: ["what-if-scenarios"] });
      loadScenario(result.saved);
      toast.success("Scenario duplicated as a new private scenario.");
    } catch (error) {
      toast.error("Could not duplicate scenario", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const updateScenario = (update: Partial<WhatIfScenario>) => {
    setScenario((current) => (current ? { ...current, ...update } : current));
  };

  const exportScenario = () => {
    if (!scenario || !currentAnalysis) return;
    const report = {
      scenario,
      analysis: currentAnalysis,
      generatedAt: new Date().toISOString(),
      notice:
        "Hypothetical decision support only. Numeric totals use the entered values and formula shown; qualitative content is not verified research.",
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenario.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "what-if"}-report.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Decision support workspace
          </p>
          <h1 className="font-display text-3xl font-bold">LORD What-If Lab</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Build distinct options, make your assumptions visible, and compare transparent
            estimates. LORD does not execute actions from hypothetical scenarios.
          </p>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.6fr)]">
          <Card className="border-border/70 bg-card/80">
            <CardHeader>
              <CardTitle>Define the decision</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span>Objective</span>
                <Textarea
                  value={objective}
                  maxLength={2000}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder="What decision are you trying to make?"
                />
              </label>
              <ListEditor
                label="Constraints (one per line)"
                value={constraints}
                onChange={setConstraints}
              />
              <ListEditor
                label="Assumptions (one per line)"
                value={assumptions}
                onChange={setAssumptions}
              />
              <ListEditor
                label="Proposed options (optional, one per line)"
                value={proposedOptions}
                onChange={setProposedOptions}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Time horizon (months)"
                  min={1}
                  max={600}
                  value={timeHorizonMonths}
                  onChange={setTimeHorizonMonths}
                />
                <label className="space-y-1 text-sm">
                  <span>Primary priority</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as WhatIfPriority)}
                  >
                    <option value="cost">Lower cost</option>
                    <option value="effort">Less effort</option>
                    <option value="risk">Lower risk</option>
                  </select>
                </label>
              </div>
              <NumberField
                label="Sensitivity change (%)"
                min={0}
                max={100}
                value={sensitivityPercent}
                onChange={setSensitivityPercent}
              />
              <Button
                className="w-full"
                disabled={busy !== null || objective.trim().length < 3}
                onClick={() => void generate()}
              >
                {busy === "generate" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Generate distinct options
              </Button>
              <p className="text-xs text-muted-foreground">
                AI-generated benefits, drawbacks, dependencies, and questions are hypotheses, not
                verified facts or sourced research.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {scenario && currentAnalysis ? (
              <>
                <Card className="border-border/70 bg-card/80">
                  <CardHeader className="flex-row items-center justify-between gap-3">
                    <CardTitle>Scenario comparison</CardTitle>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={exportScenario}>
                        <Download className="mr-1.5 h-4 w-4" /> Export
                      </Button>
                      <Button size="sm" disabled={busy !== null} onClick={() => void save()}>
                        {busy === "save" ? (
                          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 h-4 w-4" />
                        )}
                        Save revision
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <label className="block space-y-1 text-sm">
                      <span>Scenario title</span>
                      <Input
                        value={scenario.title}
                        maxLength={120}
                        onChange={(event) => updateScenario({ title: event.target.value })}
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <ListEditor
                        label="Edit constraints"
                        value={scenario.constraints.join("\n")}
                        onChange={(value) => updateScenario({ constraints: listValue(value) })}
                      />
                      <ListEditor
                        label="Edit assumptions"
                        value={scenario.assumptions.join("\n")}
                        onChange={(value) => updateScenario({ assumptions: listValue(value) })}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberField
                        label="Time horizon (months)"
                        min={1}
                        max={600}
                        value={scenario.timeHorizonMonths}
                        onChange={(value) => updateScenario({ timeHorizonMonths: value })}
                      />
                      <NumberField
                        label="Sensitivity change (%)"
                        min={0}
                        max={100}
                        value={scenario.sensitivityPercent}
                        onChange={(value) => updateScenario({ sensitivityPercent: value })}
                      />
                    </div>
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                      <strong>Recommendation:</strong> {currentAnalysis.recommendationReason}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      LORD leaves generated cost and effort inputs at zero and uses a neutral 3/5
                      risk placeholder. Replace these with your own estimates and ratings.
                    </p>
                    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                      {currentAnalysis.options.map((option) => (
                        <OptionCard
                          key={option.id}
                          option={option}
                          recommended={option.id === currentAnalysis.recommendedOptionId}
                          onChange={(updated) =>
                            updateScenario({
                              options: scenario.options.map((item) =>
                                item.id === updated.id ? updated : item,
                              ),
                            })
                          }
                        />
                      ))}
                    </div>
                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold">Sensitivity drivers</h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {currentAnalysis.drivers.map((driver) => (
                          <div key={driver.variable} className="rounded-lg bg-muted/40 p-3 text-sm">
                            <div className="font-medium">{driver.variable}</div>
                            <div className="text-muted-foreground">
                              Average change: {formatNumber(driver.estimatedImpact)} {driver.unit}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{currentAnalysis.method}</p>
                    </section>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="border-dashed border-border/70 bg-card/50">
                <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                  <GitCompareArrows className="h-9 w-9 text-primary" />
                  <h2 className="font-semibold">Start with a decision objective</h2>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Generate a set of meaningfully different approaches. Enter your own cost and
                    effort estimates before relying on the comparison.
                  </p>
                </CardContent>
              </Card>
            )}

            <SavedScenarios
              rows={savedQuery.data?.scenarios ?? []}
              loading={savedQuery.isLoading}
              error={savedQuery.error}
              retrying={savedQuery.isFetching}
              selectedIds={selectedRevisions}
              busy={busy}
              onLoad={loadScenario}
              onDuplicate={(row) => void duplicate(row)}
              onSelect={(id) =>
                setSelectedRevisions((current) =>
                  current.includes(id)
                    ? current.filter((selected) => selected !== id)
                    : current.length < 4
                      ? [...current, id]
                      : current,
                )
              }
              onRetry={() => void savedQuery.refetch()}
            />
            {compareRows.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Saved revision comparison</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {compareRows.map((row) => {
                    const analysis = analyzeScenario(row.data);
                    return (
                      <Card key={row.id} className="border-border/70 bg-card/80">
                        <CardHeader>
                          <CardTitle className="text-base">
                            {row.title} · revision {row.revision}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                          <p className="text-muted-foreground">{row.data.objective}</p>
                          {analysis.options.map((option) => (
                            <div
                              key={option.id}
                              className="flex justify-between gap-2 border-t pt-2"
                            >
                              <span>{option.name}</span>
                              <span>{formatNumber(option.totalCost)} cost units</span>
                            </div>
                          ))}
                          <p className="pt-1 text-xs text-muted-foreground">
                            Recommended:{" "}
                            {analysis.recommendedOptionId
                              ? analysis.options.find(
                                  (item) => item.id === analysis.recommendedOptionId,
                                )?.name
                              : "No unique leader"}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Estimates are hypothetical and depend on your inputs. Financial, medical, and other
          high-stakes decisions require qualified independent review. No real-world testing or
          simulation is implied.
        </p>
      </main>
    </AppShell>
  );
}

function ListEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Textarea
        value={value}
        maxLength={3_600}
        rows={3}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add one item per line"
      />
    </label>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step="any"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function OptionCard({
  option,
  recommended,
  onChange,
}: {
  option: WhatIfOption & { totalCost: number; score: number };
  recommended: boolean;
  onChange: (option: WhatIfOption) => void;
}) {
  const { totalCost, score: _score, ...editableOption } = option;
  const update = (change: Partial<WhatIfOption>) => onChange({ ...editableOption, ...change });
  return (
    <Card className={recommended ? "border-primary/50 bg-primary/[0.04]" : "bg-background/40"}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <Input
            value={option.name}
            maxLength={100}
            onChange={(event) => update({ name: event.target.value })}
            aria-label="Option name"
            className="font-semibold"
          />
          {recommended && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
              Priority match
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="block space-y-1">
          <span className="text-xs text-muted-foreground">Approach</span>
          <Textarea
            rows={3}
            value={option.approach}
            onChange={(event) => update({ approach: event.target.value })}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Upfront cost"
            min={0}
            max={1_000_000_000}
            value={option.upfrontCost}
            onChange={(value) => update({ upfrontCost: value })}
          />
          <NumberField
            label="Monthly cost"
            min={0}
            max={1_000_000_000}
            value={option.monthlyCost}
            onChange={(value) => update({ monthlyCost: value })}
          />
          <NumberField
            label="Effort hours"
            min={0}
            max={1_000_000}
            value={option.effortHours}
            onChange={(value) => update({ effortHours: value })}
          />
          <NumberField
            label="Risk rating (1-5)"
            min={1}
            max={5}
            value={option.risk}
            onChange={(value) => update({ risk: value })}
          />
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <span className="text-xs text-muted-foreground">Estimated total cost</span>
          <div className="font-semibold">{formatNumber(totalCost)} cost units</div>
        </div>
        <OptionList
          label="Benefits"
          value={option.benefits}
          onChange={(benefits) => update({ benefits })}
        />
        <OptionList
          label="Disadvantages"
          value={option.disadvantages}
          onChange={(disadvantages) => update({ disadvantages })}
        />
        <OptionList
          label="Dependencies"
          value={option.dependencies}
          onChange={(dependencies) => update({ dependencies })}
        />
        <OptionList
          label="Unresolved questions"
          value={option.unresolvedQuestions}
          onChange={(unresolvedQuestions) => update({ unresolvedQuestions })}
        />
        <OptionList
          label="Source references (user supplied)"
          value={option.sourceReferences}
          onChange={(sourceReferences) => update({ sourceReferences })}
        />
      </CardContent>
    </Card>
  );
}

function OptionList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      <Textarea
        rows={2}
        value={value.join("\n")}
        maxLength={3_600}
        onChange={(event) => onChange(listValue(event.target.value))}
      />
    </label>
  );
}

function SavedScenarios({
  rows,
  loading,
  error,
  retrying,
  selectedIds,
  busy,
  onLoad,
  onDuplicate,
  onSelect,
  onRetry,
}: {
  rows: SavedScenario[];
  loading: boolean;
  error: Error | null;
  retrying: boolean;
  selectedIds: string[];
  busy: string | null;
  onLoad: (row: SavedScenario) => void;
  onDuplicate: (row: SavedScenario) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <Card className="border-border/70 bg-card/80">
      <CardHeader>
        <CardTitle>Private saved scenarios and revisions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Select up to four saved entries to compare revisions. Scenarios are private to your
          account.
        </p>
        {loading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
        {error && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              Could not load saved scenarios: {error.message}
            </p>
            <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
              <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No saved scenarios yet.</p>
        )}
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <label className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={selectedIds.includes(row.id)}
                onChange={() => onSelect(row.id)}
                aria-label={`Compare ${row.title} revision ${row.revision}`}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{row.title}</span>
                <span className="block text-xs text-muted-foreground">
                  Revision {row.revision} · {new Date(row.updated_at).toLocaleDateString()}
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onLoad(row)}>
                Open
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => onDuplicate(row)}
                aria-label={`Duplicate ${row.title}`}
              >
                {busy === row.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
