import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

let pyodide;
async function initialize() {
  pyodide = await loadPyodide();
  await pyodide.loadPackage('micropip');
  pyodide.globals.set('_web_wheel_url', new URL('./literalizer-2026.9.4.post548+gf41d2a15b-py3-none-any.whl', self.location.href).href);
  await pyodide.runPythonAsync('import micropip\nawait micropip.install(_web_wheel_url)');
  const bridge = await fetch(new URL('./bridge.py', self.location.href), { cache: 'no-store' });
  if (!bridge.ok) throw new Error(`Could not load browser bridge: ${bridge.status}`);
  pyodide.runPython(await bridge.text());
  const schema = JSON.parse(pyodide.runPython('get_schema()'));
  self.postMessage({ type: 'ready', schema });
}

const startup = initialize().catch(error => {
  self.postMessage({ type: 'error', message: `Could not load Literalizer: ${error.message.split('\n').filter(Boolean).at(-1)}` });
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
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, error: { message: 'Conversion failed unexpectedly. Please check the input and try again.' } });
  }
};
