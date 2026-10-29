import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"


def test_extension_manifest_is_minimal_manifest_v3() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))

    assert manifest["manifest_version"] == 3
    assert manifest["name"] == "Connection Quality for Google Flights BETA"
    assert manifest["version"] == "0.1.0"
    assert manifest["description"] == (
        "See whether an international flight connection is comfortable, "
        "tight, or risky before you book."
    )
    assert manifest["permissions"] == ["activeTab"]
    assert manifest["icons"] == {
        "16": "icons/icon-16.png",
        "32": "icons/icon-32.png",
        "48": "icons/icon-48.png",
        "128": "icons/icon-128.png",
    }
    assert manifest["action"]["default_icon"] == manifest["icons"]
    assert manifest["content_scripts"][0]["matches"] == [
        "https://www.google.com/travel/flights*",
    ]
    assert "<all_urls>" not in manifest.get("host_permissions", [])


def test_extension_manifest_references_existing_files() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    referenced = [manifest["action"]["default_popup"]]
    for content_script in manifest["content_scripts"]:
        referenced.extend(content_script.get("js", []))
        referenced.extend(content_script.get("css", []))

    # core/ paths are served from the standalone engine package (see scripts/build-extension.js).
    def source_for(path: str) -> Path:
        if path.startswith("core/"):
            return ROOT / "packages" / "core" / "src" / path.removeprefix("core/")
        return EXTENSION / path

    assert all(source_for(path).is_file() for path in referenced)
    assert all((EXTENSION / path).is_file() for path in manifest["icons"].values())
    assert "background" not in manifest


def test_extension_does_not_request_itinerary_storage_or_broad_site_access() -> None:
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))

    assert "tabs" not in manifest["permissions"]
    assert "storage" not in manifest["permissions"]
    assert "history" not in manifest["permissions"]
    assert "webRequest" not in manifest["permissions"]
    assert all(
        "google.com/travel/flights" in match
        for match in manifest["content_scripts"][0]["matches"]
    )


def test_alpha_ui_requires_confirmation_and_avoids_pseudo_precision() -> None:
    content = (EXTENSION / "src" / "content.js").read_text(encoding="utf-8")
    flow = (EXTENSION / "src" / "ui" / "assessment-flow.js").read_text(encoding="utf-8")

    assert 'value="protected"' in content
    assert 'value="separate"' in content
    assert 'value="unknown"' in content
    assert "Analyze this itinerary" in content
    assert "flow.actionForExtraction(result)" in content
    assert 'action === "confirm"' in content
    assert "flow.failurePresentation(result)" in content
    assert 'result?.code === "AMBIGUOUS_ITINERARY"' in flow
    assert "Open or expand one itinerary and try again." in flow
    assert 'class="cq-factors"' in content
    assert "processFactors" in content
    assert 'class="cq-time-pie"' not in content
    assert "conic-gradient" not in content
    assert "How ${assessment.layoverMinutes} min is used" not in content
