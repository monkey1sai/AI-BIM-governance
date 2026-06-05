// CH-H1a 誠實降級回歸鎖（對抗驗證確認 high finding：缺 fidelity 不得捏造 guid_exact）。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelInfoCard } from "./ModelInfoCard";

describe("ModelInfoCard 誠實降級（轉換配置 fidelity）", () => {
  it("缺 semantic_mapping_fidelity 但有 mapping_url → 顯「未取得」，SHALL NOT 捏造 guid_exact", () => {
    const html = renderToString(
      <ModelInfoCard
        model={{ url: "http://x/model.usdc", mapping_url: "http://x/element_mapping.json", artifact_id: "a1", status: "ready" }}
        metrics={{ source_ifc_entity_count: 543, coverage_ratio: 0.9, semantic_mapping_fidelity: null }}
      />,
    );
    // 對構配置欄不得出現捏造的 guid_exact（缺欄位的誠實值是「未取得」）。
    expect(html).not.toContain("guid_exact");
    expect(html).toContain("未取得");
  });

  it("後端有提供 semantic_mapping_fidelity → 原樣呈現", () => {
    const html = renderToString(
      <ModelInfoCard model={{ mapping_url: "http://x/m.json" }} metrics={{ semantic_mapping_fidelity: "ifc_class_grouped_with_name" }} />,
    );
    expect(html).toContain("ifc_class_grouped_with_name");
  });

  it("isFake → 顯 fake badge", () => {
    const html = renderToString(<ModelInfoCard model={{}} metrics={{}} isFake />);
    expect(html).toContain('data-testid="model-info-fake"');
  });

  it("coverage 由 coverage_ratio 原樣×100，缺值顯未取得（不自算誤導）", () => {
    const ok = renderToString(<ModelInfoCard model={{}} metrics={{ coverage_ratio: 0.9886 }} />);
    expect(ok).toContain("98.86%");
    const missing = renderToString(<ModelInfoCard model={{}} metrics={{ coverage_ratio: null }} />);
    // coverage 欄缺值 → 未取得（不顯假百分比）
    expect(missing).toContain("未取得");
  });
});
