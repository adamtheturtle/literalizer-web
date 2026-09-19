"""JSON boundary between the browser form and Literalizer's Python API."""

import dataclasses
import enum
import inspect
import json
import typing
from collections.abc import Mapping

import literalizer.languages as languages
from literalizer import (
    BothVariableForms,
    CollectionLayout,
    ExistingVariable,
    IdentifierCase,
    InputFormat,
    NewVariable,
    literalize,
    literalize_call,
    literalize_call_with_declarations,
)
from literalizer.exceptions import (
    CallsNotSupportedByLanguageError,
    CallsNotSupportedByToolError,
    DelimiterlessVariableError,
    DelimiterlessWrappedFileError,
    DottedCallTargetNotSupportedError,
    ExistingVariableNotSelfContainedError,
    HeterogeneousCollectionError,
    InputRootKeyNotFoundError,
    InputRootNotMappingError,
    InvalidCallParameterNameError,
    InvalidCallTargetError,
    InvalidNewVariableNameError,
    InvalidPreIndentLevelError,
    LiteralizerError,
    ParameterCountMismatchError,
    ParseError,
    PerElementNotListError,
    PreIndentedWrappedFileError,
    ReservedVariableNameError,
    UnsupportedOptionError,
    VariableNameNotSupportedError,
    WrapCombinedInFileNotSupportedError,
    WrapInFileWithoutVariableNotSupportedError,
    ZipValuesWithoutCallTransformError,
)
from literalizer.languages import ALL_LANGUAGES


class InputProblem(Exception):
    """A form error with a known control."""

    def __init__(self, message, field, detail=None, line=None, column=None, path=None):
        super().__init__(message)
        self.field = field
        self.detail = detail
        self.line = line
        self.column = column
        self.path = path


def _enum_type(hint):
    if isinstance(hint, type) and issubclass(hint, enum.Enum):
        return hint
    for arg in typing.get_args(hint):
        found = _enum_type(arg)
        if found is not None:
            return found
    return None


def _field_schema(cls, field, hints, instance):
    value = getattr(instance, field.name)
    enum_type = _enum_type(hints.get(field.name))
    if enum_type is not None:
        return {
            "name": field.name,
            "kind": "enum",
            "choices": [member.name for member in enum_type],
            "default": value.name if value is not None else None,
            "nullable": value is None,
        }
    if isinstance(value, bool):
        return {"name": field.name, "kind": "bool", "default": value}
    if isinstance(value, str):
        return {"name": field.name, "kind": "string", "default": value}
    if isinstance(value, int):
        return {"name": field.name, "kind": "integer", "default": value}
    if isinstance(value, frozenset):
        return {
            "name": field.name,
            "kind": "string_set",
            "default_count": len(value),
        }
    if isinstance(value, Mapping):
        return {"name": field.name, "kind": "mapping_pairs"}
    return {"name": field.name, "kind": "python"}


def get_schema():
    """Return all built-in language constructor settings and API names."""
    result = {}
    for cls in sorted(ALL_LANGUAGES, key=lambda item: item.__name__):
        instance = cls()
        hints = typing.get_type_hints(cls)
        try:
            literalize_call(
                source='[["Ada"]]',
                input_format=InputFormat.JSON,
                language=instance,
                target_function="consume",
                parameter_names=["value"],
            )
            call_supported = True
        except CallsNotSupportedByLanguageError, CallsNotSupportedByToolError:
            call_supported = False
        result[cls.__name__] = {
            "fields": [
                _field_schema(cls, field, hints, instance)
                for field in dataclasses.fields(cls)
                if field.init
            ],
            "modifiers": [member.name for member in cls.modifiers],
            "ref_cases": [member.name for member in cls.supported_ref_cases],
            "call_supported": call_supported,
        }
    return json.dumps(
        {
            "languages": result,
            "value_options": _option_names(literalize),
            "call_options": _option_names(literalize_call),
        }
    )


def _option_names(function):
    return [
        name
        for name in inspect.signature(function).parameters
        if name not in {"source", "input_format", "language"}
    ]


