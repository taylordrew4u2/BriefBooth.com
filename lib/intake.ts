export type IntakeQuestion = {
  id: string;
  label: string;
  type: "short" | "long";
  required: boolean;
};
export const defaultQuestions: IntakeQuestion[] = [
  { id: "goals", label: "What would you like to discuss?", type: "long", required: false },
];
