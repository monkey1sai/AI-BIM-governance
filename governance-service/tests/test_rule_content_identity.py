"""Execution-definition identity using real rule engines and in-memory IFC."""
import json

import ifcopenshell
from ifctester import facet, ids

from db import Store
from rule_engine.engine import run_rules
from rule_engine.ids_runner import run_ids
from rule_engine.models import RuleRunResult


def model():
    value = ifcopenshell.file(schema="IFC4")
    value.create_entity("IfcWall", GlobalId="0abcdefghijklmnopqrstu", Name="Wall")
    return value


def rules():
    return {"rule_set": "names", "version": "1", "rules": [{
        "rule_code": "NAME", "target_ifc_type": "IfcWall",
        "predicate": {"type": "naming_convention", "pattern": "^Wall$"}
    }]}


def doc():
    value = ids.Ids(title="names")
    spec = ids.Specification(name="wall names")
    spec.applicability.append(facet.Entity(name="IFCWALL"))
    spec.requirements.append(facet.Attribute(name="Name", value="Wall"))
    value.specifications.append(spec)
    return value


def outcomes(run):
    return sorted((r.ifc_guid, r.rule_code, r.status, r.message) for r in run.results)


def test_dsl_key_order_does_not_change_execution_identity():
    first = rules()
    second = dict(reversed(list(first.items())))
    a, b = run_rules(model(), first), run_rules(model(), second)
    assert a.rule_content_digest is not None
    assert a.rule_content_digest == b.rule_content_digest
    assert outcomes(a) == outcomes(b)


def test_dsl_changed_content_same_version_changes_identity_and_outcome():
    first, second = rules(), rules()
    second["rules"][0]["predicate"]["pattern"] = "^Door$"
    a, b = run_rules(model(), first), run_rules(model(), second)
    assert a.version == b.version == "1"
    assert a.rule_content_digest != b.rule_content_digest
    assert a.passed == 1 and b.failed == 1


def test_dsl_uses_snapshot_not_caller_mutated_definition():
    source = rules()
    baseline = run_rules(model(), source)
    inner = model()
    class ChangingModel:
        def by_type(self, kind):
            source["rules"][0]["predicate"]["pattern"] = "^Door$"
            return inner.by_type(kind)
    run = run_rules(ChangingModel(), source)
    assert run.passed == 1
    assert run.rule_content_digest == baseline.rule_content_digest


def test_unserializable_dsl_retains_execution_without_claiming_identity():
    source = rules()
    source["extra"] = object()
    run = run_rules(model(), source)
    assert run.passed == 1
    assert run.rule_content_digest is None


def test_identity_is_persisted_with_accepted_run_and_survives_restart(tmp_path):
    path = str(tmp_path / "runs.db")
    store = Store(path)
    run_id = store.create_run("v1", "synthetic.ifc", "names")
    run = run_rules(model(), rules())
    store.complete_run(run_id, run)
    summary = json.loads(Store(path).get_run(run_id)["summary_json"])
    assert summary["rule_content_digest"] == run.rule_content_digest
    assert summary["rule_content_digest"] is not None


def test_real_ids_identity_stable_across_roundtrip_and_reuse():
    source = doc()
    a = run_ids(model(), source)
    b = run_ids(model(), ids.from_string(source.to_string()))
    c = run_ids(model(), source)
    assert a.rule_content_digest is not None
    assert a.rule_content_digest == b.rule_content_digest == c.rule_content_digest
    assert outcomes(a) == outcomes(b) == outcomes(c)
    assert a.passed == 1


def test_real_ids_changed_requirement_same_label_changes_identity():
    first, second = doc(), doc()
    second.specifications[0].requirements[0].value = "Door"
    a, b = run_ids(model(), first), run_ids(model(), second)
    assert a.version == b.version == "ids"
    assert a.rule_content_digest != b.rule_content_digest
    assert a.passed == 1 and b.failed == 1


def test_custom_ids_cannot_claim_content_identity():
    class Custom:
        specifications = []
        def validate(self, model):
            pass
        def to_string(self):
            return doc().to_string()
    assert run_ids(model(), Custom()).rule_content_digest is None


def test_legacy_constructor_has_no_fabricated_identity():
    run = RuleRunResult("legacy", "1", {}, 0, 0, 0, 0, 100)
    assert run.rule_content_digest is None
    assert run.summary_dict()["rule_content_digest"] is None


def test_real_ids_execution_leaves_original_definition_and_validation_state_untouched():
    source = doc()
    before = source.to_string()
    requirement = source.specifications[0].requirements[0]
    assert not requirement.passed_entities
    run = run_ids(model(), source)
    assert run.passed == 1
    assert source.to_string() == before
    assert not requirement.passed_entities


def test_real_ids_restriction_and_optional_cardinality_survive_snapshot():
    source = doc()
    requirement = source.specifications[0].requirements[0]
    requirement.value = ids.Restriction(options={"pattern": "^Wall$"})
    requirement.cardinality = "optional"
    direct = ids.from_string(source.to_string())
    direct.validate(model())
    run = run_ids(model(), source)
    assert run.rule_content_digest is not None
    assert run.passed == 1 and direct.specifications[0].status is True
