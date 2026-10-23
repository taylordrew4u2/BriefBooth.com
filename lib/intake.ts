export type IntakeQuestion = {
  id: string;
  label: string;
  type: "short" | "long" | "multiple";
  options?: string[];
  required: boolean;
};
export const defaultQuestions: IntakeQuestion[] = [
  { id: "goals", label: "What would you like to discuss?", type: "long", required: false },
];

export type IntakeTemplate = {
  id: string;
  name: string;
  description: string;
  questions: Omit<IntakeQuestion, "id">[];
};

const question = (label: string, required = false, type: "short" | "long" = "long") => ({ label, required, type });

export const intakeTemplates: IntakeTemplate[] = [
  {
    id: "business", name: "Business & strategy", description: "Understand the business and the next decision.",
    questions: [question("What would you most like to improve in your business?", true), question("Tell me a little about your business and who you serve."), question("What have you tried so far?"), question("Is there a decision or deadline you’re working toward?", false, "short")],
  },
  {
    id: "marketing", name: "Marketing & social media", description: "Get context on the audience, channels, and goal.",
    questions: [question("What would you like your marketing to achieve?", true), question("Who are you trying to reach?"), question("Which channels are you using, and what’s working?"), question("Share a website or social profile you’d like me to look at.", false, "short")],
  },
  {
    id: "career", name: "Career & professional coaching", description: "Start with the client’s next professional step.",
    questions: [question("What would you like help with in your career right now?", true), question("What kind of role or direction interests you?"), question("What feels like the biggest obstacle?"), question("Do you have an interview or other deadline coming up?", false, "short")],
  },
  {
    id: "technology", name: "Technology & IT", description: "Clarify the project without a long technical form.",
    questions: [question("What problem would you like technology to help solve?", true), question("What tools or systems are you using today?"), question("Who will use the solution, and what do they need to do?"), question("When would you ideally like to get started?", false, "short")],
  },
  {
    id: "software-development", name: "App, web & full-stack development", description: "Plan a new build, improve an existing app, or get help with a bug. No technical expertise needed.",
    questions: [{ label: "What do you need help with?", type: "multiple", required: true, options: ["Software", "Website", "Web application", "Mobile application", "Automation & integrations", "Fixes & improvements", "Other / not sure yet"] }, question("What would you like to build, improve, or fix?"), question("Who will use it, and what is the main thing they should be able to do?"), question("Do you have an existing website, app, designs, or a tech stack? Share any useful context or public links—no passwords or API keys."), question("Do you have a target launch date or budget range in mind?", false, "short")],
  },
  {
    id: "design", name: "Design & branding", description: "Explore the brand, audience, and creative direction.",
    questions: [question("What are you creating or refreshing?", true), question("Who is it for, and how should it make them feel?"), question("Are there any styles or examples you like?"), question("Is there a launch date or milestone to keep in mind?", false, "short")],
  },
  {
    id: "operations", name: "Operations & productivity", description: "Find the friction in everyday work.",
    questions: [question("What part of your work would you like to make easier?", true), question("How does that process work today?"), question("Who is involved, and where do things get stuck?"), question("What would a successful improvement look like?")],
  },
  {
    id: "leadership", name: "Leadership & team development", description: "Prepare for a focused conversation about leading people.",
    questions: [question("What leadership or team challenge would you like to explore?", true), question("Tell me about your role and team in general terms."), question("What have you already tried?"), question("What would you like to leave our conversation with?")],
  },
  {
    id: "events", name: "Events & creative projects", description: "Gather the idea, audience, and timing.",
    questions: [question("Tell me about the event or project you have in mind.", true), question("Who is it for, and roughly how many people are involved?"), question("What kind of support are you looking for?"), question("Do you have a date or location in mind?", false, "short")],
  },
];
