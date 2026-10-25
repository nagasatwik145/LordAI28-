import { z } from "zod";

const TextListSchema = z.array(z.string().trim().min(1).max(300)).max(12);

export const WhatIfOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  approach: z.string().trim().min(1).max(600),
  benefits: TextListSchema,
  disadvantages: TextListSchema,
  dependencies: TextListSchema,
  unresolvedQuestions: TextListSchema,
  sourceReferences: z.array(z.string().trim().min(1).max(500)).max(12),
  upfrontCost: z.number().finite().min(0).max(1_000_000_000),
  monthlyCost: z.number().finite().min(0).max(1_000_000_000),
  effortHours: z.number().finite().min(0).max(1_000_000),
  risk: z.number().int().min(1).max(5),
});

export const WhatIfScenarioSchema = z.object({
  title: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(3).max(2_000),
  constraints: TextListSchema,
  assumptions: TextListSchema,
  timeHorizonMonths: z.number().int().min(1).max(600),
  priority: z.enum(["cost", "effort", "risk"]),
  sensitivityPercent: z.number().finite().min(0).max(100),
  options: z.array(WhatIfOptionSchema).min(2).max(6),
});

export type WhatIfOption = z.infer<typeof WhatIfOptionSchema>;
export type WhatIfScenario = z.infer<typeof WhatIfScenarioSchema>;
export type WhatIfPriority = WhatIfScenario["priority"];

export interface WhatIfOptionResult extends WhatIfOption {
  totalCost: number;
  score: number;
}

export interface WhatIfDriver {
  variable: string;
  unit: "cost units" | "hours" | "points";
  estimatedImpact: number;
}

export interface WhatIfAnalysis {
  options: WhatIfOptionResult[];
  recommendedOptionId: string | null;
  recommendationReason: string;
  drivers: WhatIfDriver[];
  method: string;
}

export function analyzeScenario(scenario: WhatIfScenario): WhatIfAnalysis {
  const options = scenario.options.map((option) => {
    const totalCost = option.upfrontCost + option.monthlyCost * scenario.timeHorizonMonths;
    const score =
      scenario.priority === "cost"
        ? totalCost
        : scenario.priority === "effort"
          ? option.effortHours
          : option.risk;
    return { ...option, totalCost, score };
  });

  const ranked = [...options].sort((left, right) => left.score - right.score);
  const recommended = ranked[0]!;
  const hasUniqueLeader =
    ranked.filter((option) => option.score === recommended.score).length === 1;
  const priorityLabel =
    scenario.priority === "cost"
      ? "lowest estimated total cost"
      : scenario.priority === "effort"
        ? "lowest estimated effort"
        : "lowest stated risk rating";

  const pct = scenario.sensitivityPercent / 100;
  const drivers: WhatIfDriver[] = [
    {
      variable: "Upfront cost",
      unit: "cost units",
      estimatedImpact:
        options.reduce((sum, option) => sum + option.upfrontCost * pct, 0) / options.length,
    },
    {
      variable: "Monthly cost",
      unit: "cost units",
      estimatedImpact:
        options.reduce(
          (sum, option) => sum + option.monthlyCost * scenario.timeHorizonMonths * pct,
          0,
        ) / options.length,
    },
    {
      variable: "Time horizon",
      unit: "cost units",
      estimatedImpact:
        options.reduce(
          (sum, option) => sum + option.monthlyCost * scenario.timeHorizonMonths * pct,
          0,
        ) / options.length,
    },
    {
      variable: "Effort hours",
      unit: "hours",
      estimatedImpact:
        options.reduce((sum, option) => sum + option.effortHours * pct, 0) / options.length,
    },
    {
      variable: "Risk rating",
      unit: "points",
      estimatedImpact: options.reduce((sum, option) => sum + option.risk * pct, 0) / options.length,
    },
  ];
  drivers.sort((left, right) => {
    const unitOrder: Record<WhatIfDriver["unit"], number> = {
      "cost units": 0,
      hours: 1,
      points: 2,
    };
    return (
      unitOrder[left.unit] - unitOrder[right.unit] || right.estimatedImpact - left.estimatedImpact
    );
  });

  return {
    options,
    recommendedOptionId: hasUniqueLeader ? recommended.id : null,
    recommendationReason: hasUniqueLeader
      ? `${recommended.name} best matches the selected priority: ${priorityLabel}. This ranking considers only the numeric inputs shown; qualitative trade-offs remain unresolved.`
      : `There is no unique leader: options are tied on the selected priority (${priorityLabel}). Add or refine numeric estimates before choosing between them.`,
    drivers,
    method: `Estimated total cost = upfront cost + monthly cost × ${scenario.timeHorizonMonths} months. Sensitivity shows the average absolute change across options from a ${scenario.sensitivityPercent}% change in each input. No uncertainty range is calculated because no low/high input ranges were provided. No simulation or real-world testing was performed.`,
  };
}

export function compareScenarios(scenarios: WhatIfScenario[]) {
  return scenarios.map((scenario) => ({
    title: scenario.title,
    objective: scenario.objective,
    analysis: analyzeScenario(scenario),
  }));
}
