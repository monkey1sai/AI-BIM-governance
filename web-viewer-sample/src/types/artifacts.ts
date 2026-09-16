import type { Artifact, ArtifactBinding as ContractArtifactBinding } from "../contract/coordinatorApi";

// Coordinator Browser Contract：兩個名稱保留給既有 import，定義由生成契約推導。
export type ReviewArtifact = Artifact;
export type ArtifactBinding = ContractArtifactBinding;
