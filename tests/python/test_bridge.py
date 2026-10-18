"""Tests for the browser-to-Literalizer boundary."""

import inspect
import json
import sys
from importlib.metadata import version
from pathlib import Path

from literalizer import InputFormat, literalize, literalize_call
from literalizer.languages import ALL_LANGUAGES

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

    assert schema["literalizer_version"] == version("literalizer") == "2026.9.16"
    assert set(schema["languages"]) == {cls.__name__ for cls in ALL_LANGUAGES}
    assert schema["input_formats"] == [member.name for member in InputFormat]
    for function, key in [(literalize, "value_options"), (literalize_call, "call_options")]:
        assert set(schema[key]) == set(inspect.signature(function).parameters) - {
            "source",
            "input_format",
            "language",
        }
    assert schema["languages"]["Python"]["call_supported"] is True
    assert schema["languages"]["Yaml"]["call_supported"] is False
    assert schema["languages"]["Json5"]["supports_variable_names"] is False
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


def test_nested_toml_call_rows():
    request = _request(
        operation="call",
        source='calls = [["Ada"], ["Grace"]]',
        format="TOML",
        options={
            "input_root_key": "calls",
            "target_function": "welcome",
            "parameter_names": ["name"],
        },
    )
    response = json.loads(bridge.convert(json.dumps(request)))
    assert response["ok"] is True
    assert response["result"]["code"] == 'welcome(name="Ada")\nwelcome(name="Grace")'


def test_compose_declarations_and_calls():
    request = _request(
        operation="compose",
        source='[[{"$ref": "person"}]]',
        options={"target_function": "welcome", "parameter_names": ["name"], "ref_key": "$ref"},
        declarations=[
            {
                "source": '"Ada"',
                "format": "JSON",
                "options": {"variable_form": {"kind": "NewVariable", "name": "person"}},
            }
        ],
    )
    response = json.loads(bridge.convert(json.dumps(request)))
    assert response["ok"] is True
    code = response["result"]["code"]
    assert 'person = "Ada"' in code
    assert "welcome(name=person)" in code
