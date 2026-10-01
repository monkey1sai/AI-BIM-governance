import { describe, expect, it } from "vitest";
import { confirmedPhysicalSample, temporalOf } from "./cfdTemporal";
const direction = { presentation: { animation: { mode: "urans_sampled" }, temporal: {
  mode:"urans_sampled",solver:"pimpleFoam",fixed_geometry:true,interpolation:"sample_hold",
  sample_times_s:[.5,1,1.5],output_interval_s:.5,requested_duration_s:10,complete_requested_duration:false,
} } };
describe("physical sample labels", () => {
  it("requires the applied run, exact computed sample and Kit success", () => {
    const temporal = temporalOf(direction)!;
    const reply = {status:"applied",runId:"cfd_loaded_run",sampleIndex:1,physicalTimeSeconds:1};
    expect(confirmedPhysicalSample(temporal,"cfd_loaded_run",reply)).toEqual({sampleIndex:1,physicalTimeSeconds:1});
    expect(confirmedPhysicalSample(temporal,"cfd_other_run",reply)).toBeNull();
    expect(confirmedPhysicalSample(temporal,"cfd_loaded_run",{...reply,physicalTimeSeconds:.9})).toBeNull();
    expect(confirmedPhysicalSample(temporal,"cfd_loaded_run",{...reply,status:"pending"})).toBeNull();
  });
  it("refuses unsorted or missing intermediate times and keeps legacy results steady", () => {
    expect(temporalOf({presentation:{animation:{fps:24,frames:240}}})).toBeNull();
    expect(temporalOf({...direction,presentation:{...direction.presentation,
      temporal:{...direction.presentation.temporal,sample_times_s:[.5,1.5,1]}}})).toBeNull();
    expect(temporalOf({...direction,presentation:{...direction.presentation,
      temporal:{...direction.presentation.temporal,sample_times_s:[.5,1.5]}}})).toBeNull();
  });
});
