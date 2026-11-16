// Contrapt kernel bootstrap.
//
// OpenCASCADE (via WebAssembly) prints diagnostics such as "Statistics on Transfer" to
// stdout. An MCP stdio server speaks JSON-RPC on stdout, so ANY stray byte there corrupts
// the protocol. We therefore route all kernel output to a caller-supplied sink (default:
// collected in memory, optionally forwarded to stderr) and never let it reach stdout.
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';

let ready;
const diagnostics = [];

/**
 * Initialise the geometry kernel once and return the OpenCascade instance.
 * @param {{ onLog?: (line: string, isError: boolean) => void }} [opts]
 */
export function initKernel(opts = {}) {
  if (!ready) {
    const sink = opts.onLog ?? (() => {});
    ready = initOpenCascade({
      print: (t) => {
        diagnostics.push(t);
        sink(t, false);
      },
      printErr: (t) => {
        diagnostics.push(t);
        sink(t, true);
      },
    }).then((oc) => {
      setOC(oc);
      return oc;
    });
  }
  return ready;
}

/** Kernel diagnostics captured so far (useful when a build fails). */
export function kernelDiagnostics() {
  return diagnostics.slice();
}
