/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase server client follows runtime schema migrations. */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasProEntitlement } from "@/lib/billing/entitlements.server";
import { OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter-provider";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dashboard") }),
  z.object({
    action: z.literal("generate"),
    subject: z.string().trim().min(1).max(80),
    topic: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("answer"),
    questionId: z.string().uuid(),
    selectedIndex: z.number().int().min(0).max(5),
  }),
  z.object({
    action: z.literal("preference"),
    subject: z.string().trim().max(80),
    topic: z.string().trim().max(120),
    weeklyGoalMinutes: z.number().int().min(15).max(1680),
  }),
  z.object({
    action: z.literal("report"),
    questionId: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

function provider() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("AI is not configured");
  return createOpenAICompatible({
    name: "openrouter",
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  });
}

export const Route = createFileRoute("/api/personal-tutor")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const body = schema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
        const auth = context as {
          userId?: string;
          claims?: { id?: string; email?: string; email_confirmed_at?: string | null };
        };
        const userId = auth.userId;
        if (!userId || !auth.claims)
          return Response.json({ error: "Sign in required." }, { status: 401 });
        try {
          if (
            !(await hasProEntitlement({
              id: userId,
              email: auth.claims.email,
              email_confirmed_at: auth.claims.email_confirmed_at,
            }))
          )
            return Response.json(
              { error: "LORD Personal Tutor requires an active LORD Pro entitlement." },
              { status: 403, headers: { "Cache-Control": "no-store" } },
            );
          const db = supabaseAdmin as any;
          if (body.data.action === "dashboard") {
            const [attempts, preferences] = await Promise.all([
              db
                .from("personal_tutor_questions")
                .select(
                  "id,subject,topic,prompt,choices,correct_index,hint,explanation,difficulty,is_correct,attempted_at,created_at",
                )
                .eq("user_id", userId)
                .not("attempted_at", "is", null)
                .order("attempted_at", { ascending: false })
                .limit(30),
              db
                .from("personal_tutor_preferences")
                .select("subject,topic,weekly_goal_minutes")
                .eq("user_id", userId)
                .maybeSingle(),
            ]);
            if (attempts.error) throw attempts.error;
            if (preferences.error) throw preferences.error;
            const rows = attempts.data ?? [];
            const correct = rows.filter((r: any) => r.is_correct).length;
            return Response.json({
              attempts: rows.map(({ correct_index: _answer, ...row }: any) => row),
              preferences: preferences.data,
              activityCount: rows.length,
              accuracy: rows.length ? Math.round((correct / rows.length) * 100) : null,
            });
          }
          if (body.data.action === "preference") {
            const { error } = await db.from("personal_tutor_preferences").upsert({
              user_id: userId,
              subject: body.data.subject,
              topic: body.data.topic,
              weekly_goal_minutes: body.data.weeklyGoalMinutes,
              updated_at: new Date().toISOString(),
            });
            if (error) throw error;
            return Response.json({ saved: true });
          }
          if (body.data.action === "generate") {
            const { data: recent, error: recentError } = await db
              .from("personal_tutor_questions")
              .select("correct_index, is_correct, attempted_at")
              .eq("user_id", userId)
              .eq("topic", body.data.topic)
              .not("attempted_at", "is", null)
              .order("attempted_at", { ascending: false })
              .limit(5);
            if (recentError) throw recentError;
            const accuracy = (recent ?? []).length
              ? (recent ?? []).filter((r: any) => r.is_correct).length / (recent ?? []).length
              : 0.5;
            const difficulty = Math.max(1, Math.min(5, Math.round(3 + (accuracy - 0.5) * 3)));
            const { text } = await generateText({
              model: provider()(OPENROUTER_DEFAULT_MODEL),
              system:
                "Generate one original practice question. Return strict JSON only. Never claim official curriculum alignment. Ensure one unambiguous correct option, four distinct choices, a non-answer-revealing hint, and a clear explanation.",
              prompt: `Subject: ${body.data.subject}\nTopic: ${body.data.topic}\nDifficulty: ${difficulty}/5\nJSON: {"prompt":"...","choices":["...","...","...","..."],"correctIndex":0,"hint":"...","explanation":"..."}`,
              maxOutputTokens: 700,
              temperature: 0.3,
            });
            const match = text.match(/\{[\s\S]*\}/);
            const question = z
              .object({
                prompt: z.string().min(5).max(1500),
                choices: z.array(z.string().min(1).max(300)).length(4),
                correctIndex: z.number().int().min(0).max(3),
                hint: z.string().min(2).max(600),
                explanation: z.string().min(5).max(2000),
              })
              .parse(match ? JSON.parse(match[0]) : null);
            const { correctIndex, ...questionFields } = question;
            const { data, error } = await db
              .from("personal_tutor_questions")
              .insert({
                user_id: userId,
                subject: body.data.subject,
                topic: body.data.topic,
                ...questionFields,
                correct_index: correctIndex,
                difficulty,
              })
              .select("id,subject,topic,prompt,choices,difficulty,created_at")
              .single();
            if (error) throw error;
            return Response.json({
              question: data,
              generated: true,
              curriculumNote:
                "AI-generated practice material; check it against your course and report errors.",
            });
          }
          if (body.data.action === "answer") {
            const { data: question, error } = await db
              .from("personal_tutor_questions")
              .select("id,correct_index,hint,explanation,attempted_at")
              .eq("id", body.data.questionId)
              .eq("user_id", userId)
              .maybeSingle();
            if (error) throw error;
            if (!question) return Response.json({ error: "Question not found." }, { status: 404 });
            if (question.attempted_at)
              return Response.json(
                { error: "This question has already been submitted." },
                { status: 409 },
              );
            const correct = body.data.selectedIndex === question.correct_index;
            const { error: updateError } = await db
              .from("personal_tutor_questions")
              .update({ attempted_at: new Date().toISOString(), is_correct: correct })
              .eq("id", question.id)
              .eq("user_id", userId)
              .is("attempted_at", null);
            if (updateError) throw updateError;
            return Response.json({
              correct,
              hint: correct ? null : question.hint,
              explanation: question.explanation,
            });
          }
          const { data, error } = await db
            .from("personal_tutor_questions")
            .select("id")
            .eq("id", body.data.questionId)
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw error;
          if (!data) return Response.json({ error: "Question not found." }, { status: 404 });
          const { error: reportError } = await db.from("personal_tutor_reports").insert({
            user_id: userId,
            question_id: data.id,
            reason: body.data.reason,
          });
          if (reportError) throw reportError;
          return Response.json({ received: true });
        } catch (error) {
          console.error("Personal Tutor request failed", error);
          return Response.json(
            { error: "Personal Tutor is temporarily unavailable." },
            { status: 503 },
          );
        }
      },
    },
  },
});
