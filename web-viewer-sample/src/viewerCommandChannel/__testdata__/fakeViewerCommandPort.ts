import type { MeasurementAction } from "../measurement";
import type { ViewerCommandPort } from "../parentSide";
import type { CorrelatedViewerCommand, ViewerCommandInputs, ViewerCommandReplies } from "../registry";

type Handlers = { [C in CorrelatedViewerCommand]?: (input: ViewerCommandInputs[C]) => Promise<ViewerCommandReplies[C]> };

/** 測試用 port：沒給 handler 的指令回 unavailable。 */
export function fakeViewerCommandPort(
  handlers: Handlers,
  controlMeasurement: (action: MeasurementAction) => boolean = () => false,
): ViewerCommandPort {
  return {
    send(command, input) {
      const handler = handlers[command] as ((value: typeof input) => Promise<ViewerCommandReplies[typeof command]>) | undefined;
      return handler ? handler(input) : Promise.resolve({ status: "error", reason: "unavailable" } as ViewerCommandReplies[typeof command]);
    },
    controlMeasurement,
  };
}
