import { t } from "../i18n";
import type { StepView } from "./stepProgress";

/** 模型庫頂端的三步驟指引；第一個未完成的步驟標為目前步驟。 */
export function WorkflowSteps({ steps }: { steps: StepView[] }): JSX.Element {
  const current = steps.find((step) => step.state !== "done")?.key;
  return (
    <ol className="md-steps" data-testid="md-steps" aria-label={t("操作步驟", "Steps")}>
      {steps.map((step) => (
        <li
          key={step.key}
          data-step={step.key}
          data-state={step.state}
          aria-current={step.key === current ? "step" : undefined}
        >
          <div className="md-steps-head">
            <span className="md-step-n" aria-hidden="true">{step.number}</span>
            <strong>{step.title}</strong>
            <span className="md-steps-status">{step.status}</span>
          </div>
          <p>{step.hint}</p>
        </li>
      ))}
    </ol>
  );
}