def _python_values(value):
    if isinstance(value, dict):
        if set(value) == {"$python"}:
            return eval(value["$python"], globals())  # noqa: S307
        return {key: _python_values(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_python_values(item) for item in value]
    return value


def _language_option(cls, name, value):
    field = next(item for item in dataclasses.fields(cls) if item.name == name)
    hints = typing.get_type_hints(cls)
    enum_type = _enum_type(hints.get(field.name))
    if enum_type is not None:
        return None if value is None else enum_type[value]
    if name == "record_shape_names":
        return {frozenset(keys): label for keys, label in value}
    if name == "empty_container_type_hints":
        return {tuple(path): label for path, label in value}
    if isinstance(getattr(cls(), name), frozenset):
        return frozenset(value)
    try:
        return _python_values(value)
    except (SyntaxError, NameError, TypeError, ValueError) as error:
        raise InputProblem(
            "Check this Python expression.",
            f"language:{name}",
            f"{name}: {error}",
        ) from error


def _variable_form(value, cls):
    if value is None:
        return None
    kind = value["kind"]
    name = value["name"]
    if kind == "ExistingVariable":
        return ExistingVariable(name=name)
    modifiers = frozenset(cls.modifiers[item] for item in value.get("modifiers", []))
    if kind == "NewVariable":
        return NewVariable(name=name, modifiers=modifiers)
    if kind == "BothVariableForms":
        return BothVariableForms(name=name, modifiers=modifiers)
    raise ValueError(f"Unknown variable form: {kind}")


def _options(raw, cls):
    options = _python_values(raw)
    if "variable_form" in options:
        options["variable_form"] = _variable_form(options["variable_form"], cls)
    if "ref_case" in options and options["ref_case"] is not None:
        options["ref_case"] = IdentifierCase[options["ref_case"]]
    if "collection_layout" in options:
        options["collection_layout"] = CollectionLayout[options["collection_layout"]]
    if "zip_input_format" in options and options["zip_input_format"] is not None:
        options["zip_input_format"] = InputFormat[options["zip_input_format"]]
    if "consumable_refs" in options:
        options["consumable_refs"] = frozenset(options["consumable_refs"])
    if isinstance(options.get("call_transform"), str) and options["call_transform"]:
        try:
            options["call_transform"] = eval(options["call_transform"], globals())  # noqa: S307
        except (SyntaxError, NameError, TypeError, ValueError) as error:
            raise InputProblem(
                "Check the call transform expression.",
                "call-transform",
                str(error),
            ) from error
    return options


def _result_data(result):
    return {
        "code": result.code,
        "bare_code": result.bare_code,
        "declaration_code": result.declaration_code,
    }


def _convert(request):
    """Execute one browser request."""
    cls = getattr(languages, request["language"])
    language = cls(
        **{
            name: _language_option(cls, name, value)
            for name, value in request.get("language_options", {}).items()
        }
    )
    source = request["source"]
    input_format = InputFormat[request["format"]]
    operation = request["operation"]
    if operation == "value":
        result = literalize(
            source=source,
            input_format=input_format,
            language=language,
            **_options(request.get("options", {}), cls),
        )
    else:
        call = literalize_call(
            source=source,
            input_format=input_format,
            language=language,
            **_options(request.get("options", {}), cls),
        )
        if operation == "call":
            result = call
        elif operation == "compose":
            declarations = []
            for item in request.get("declarations", []):
                try:
                    declarations.append(
                        literalize(
                            source=item["source"],
                            input_format=InputFormat[item["format"]],
                            language=language,
                            **_options(item.get("options", {}), cls),
                        )
                    )
                except ParseError as error:
                    raise InputProblem(
                        f"Could not read declaration {len(declarations) + 1} as {item['format']}. Check its syntax.",
                        item.get("ui_field", "declaration-list"),
                        str(error),
                        error.line,
                        error.column,
                    ) from error
                except LiteralizerError as error:
                    problem = _literalizer_error(error, request)
                    field = item.get("ui_fields", {}).get(
                        problem["field"], item.get("ui_field", "declaration-list")
                    )
                    raise InputProblem(
                        f"Declaration {len(declarations) + 1}: {problem['message']}",
                        field,
                        problem["detail"],
                        path=problem["path"],
                    ) from error
                except (KeyError, ValueError, TypeError) as error:
                    raise InputProblem(
                        f"Declaration {len(declarations) + 1} could not be converted. Check its source and settings.",
                        item.get("ui_field", "declaration-list"),
                        str(error),
                    ) from error
            result = literalize_call_with_declarations(
                language=language,
                declarations=declarations,
                call=call,
                extra_preamble=tuple(request.get("extra_preamble", [])),
                extra_body_preamble=tuple(request.get("extra_body_preamble", [])),
            )
        else:
            raise ValueError(f"Unknown operation: {operation}")
    return _result_data(result)


def _literalizer_error(error, request):
    """Translate API errors into form guidance, retaining detail on demand."""
    language = request.get("language_label", request.get("language", "This language"))
    field = "source" if error.path is not None else None
    message = (
        f"{language} cannot convert this input with the current settings. "
        "Try changing the input, settings, or language."
    )
    if isinstance(error, WrapInFileWithoutVariableNotSupportedError):
        message = (
            f"{language} needs a named variable in a complete file. "
            "Choose New variable under Settings, or turn off Generate complete file."
        )
        field = "variable-form"
    elif isinstance(error, ExistingVariableNotSelfContainedError):
        message = (
            "A complete file cannot use an existing variable without declaring it. "
            "Choose New variable, or turn off Generate complete file."
        )
        field = "variable-form"
    elif isinstance(error, VariableNameNotSupportedError):
        message = f"{language} cannot save this value as a variable. Choose Just the value instead."
        field = "variable-form"
    elif isinstance(error, WrapCombinedInFileNotSupportedError):
        message = f"{language} cannot use Declare and assign in a complete file. Choose New variable instead."
        field = "variable-form"
    elif isinstance(error, DelimiterlessVariableError):
        message = "A collection without its outer brackets cannot be saved as one variable. Include collection delimiters."
        field = "include-delimiters"
    elif isinstance(error, DelimiterlessWrappedFileError):
        message = (
            "A complete file needs the collection's outer brackets. Include collection delimiters."
        )
        field = "include-delimiters"
    elif isinstance(error, PreIndentedWrappedFileError):
        message = "A complete file cannot be pre-indented. Set Indent levels to zero."
        field = "pre-indent-level"
    elif isinstance(error, (InvalidNewVariableNameError, ReservedVariableNameError)):
        message = f"Choose a different variable name for {language}."
        field = "variable-name"
    elif isinstance(error, (InvalidCallTargetError, DottedCallTargetNotSupportedError)):
        message = f"Choose a different function name for {language}."
        field = "target-function"
    elif isinstance(error, InvalidCallParameterNameError):
        message = f"Choose parameter names that {language} accepts."
        field = "parameter-names"
    elif isinstance(error, ParameterCountMismatchError):
        word = "value" if error.expected == 1 else "values"
        message = (
            f"Each call needs {error.expected} {word}, but one row has "
            f"{error.got}. Update the input rows or Parameter names."
        )
        field = "source"
    elif isinstance(error, PerElementNotListError):
        message = (
            'Enter an array of call rows, such as [["Ada"], ["Grace"]], '
            "or turn off One call per top-level element in Settings."
        )
        field = "source"
    elif isinstance(error, InputRootKeyNotFoundError):
        message = (
            f"There is no {error.input_root_key!r} key in the input. "
            "Change Rows key or add that key to the data."
        )
        field = "input-root-key"
    elif isinstance(error, InputRootNotMappingError):
        message = (
            "Rows key needs an object at the top of the input. Use an object, or clear Rows key."
        )
        field = "input-root-key"
    elif isinstance(error, (CallsNotSupportedByLanguageError, CallsNotSupportedByToolError)):
        message = (
            f"{language} cannot produce function calls here. "
            "Choose another language or create a value instead."
        )
        field = "language"
    elif isinstance(error, InvalidPreIndentLevelError):
        message = "Indent levels must be zero or greater."
        field = "pre-indent-level"
    elif isinstance(error, ZipValuesWithoutCallTransformError):
        message = "Paired input needs a call transform to use its values."
        field = "call-transform"
    elif isinstance(error, HeterogeneousCollectionError):
        message = (
            f"{language} cannot hold this mix of values in one collection. "
            "Change the input or choose another language."
        )
        field = "source"
    elif isinstance(error, UnsupportedOptionError):
        message = f"{language} does not support this setting. Choose another setting or language."
        field = f"language:{error.option}"
    return {
        "message": message,
        "field": field,
        "path": list(error.path) if error.path is not None else None,
        "detail": str(error) or type(error).__name__,
    }


def convert(request_json):
    """Return a result or a display-safe input error as JSON."""
    request = json.loads(request_json)
    try:
        result = _convert(request)
        return json.dumps({"ok": True, "result": result})
    except ParseError as error:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "message": f"Could not read the {request['format']} input. Check its syntax.",
                    "field": "source",
                    "line": error.line,
                    "column": error.column,
                    "detail": str(error),
                },
            }
        )
    except InputProblem as error:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "message": str(error),
                    "field": error.field,
                    "detail": error.detail,
                    "line": error.line,
                    "column": error.column,
                    "path": error.path,
                },
            }
        )
    except LiteralizerError as error:
        return json.dumps({"ok": False, "error": _literalizer_error(error, request)})
    except (KeyError, TypeError, ValueError, SyntaxError, NameError) as error:
        return json.dumps(
            {
                "ok": False,
                "error": {
                    "message": "Check the input and settings, then try again.",
                    "detail": str(error) or type(error).__name__,
                },
            }
        )
