// Contrapt kernel bootstrap.
//
// OpenCASCADE (via WebAssembly) prints diagnostics such as "Statistics on Transfer" to
// stdout. An MCP stdio server speaks JSON-RPC on stdout, so ANY stray byte there corrupts
// the protocol. We therefore route all kernel output to a caller-supplied sink (default:
// collected in memory, optionally forwarded to stderr) and never let it reach stdout.

import { setOC } from 'replicad';
import initOpenCascade from 'replicad-opencascadejs';

type OpenCascade = Awaited<ReturnType<typeof initOpenCascade>>;

export interface KernelOptions {
  /** Called for every line the kernel prints. Never write this to stdout in an MCP server. */
  onLog?: (line: string, isError: boolean) => void;
}

let ready: Promise<OpenCascade> | undefined;
const diagnostics: string[] = [];

/** Initialise the geometry kernel once and return the OpenCascade instance. */
export function initKernel(opts: KernelOptions = {}): Promise<OpenCascade> {
  if (!ready) {
    const sink = opts.onLog ?? (() => {});
    ready = initOpenCascade({
      print: (t: string) => {
        diagnostics.push(t);
        sink(t, false);
      },
      printErr: (t: string) => {
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
export function kernelDiagnostics(): string[] {
  return diagnostics.slice();
}
