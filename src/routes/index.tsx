import { createFileRoute, redirect } from "@tanstack/react-router";
import { ExperiencePage } from "./experience";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) {
      throw redirect({ to: "/dashboard", replace: true });
    }
  },
  head: () => ({
    meta: [
      { title: "Experience LORD AI — Intelligence Beyond Assistance" },
      {
        name: "description",
        content:
          "Explore LORD AI's chat, voice, learning, planning, creation, and productivity spaces.",
      },
    ],
  }),
  component: ExperiencePage,
});
