const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const textEncoder = new TextEncoder();

export function createSseResponse(req: Request): Response {
  let clientController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientController = controller;
      sseClients.add(controller);

      // Send initial handshake event immediately
      const welcome = `event: connected\ndata: ${JSON.stringify({
        ts: Date.now(),
        clients: sseClients.size,
      })}\n\n`;
      try {
        controller.enqueue(textEncoder.encode(welcome));
      } catch {
        sseClients.delete(controller);
      }

      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(textEncoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          if (keepAliveTimer) clearInterval(keepAliveTimer);
          sseClients.delete(controller);
        }
      }, 15_000);

      req.signal.addEventListener("abort", () => {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        if (clientController) sseClients.delete(clientController);
      });
    },
    cancel() {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (clientController) sseClients.delete(clientController);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function broadcastSseEvent(eventType: string, payload: unknown): void {
  if (sseClients.size === 0) return;
  const frame = textEncoder.encode(
    `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`
  );
  for (const ctrl of Array.from(sseClients)) {
    try {
      ctrl.enqueue(frame);
    } catch {
      sseClients.delete(ctrl);
    }
  }
}

// ============================================================================
// Run Cancellation Registry (AbortController per Crawl Run)
// ============================================================================
const activeRunControllers = new Map<number, AbortController>();

export function registerRunController(runId: number): AbortController {
  const controller = new AbortController();
  activeRunControllers.set(runId, controller);
  return controller;
}

export function getRunSignal(runId: number): AbortSignal | undefined {
  return activeRunControllers.get(runId)?.signal;
}

export function isRunCancelled(runId: number): boolean {
  const ctrl = activeRunControllers.get(runId);
  return Boolean(ctrl && ctrl.signal.aborted);
}

export function cancelRunById(runId: number): boolean {
  const ctrl = activeRunControllers.get(runId);
  if (!ctrl) return false;
  if (!ctrl.signal.aborted) {
    ctrl.abort(new Error("Cancelled by user"));
  }
  return true;
}

export function cancelAllActiveRuns(): void {
  for (const [, ctrl] of activeRunControllers.entries()) {
    if (!ctrl.signal.aborted) {
      ctrl.abort(new Error("Cleared by user"));
    }
  }
}

export function cleanupRunController(runId: number): void {
  activeRunControllers.delete(runId);
}
