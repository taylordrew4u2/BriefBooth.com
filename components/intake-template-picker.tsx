"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { intakeTemplates, type IntakeQuestion } from "@/lib/intake";

export function IntakeTemplatePicker({ questions, onChange }: {
  questions: IntakeQuestion[];
  onChange: (questions: IntakeQuestion[]) => void;
}) {
  const [selected, setSelected] = useState(intakeTemplates[0].id);
  const [previous, setPrevious] = useState<IntakeQuestion[] | null>(null);
  const [notice, setNotice] = useState("");
  const template = intakeTemplates.find(item => item.id === selected)!;
  const fits = questions.length + template.questions.length <= 10;
  function apply(append: boolean) {
    if (append && !fits) return;
    setPrevious(questions.map(q => ({ ...q })));
    const added = template.questions.map(q => ({ ...q, id: crypto.randomUUID() }));
    onChange(append ? [...questions, ...added] : added);
    setNotice(`${template.name} questions added to your draft. Edit them below, then save your questionnaire.`);
  }
  return (
    <section className="intake-template-picker" aria-labelledby="template-heading">
      <h3 id="template-heading">Start with a template</h3>
      <p>A few friendly questions, with only the first required. Make them your own.</p>
      <label>
        Consultant specialty
        <select value={selected} onChange={event => { setSelected(event.target.value); setNotice(""); }}>
          {intakeTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <p className="field-help">{template.description}</p>
      <ol className="template-preview">
        {template.questions.map(q => <li key={q.label}>{q.label}{q.options && <p className="field-help">Select all that apply: {q.options.join(", ")}</p>}<span>{q.required ? "Required" : "Optional"}</span></li>)}
      </ol>
      <p className="field-help">Replacing changes your draft questions. Your shared page updates only after you click Save questionnaire.</p>
      <div className="template-actions">
        <Button type="button" onClick={() => apply(false)}>Replace draft with template</Button>
        <Button type="button" variant="outline" disabled={!fits} onClick={() => apply(true)}>Add to existing questions</Button>
        {previous !== null && <Button type="button" variant="outline" onClick={() => {
          onChange(previous); setPrevious(null); setNotice("Previous draft restored. Save when you’re ready.");
        }}>Undo template</Button>}
      </div>
      {!fits && <p className="field-help">This template needs {template.questions.length} open question slots. Remove questions below or replace the draft.</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
    </section>
  );
}
