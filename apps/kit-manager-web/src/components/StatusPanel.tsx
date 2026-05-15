import { KitInstanceState } from "../models";

interface Props {
  state?: KitInstanceState;
  message: string;
}

export function StatusPanel({state, message}: Props) {
  return (
    <section className="panel">
      <h2>Kit Instance</h2>
      <p>{message}</p>
      {state && (
        <dl>
          <dt>Instance</dt>
          <dd>{state.instance_id}</dd>
          <dt>Status</dt>
          <dd>{state.status}</dd>
          <dt>Control</dt>
          <dd>{state.control_status}</dd>
          <dt>Opened USDC</dt>
          <dd>{state.opened_runtime_uris.length}</dd>
        </dl>
      )}
    </section>
  );
}
