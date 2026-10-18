import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

let pyodide;
async function initialize() {
  pyodide = await loadPyodide();
  await pyodide.loadPackage(['micropip', 'packaging']);
  pyodide.globals.set(
    '_web_wheel_url',
    new URL('./literalizer-2026.9.16-py3-none-any.whl', self.location.href).href,
  );
  await pyodide.runPythonAsync(`
import micropip
from importlib.metadata import requires
from packaging.requirements import Requirement

# The published wheel requires a native YAML accelerator on CPython,
# including Pyodide. ruamel.yaml uses its pure-Python parser without it.
await micropip.install(_web_wheel_url, deps=False)
requirements = [Requirement(item) for item in requires("literalizer")]
await micropip.install([
    str(item) for item in requirements
    if item.name != "ruamel-yaml-clib"
    and (item.marker is None or item.marker.evaluate())
])
`);
  const bridge = await fetch(new URL('./bridge.py', self.location.href), { cache: 'no-store' });
  if (!bridge.ok) throw new Error(`Could not load browser bridge: ${bridge.status}`);
  pyodide.runPython(await bridge.text());
  const schema = JSON.parse(pyodide.runPython('get_schema()'));
  self.postMessage({ type: 'ready', schema });
}

const startup = initialize().catch((error) => {
  self.postMessage({
    type: 'error',
    message: `Could not load Literalizer: ${error.message.split('\n').filter(Boolean).at(-1)}`,
  });
});

self.onmessage = async ({ data }) => {
  if (data.type !== 'convert') return;
  await startup;
  if (!pyodide) return;
  try {
    pyodide.globals.set('_web_request', JSON.stringify(data.request));
    const response = JSON.parse(pyodide.runPython('convert(_web_request)'));
    if (response.ok) self.postMessage({ type: 'result', id: data.id, result: response.result });
    else self.postMessage({ type: 'error', id: data.id, error: response.error });
  } catch {
    self.postMessage({
      type: 'error',
      id: data.id,
      error: { message: 'Conversion failed unexpectedly. Please check the input and try again.' },
    });
  }
};
