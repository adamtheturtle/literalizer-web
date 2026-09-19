"""Tests for the browser-to-Literalizer boundary."""

import json
import sys
from pathlib import Path

DIST = Path(__file__).parents[2] / "dist"
sys.path.insert(0, str(DIST))

import bridge  # noqa: E402


def _request(**overrides):
    request = {
        "operation": "value",
        "source": '{"name": "Ada"}',
        "format": "JSON",
        "language": "Python",
        "language_label": "Python",
        "language_options": {},
        "options": {
            "collection_layout": "COMPACT",
            "include_delimiters": True,
            "pre_indent_level": 0,
            "wrap_in_file": False,
        },
    }
    request.update(overrides)
    return request


def test_schema_covers_the_public_api():
    schema = json.loads(bridge.get_schema())

    assert len(schema["languages"]) == 65
    assert len(schema["value_options"]) == 10
    assert len(schema["call_options"]) == 16
    assert schema["languages"]["Python"]["call_supported"] is True
    assert schema["languages"]["Yaml"]["call_supported"] is False
    assert schema["languages"]["Jsonc"]["supports_variable_names"] is False
    assert schema["languages"]["Swift"]["supports_no_variable_wrap_in_file"] is False


def test_value_conversion():
    response = json.loads(bridge.convert(json.dumps(_request())))

    assert response["ok"] is True
    assert response["result"]["code"] == '{\n    "name": "Ada",\n}'


def test_parse_error_is_safe_and_actionable():
    response = json.loads(bridge.convert(json.dumps(_request(source="{"))))

    assert response["ok"] is False
    assert response["error"]["field"] == "source"
    assert response["error"]["line"] == 1
    assert response["error"]["column"] == 2
    assert response["error"]["message"] == "Could not read the JSON input. Check its syntax."


def test_call_conversion():
    request = _request(
        operation="call",
        source='[["Ada"], ["Grace"]]',
        options={
            "collection_layout": "COMPACT",
            "parameter_names": ["name"],
            "per_element": True,
            "target_function": "welcome",
            "wrap_in_file": False,
        },
    )
    response = json.loads(bridge.convert(json.dumps(request)))

    assert response["ok"] is True
    assert response["result"]["code"] == 'welcome(name="Ada")\nwelcome(name="Grace")'
