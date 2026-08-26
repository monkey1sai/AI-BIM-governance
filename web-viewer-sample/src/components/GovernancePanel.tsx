import React, { useState } from "react";

export interface GovernanceRuleItem {
  ruleId: string;
  title: string;
  status: "passed" | "failed" | "warning" | "running";
  violationCount: number;
}

export interface GovernancePanelProps {
  rules?: GovernanceRuleItem[];
  onRunRule?: (ruleId: string) => void;
  onSelectViolations?: (ruleId: string) => void;
  onCreateBcfTopic?: (ruleId: string) => void;
}

export const GovernancePanel: React.FC<GovernancePanelProps> = ({
  rules = [],
  onRunRule,
  onSelectViolations,
  onCreateBcfTopic,
}) => {
  const [activeTab, setActiveTab] = useState<"rules" | "issues">("rules");

  return (
    <div
      className="governance-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "#111827",
        color: "#F9FAFB",
        borderLeft: "1px solid #374151",
        width: 320,
      }}
    >
      <div
        className="panel-tabs"
        style={{
          display: "flex",
          borderBottom: "1px solid #374151",
          backgroundColor: "#1F2937",
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          style={{
            flex: 1,
            padding: "8px 12px",
            background: activeTab === "rules" ? "#111827" : "transparent",
            color: activeTab === "rules" ? "#60A5FA" : "#9CA3AF",
            border: "none",
            borderBottom: activeTab === "rules" ? "2px solid #60A5FA" : "none",
            cursor: "pointer",
          }}
        >
          A1~A10 規則檢核
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("issues")}
          style={{
            flex: 1,
            padding: "8px 12px",
            background: activeTab === "issues" ? "#111827" : "transparent",
            color: activeTab === "issues" ? "#60A5FA" : "#9CA3AF",
            border: "none",
            borderBottom: activeTab === "issues" ? "2px solid #60A5FA" : "none",
            cursor: "pointer",
          }}
        >
          BCF 議題
        </button>
      </div>

      <div className="panel-content" style={{ flex: 1, overflowY: "auto", padding: 12 }}>
        {activeTab === "rules" ? (
          <div className="rules-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rules.length === 0 ? (
              <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", marginTop: 24 }}>
                尚無執行的檢核規則
              </div>
            ) : (
              rules.map((r) => (
                <div
                  key={r.ruleId}
                  style={{
                    padding: 10,
                    borderRadius: 6,
                    backgroundColor: "#1F2937",
                    border: "1px solid #374151",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.title}</span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        backgroundColor: r.status === "passed" ? "#065F46" : r.status === "failed" ? "#991B1B" : "#92400E",
                        color: "#FFFFFF",
                      }}
                    >
                      {r.status === "passed" ? "通過" : r.status === "failed" ? "違規 (" + r.violationCount + ")" : "警告"}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => onRunRule && onRunRule(r.ruleId)}
                      style={{
                        fontSize: 11,
                        padding: "3px 6px",
                        background: "#4B5563",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      執行檢核
                    </button>
                    {r.status === "failed" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onSelectViolations && onSelectViolations(r.ruleId)}
                          style={{
                            fontSize: 11,
                            padding: "3px 6px",
                            background: "#374151",
                            color: "#F9FAFB",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          聚焦違規物件
                        </button>
                        <button
                          type="button"
                          onClick={() => onCreateBcfTopic && onCreateBcfTopic(r.ruleId)}
                          style={{
                            fontSize: 11,
                            padding: "3px 6px",
                            background: "#2563EB",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                          }}
                        >
                          建立 BCF 議題
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", marginTop: 24 }}>
            BCF 議題列表與快照連動
          </div>
        )}
      </div>
    </div>
  );
};
